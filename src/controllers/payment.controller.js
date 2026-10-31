import { Payment } from '../models/payment.model.js';
import { Order } from '../models/order.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { checkout, paymentWebhook, restoreStock } from './order.controller.js';
import mongoose from 'mongoose';

/**
 * Get all Payment transactions across the platform with filters, pagination, and ledger summary
 */
const getAllPayments = asyncHandler(async (req, res) => {
    const { status, provider, search, limit = 100, page = 1 } = req.query;

    const query = {};

    if (status && status !== 'ALL') {
        query.status = status;
    }

    if (provider && provider !== 'ALL') {
        query.paymentProvider = provider;
    }

    if (search) {
        const cleanSearch = search.trim();
        query.$or = [
            { transactionId: { $regex: cleanSearch, $options: 'i' } },
            { errorMessage: { $regex: cleanSearch, $options: 'i' } },
        ];
        if (mongoose.isValidObjectId(cleanSearch)) {
            query.$or.push({ _id: cleanSearch });
            query.$or.push({ orderId: cleanSearch });
        }
    }

    // Role-based filtering for sellers: only show payments linked to orders containing their items
    if (req.user?.role === 'seller') {
        const sellerOrders = await Order.find({ "items.sellerId": req.user.id }).select('_id');
        const orderIds = sellerOrders.map(o => o._id);
        query.orderId = { $in: orderIds };
    }

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
        .populate({
            path: 'orderId',
            select: 'orderNumber grandTotal fulfillmentStatus paymentStatus items shippingAddress createdAt'
        })
        .populate({
            path: 'userId',
            select: 'name email phone'
        })
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

    // Ledger summary statistics
    const statsAggregation = await Payment.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: { $sum: '$amount' }
            }
        }
    ]);

    const stats = {
        totalTransactions: total,
        totalSuccessAmount: statsAggregation.find(s => s._id === 'Success')?.totalAmount || 0,
        successCount: statsAggregation.find(s => s._id === 'Success')?.count || 0,
        failedCount: statsAggregation.find(s => s._id === 'Failed')?.count || 0,
        refundedCount: statsAggregation.find(s => s._id === 'Refunded')?.count || 0,
        refundedAmount: statsAggregation.find(s => s._id === 'Refunded')?.totalAmount || 0,
        initiatedCount: statsAggregation.find(s => s._id === 'Initiated')?.count || 0
    };

    res.status(200).json(
        new ApiResponse(200, { payments, stats, total, page: Number(page), pages: Math.ceil(total / Number(limit)) }, "Transactions retrieved successfully")
    );
});

/**
 * Get single Payment ledger record by ID
 */
const getPaymentById = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;

    if (!paymentId || !mongoose.isValidObjectId(paymentId)) {
        throw new ApiError(400, "Valid Payment ID is required");
    }

    const payment = await Payment.findById(paymentId)
        .populate({
            path: 'orderId',
            select: 'orderNumber grandTotal fulfillmentStatus paymentStatus items shippingAddress createdAt'
        })
        .populate({
            path: 'userId',
            select: 'name email phone'
        });

    if (!payment) {
        throw new ApiError(404, "Payment record not found");
    }

    // Authorization: User can only see their own payment unless admin
    if (req.user?.role !== 'admin' && payment.userId?._id?.toString() !== req.user?.id?.toString()) {
        throw new ApiError(403, "Access denied: You do not have permission to view this payment");
    }

    res.status(200).json(
        new ApiResponse(200, payment, "Payment ledger record retrieved successfully")
    );
});

/**
 * Get all Payment transactions for a specific Order
 */
const getPaymentsByOrderId = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    if (!orderId || !mongoose.isValidObjectId(orderId)) {
        throw new ApiError(400, "Valid Order ID is required");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    if (req.user?.role !== 'admin' && order.userId.toString() !== req.user?.id?.toString()) {
        throw new ApiError(403, "Access denied: You do not have permission to view payments for this order");
    }

    const payments = await Payment.find({ orderId }).sort({ createdAt: -1 });

    res.status(200).json(
        new ApiResponse(200, payments, "Order payment transactions retrieved successfully")
    );
});

/**
 * Admin Process Refund controller
 * Transitions Payment status to 'Refunded', updates linked Order, and restores inventory.
 */
const processRefund = asyncHandler(async (req, res) => {
    const { paymentId, transactionId, reason, amount } = req.body;

    const query = {};
    if (paymentId && mongoose.isValidObjectId(paymentId)) {
        query._id = paymentId;
    } else if (transactionId) {
        query.transactionId = transactionId;
    } else {
        throw new ApiError(400, "Valid paymentId or transactionId is required to process refund");
    }

    const payment = await Payment.findOne(query).populate('orderId');
    if (!payment) {
        throw new ApiError(404, "Payment transaction record not found");
    }

    if (payment.status === 'Refunded') {
        throw new ApiError(400, "Transaction has already been refunded");
    }

    if (payment.status !== 'Success' && payment.status !== 'Authorized') {
        throw new ApiError(400, `Cannot refund transaction with status '${payment.status}'. Only successful payments can be refunded.`);
    }

    // Role-based check
    if (req.user?.role !== 'admin') {
        throw new ApiError(403, "Access denied: Only administrators can process refunds");
    }

    const refundAmount = Number(amount) || payment.amount;
    const refundReason = reason || 'Admin initiated refund';

    // Update payment record in ledger
    payment.status = 'Refunded';
    payment.gatewayResponse = {
        ...payment.gatewayResponse,
        refundedAt: new Date(),
        refundAmount,
        refundReason,
        refundedBy: req.user?.id || req.user?.email || 'admin'
    };
    await payment.save();

    // Update linked order document and restore inventory
    const order = await Order.findById(payment.orderId);
    if (order) {
        order.paymentStatus = 'Refunded';
        order.fulfillmentStatus = 'Cancelled';
        order.cancelledAt = new Date();
        order.cancellationReason = `Refunded: ${refundReason}`;
        
        // Restore stock atomically
        if (order.items && order.items.length > 0) {
            await restoreStock(order.items);
        }
        await order.save();
    }

    res.status(200).json(
        new ApiResponse(
            200,
            { payment, order },
            `Refund of ${payment.currency} ${refundAmount} processed successfully. Stock restored and order cancelled.`
        )
    );
});

export {
    checkout,
    paymentWebhook,
    getAllPayments,
    getPaymentById,
    getPaymentsByOrderId,
    processRefund
};
