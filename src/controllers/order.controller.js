import { Order } from "../models/order.model.js";
import { Payment } from "../models/payment.model.js";
import { User } from "../models/user.model.js";
import { Product } from "../models/product.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import razorpay from 'razorpay';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { getUnitPrice, getVariantSizeValue, getVariantLabelError, getVariantImage } from '../utils/variantPricing.js';

// Global Variables
const currency = 'usd';
const deliveryCharge = 10;

// Gateway Instances
const razorpayInstance = new razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
});

const stripeInstance = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

// ==========================================
// Helper Utilities for Decoupled Architecture
// ==========================================

/**
 * Normalizes payment provider and method inputs into valid enum values
 */
const normalizePaymentDetails = (providerInput = '', methodInput = '') => {
    const rawProvider = (providerInput || '').trim().toLowerCase();
    const rawMethod = (methodInput || '').trim().toLowerCase();

    let provider = 'COD';
    let method = 'Cash';

    if (rawProvider.includes('razorpay') || rawMethod.includes('razorpay')) {
        provider = 'Razorpay';
        if (rawMethod.includes('card') || rawMethod.includes('credit')) {
            method = 'Credit_Card';
        } else if (rawMethod.includes('net') || rawMethod.includes('bank')) {
            method = 'NetBanking';
        } else {
            method = 'UPI';
        }
    } else if (rawProvider.includes('stripe') || rawMethod.includes('stripe')) {
        provider = 'Stripe';
        method = 'Credit_Card';
    } else if (rawProvider.includes('cod') || rawMethod.includes('cod') || rawMethod.includes('cash')) {
        provider = 'COD';
        method = 'Cash';
    } else {
        // Direct enum matching
        if (['Razorpay', 'Stripe', 'COD'].includes(providerInput)) {
            provider = providerInput;
        }
        if (['Credit_Card', 'UPI', 'NetBanking', 'Cash'].includes(methodInput)) {
            method = methodInput;
        }
    }

    return { provider, method };
};

/**
 * Normalizes shipping address from raw client body
 */
const normalizeShippingAddress = (addressObj = {}) => {
    return {
        firstName: (addressObj.firstName || addressObj.name || '').trim() || 'Customer',
        lastName: (addressObj.lastName || '').trim() || '',
        email: (addressObj.email || '').trim().toLowerCase(),
        phone: (addressObj.phone || addressObj.mobileNumber || '').trim() || 'N/A',
        street: (addressObj.street || addressObj.addressLine1 || '').trim() || 'N/A',
        city: (addressObj.city || '').trim() || 'N/A',
        state: (addressObj.state || '').trim() || 'N/A',
        zipcode: (addressObj.zipcode || addressObj.zip || addressObj.postalCode || '').trim() || '000000',
        country: (addressObj.country || 'India').trim()
    };
};

// Product photos with the purchased option's photo first, so order views show what was bought
const orderLineImages = (product, label) => {
    const images = Array.isArray(product.image) ? [...product.image] : [];
    const chosen = getVariantImage(product, label);
    return chosen ? [chosen, ...images.filter((img) => img !== chosen)] : images;
};

/**
 * Enriches and validates order line items from the Product catalog
 */
const enrichOrderItems = async (items) => {
    if (!Array.isArray(items) || items.length === 0) return [];

    const productIds = items
        .map(i => i.productId || i._id)
        .filter(id => id && mongoose.isValidObjectId(id));

    const products = await Product.find({ _id: { $in: productIds } })
        .select("name price discount attributes variantPrices variantImages sizes image sellerId storeName stock sizeStock category subCategory");
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    return items.map(item => {
        const pid = (item.productId || item._id)?.toString();
        const prod = productMap.get(pid);

        // Always price from the catalog (variant adjustment + discount); never trust a client-sent price.
        // Unknown products are rejected later by validateAndDeductStock.
        const priceAtTimeOfPurchase = prod ? getUnitPrice(prod, item.size) : 0;

        return {
            productId: pid ? new mongoose.Types.ObjectId(pid) : item._id,
            variantId: item.variantId || item.size || null,
            quantity: Math.max(1, Math.floor(Number(item.quantity)) || 1),
            priceAtTimeOfPurchase,
            sellerId: prod?.sellerId || item.sellerId || null,
            name: prod?.name || item.name || 'Product',
            category: prod?.category || item.category || 'General',
            subCategory: prod?.subCategory || item.subCategory || '',
            size: item.size || null,
            image: prod ? orderLineImages(prod, item.size) : (Array.isArray(item.image) ? item.image : []),
            storeName: prod?.storeName || item.storeName || 'Forever Head Office'
        };
    });
};

/**
 * Validates stock sufficiency and atomically deducts stock
 */
const validateAndDeductStock = async (items, session = null) => {
    if (!Array.isArray(items) || items.length === 0) return;

    const productIds = items
        .map(i => i.productId || i._id)
        .filter(id => id && mongoose.isValidObjectId(id));

    const products = await Product.find({ _id: { $in: productIds } });
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of items) {
        const pid = (item.productId || item._id)?.toString();
        const product = productMap.get(pid);
        const qty = Number(item.quantity) || 1;

        if (!product) {
            throw new ApiError(404, `Product '${item.name || pid}' is no longer available`);
        }

        const optionError = getVariantLabelError(product, item.size);
        if (optionError) {
            throw new ApiError(400, optionError);
        }

        const currentTotalStock = product.stock !== undefined ? product.stock : 50;
        if (currentTotalStock < qty) {
            throw new ApiError(400, `Insufficient stock for '${product.name}'. Available: ${currentTotalStock}, Requested: ${qty}`);
        }

        const sizeValue = getVariantSizeValue(product, item.size);
        if (sizeValue && product.sizeStock) {
            let sizeStockVal;
            if (product.sizeStock instanceof Map) {
                sizeStockVal = product.sizeStock.get(sizeValue);
            } else if (typeof product.sizeStock === 'object') {
                sizeStockVal = product.sizeStock[sizeValue];
            }
            if (sizeStockVal !== undefined && sizeStockVal < qty) {
                throw new ApiError(400, `Insufficient stock for '${product.name}' (Size ${sizeValue}). Available: ${sizeStockVal}, Requested: ${qty}`);
            }
        }
    }

    for (const item of items) {
        const pid = (item.productId || item._id)?.toString();
        const product = productMap.get(pid);
        const qty = Number(item.quantity) || 1;
        const updateOp = { $inc: { stock: -qty } };

        const sizeValue = product ? getVariantSizeValue(product, item.size) : null;
        if (sizeValue && product.sizeStock && (product.sizeStock instanceof Map ? product.sizeStock.has(sizeValue) : sizeValue in product.sizeStock)) {
            updateOp.$inc[`sizeStock.${sizeValue}`] = -qty;
        }

        const opts = session ? { session, new: true } : { new: true };
        await Product.findByIdAndUpdate(pid, updateOp, opts);
    }
};

/**
 * Restores stock inventory upon order cancellation
 */
const restoreStock = async (items, session = null) => {
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
        const pid = (item.productId || item._id)?.toString();
        if (!pid || !mongoose.isValidObjectId(pid)) continue;

        const product = await Product.findById(pid);
        const qty = Number(item.quantity) || 1;
        const updateOp = { $inc: { stock: qty } };

        const sizeValue = product ? getVariantSizeValue(product, item.size) : null;
        if (sizeValue && product.sizeStock && (product.sizeStock instanceof Map ? product.sizeStock.has(sizeValue) : sizeValue in product.sizeStock)) {
            updateOp.$inc[`sizeStock.${sizeValue}`] = qty;
        }

        const opts = session ? { session, new: true } : { new: true };
        await Product.findByIdAndUpdate(pid, updateOp, opts);
    }
};

/**
 * Validates promotional discount coupons
 */
const validateCouponHelper = async (couponCode, userId) => {
    if (!couponCode || typeof couponCode !== 'string') {
        return { valid: false, message: "Please enter a coupon code." };
    }

    const code = couponCode.trim().toUpperCase();

    if (code === "FIRST") {
        if (!userId) {
            return { valid: false, message: "Please log in to apply coupon 'FIRST'." };
        }

        const priorOrdersCount = await Order.countDocuments({ userId: userId.toString() });
        if (priorOrdersCount > 0) {
            return {
                valid: false,
                message: "Coupon 'FIRST' is only valid for new users on their first order."
            };
        }

        return {
            valid: true,
            code: "FIRST",
            discountType: "free_delivery",
            discountAmount: deliveryCharge,
            message: "Coupon 'FIRST' applied! You get Free Delivery on your first order."
        };
    }

    return { valid: false, message: "Invalid or expired coupon code." };
};

// ==========================================
// Task 2: Controllers Implementation
// ==========================================

/**
 * POST /checkout Controller
 * Decoupled checkout: Creates Order (Fulfillment) with paymentStatus: 'Unpaid',
 * immediately creates linked Payment (Ledger) with status: 'Initiated',
 * then initializes gateway session/keys for the client.
 */
const checkout = asyncHandler(async (req, res) => {
    // 1. Role validation: Buyers place consumer orders. Admins and sellers are blocked.
    if (req.user?.role && req.user.role !== 'user') {
        throw new ApiError(403, "Admins and Sellers do not place consumer orders");
    }

    const currentUserId = req.user?.id || req.user?._id || req.body.userId;
    if (!currentUserId || !mongoose.isValidObjectId(currentUserId)) {
        throw new ApiError(401, "A valid authenticated User ID is required");
    }

    const {
        items,
        shippingAddress: bodyAddress,
        address,
        paymentProvider: bodyProvider,
        paymentMethod: bodyMethod,
        coupon,
        idempotencyKey: bodyKey,
        notes
    } = req.body;

    const idempotencyKey = req.headers['idempotency-key'] || bodyKey;
    const rawAddress = bodyAddress || address;

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, "Order items must be a non-empty array");
    }

    if (!rawAddress || typeof rawAddress !== 'object') {
        throw new ApiError(400, "Valid shippingAddress is required");
    }

    const shippingAddress = normalizeShippingAddress(rawAddress);
    const { provider, method } = normalizePaymentDetails(bodyProvider, bodyMethod);

    // 2. Idempotency Protection: If request has already been processed, return existing records
    if (idempotencyKey) {
        const existingOrder = await Order.findOne({ idempotencyKey, userId: currentUserId });
        if (existingOrder) {
            const existingPayment = await Payment.findOne({ orderId: existingOrder._id });
            return res.status(200).json(
                new ApiResponse(
                    200,
                    {
                        order: existingOrder,
                        payment: existingPayment,
                        gatewayData: existingPayment?.gatewayResponse || null
                    },
                    "Order and Payment retrieved (idempotent request)"
                )
            );
        }
    }

    // 3. Enrich line items from the catalog & verify stock availability
    const enrichedItems = await enrichOrderItems(items);
    if (enrichedItems.length === 0) {
        throw new ApiError(400, "Unable to resolve valid catalog products for the specified items");
    }

    // 4. Financial Calculation Engine
    const subTotal = Number(
        enrichedItems.reduce((acc, item) => acc + (item.priceAtTimeOfPurchase * item.quantity), 0).toFixed(2)
    );

    let effectiveShipping = deliveryCharge;
    let appliedCoupon = '';
    let discountAmount = 0;

    if (coupon) {
        const couponCheck = await validateCouponHelper(coupon, currentUserId);
        if (!couponCheck.valid) {
            throw new ApiError(400, couponCheck.message);
        }
        if (couponCheck.discountType === 'free_delivery') {
            // Shipping is charged and the coupon discounts it (zeroing shipping too would discount it twice)
            appliedCoupon = couponCheck.code;
            discountAmount = Math.min(effectiveShipping, couponCheck.discountAmount || deliveryCharge);
        }
    }

    const taxAmount = 0;
    const grandTotal = Number((subTotal + taxAmount + effectiveShipping - discountAmount).toFixed(2));

    if (grandTotal < 0) {
        throw new ApiError(400, "Calculated grand total cannot be negative");
    }

    // Generate unique order number
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
    const orderNumber = `ORD-${datePart}-${randomPart}`;

    // 5. Order Schema Document (Physical Fulfillment)
    const orderData = {
        userId: currentUserId,
        orderNumber,
        items: enrichedItems,
        subTotal,
        taxAmount,
        shippingCost: effectiveShipping,
        discountAmount,
        grandTotal,
        shippingAddress,
        fulfillmentStatus: 'Pending',
        paymentStatus: 'Unpaid',
        coupon: appliedCoupon,
        notes: notes || '',
        ...(idempotencyKey && { idempotencyKey })
    };

    // 6. ACID Transaction Execution: Atomically deduct stock, create Order, create Payment & clear cart
    let newOrder;
    let newPayment;
    let session = null;

    try {
        session = await mongoose.startSession();
        session.startTransaction();

        await validateAndDeductStock(enrichedItems, session);

        // A) Create the Order with paymentStatus: 'Unpaid'
        const createdOrders = await Order.create([orderData], { session });
        newOrder = createdOrders[0];

        // B) Immediately create linked Payment document with status: 'Initiated'
        const initialTxnId = `INIT-${newOrder._id.toString()}-${Date.now()}`;
        const paymentData = {
            orderId: newOrder._id,
            userId: currentUserId,
            paymentProvider: provider,
            paymentMethod: method,
            amount: grandTotal,
            currency: currency.toUpperCase(),
            status: 'Initiated',
            transactionId: initialTxnId,
            gatewayResponse: {}
        };

        const createdPayments = await Payment.create([paymentData], { session });
        newPayment = createdPayments[0];

        // Reset customer's cart
        await User.findByIdAndUpdate(currentUserId, { cartData: {} }, { session });

        await session.commitTransaction();
    } catch (txnError) {
        if (session) await session.abortTransaction();
        if (txnError instanceof ApiError) throw txnError;

        // Fallback for standalone MongoDB environments without replica set transactions
        await validateAndDeductStock(enrichedItems);
        newOrder = await Order.create(orderData);
        newPayment = await Payment.create({
            orderId: newOrder._id,
            userId: currentUserId,
            paymentProvider: provider,
            paymentMethod: method,
            amount: grandTotal,
            currency: currency.toUpperCase(),
            status: 'Initiated',
            transactionId: `INIT-${newOrder._id.toString()}-${Date.now()}`,
            gatewayResponse: {}
        });
        await User.findByIdAndUpdate(currentUserId, { cartData: {} });
    } finally {
        if (session) session.endSession();
    }

    // 7. Initialize Payment Gateway Session / Keys
    let gatewayData = null;

    if (provider === 'Razorpay') {
        try {
            const razorpayOptions = {
                amount: Math.round(grandTotal * 100),
                currency: currency.toUpperCase(),
                receipt: newOrder.orderNumber,
                notes: {
                    orderId: newOrder._id.toString(),
                    paymentId: newPayment._id.toString(),
                    orderNumber: newOrder.orderNumber
                }
            };

            const razorpayOrder = await razorpayInstance.orders.create(razorpayOptions);

            newPayment.transactionId = razorpayOrder.id;
            newPayment.gatewayResponse = razorpayOrder;
            await newPayment.save();

            gatewayData = {
                provider: 'Razorpay',
                id: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                receipt: razorpayOrder.receipt,
                key: process.env.RAZORPAY_KEY_ID || ''
            };
        } catch (gatewayErr) {
            newPayment.status = 'Failed';
            newPayment.errorMessage = gatewayErr.message || 'Razorpay order creation failed';
            await newPayment.save();
            throw new ApiError(500, `Failed to initialize Razorpay payment: ${gatewayErr.message}`);
        }
    } else if (provider === 'Stripe') {
        if (stripeInstance) {
            try {
                const paymentIntent = await stripeInstance.paymentIntents.create({
                    amount: Math.round(grandTotal * 100),
                    currency: currency.toLowerCase(),
                    metadata: {
                        orderId: newOrder._id.toString(),
                        paymentId: newPayment._id.toString(),
                        orderNumber: newOrder.orderNumber
                    }
                });

                newPayment.transactionId = paymentIntent.id;
                newPayment.gatewayResponse = paymentIntent;
                await newPayment.save();

                gatewayData = {
                    provider: 'Stripe',
                    clientSecret: paymentIntent.client_secret,
                    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
                };
            } catch (stripeErr) {
                newPayment.status = 'Failed';
                newPayment.errorMessage = stripeErr.message || 'Stripe initialization failed';
                await newPayment.save();
                throw new ApiError(500, `Failed to initialize Stripe payment: ${stripeErr.message}`);
            }
        } else {
            newPayment.transactionId = `STRIPE-MOCK-${Date.now()}`;
            await newPayment.save();
            gatewayData = { provider: 'Stripe', clientSecret: `mock_secret_${newPayment._id}` };
        }
    } else {
        // COD (Cash on Delivery)
        newPayment.transactionId = `COD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await newPayment.save();
        gatewayData = { provider: 'COD', method: 'Cash' };
    }

    const responsePayload = {
        // Direct gateway fields for seamless Razorpay client initialization
        id: gatewayData?.id || newPayment.transactionId,
        amount: gatewayData?.amount || Math.round(grandTotal * 100),
        currency: gatewayData?.currency || currency.toUpperCase(),
        receipt: gatewayData?.receipt || newOrder.orderNumber,
        key: gatewayData?.key || process.env.RAZORPAY_KEY_ID || '',

        // Decoupled architecture entities
        order: newOrder,
        payment: newPayment,
        gatewayData
    };

    res.status(201).json(
        new ApiResponse(
            201,
            responsePayload,
            "Checkout processed successfully. Order (fulfillment) and Payment (ledger) created."
        )
    );
});

/**
 * Payment Webhook Controller
 * When a payment succeeds or fails, updates the respective Payment document using
 * the gateway's transactionId, and then finds the linked Order to update its paymentStatus.
 */
const paymentWebhook = asyncHandler(async (req, res) => {
    const rawBody = req.body;
    let transactionId = null;
    let targetStatus = null;
    let errorMessage = null;

    // 1. Razorpay Webhook Handler
    if (req.headers['x-razorpay-signature'] || rawBody.event?.startsWith('payment.') || rawBody.event?.startsWith('order.')) {
        const signature = req.headers['x-razorpay-signature'];
        if (process.env.RAZORPAY_WEBHOOK_SECRET && signature) {
            const expectedSig = crypto
                .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
                .update(typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(rawBody))
                .digest('hex');
            if (expectedSig !== signature) {
                throw new ApiError(400, "Invalid Razorpay webhook signature");
            }
        }

        const event = rawBody.event;
        const paymentEntity = rawBody.payload?.payment?.entity;
        const orderEntity = rawBody.payload?.order?.entity;

        // Extract transactionId: prefer Razorpay order_id / id
        transactionId = orderEntity?.id || paymentEntity?.order_id || paymentEntity?.id;

        if (event === 'payment.captured' || event === 'order.paid') {
            targetStatus = 'Success';
        } else if (event === 'payment.failed') {
            targetStatus = 'Failed';
            errorMessage = paymentEntity?.error_description || 'Payment failed';
        } else if (event === 'refund.processed') {
            targetStatus = 'Refunded';
        }
    }
    // 2. Stripe Webhook Handler
    else if (req.headers['stripe-signature'] || rawBody.type?.startsWith('payment_intent.')) {
        const eventType = rawBody.type;
        const dataObj = rawBody.data?.object;
        transactionId = dataObj?.id;

        if (eventType === 'payment_intent.succeeded') {
            targetStatus = 'Success';
        } else if (eventType === 'payment_intent.payment_failed') {
            targetStatus = 'Failed';
            errorMessage = dataObj?.last_payment_error?.message || 'Payment intent failed';
        } else if (eventType === 'charge.refunded') {
            targetStatus = 'Refunded';
        }
    }
    // 3. Fallback / Direct Webhook Integration
    else {
        transactionId = rawBody.transactionId || rawBody.orderId || rawBody.id;
        const rawStatus = (rawBody.status || '').toLowerCase();
        if (rawStatus === 'success' || rawStatus === 'paid' || rawStatus === 'authorized') {
            targetStatus = 'Success';
        } else if (rawStatus === 'failed' || rawStatus === 'error') {
            targetStatus = 'Failed';
            errorMessage = rawBody.errorMessage || 'Transaction failed';
        } else if (rawStatus === 'refunded') {
            targetStatus = 'Refunded';
        }
    }

    if (!transactionId) {
        throw new ApiError(400, "Unable to extract transactionId from webhook payload");
    }

    if (!targetStatus) {
        return res.status(200).json(
            new ApiResponse(200, { ignored: true }, "Webhook event acknowledged without status transition")
        );
    }

    // 4. Locate Payment document using gateway transactionId
    let payment = await Payment.findOne({
        $or: [
            { transactionId },
            { 'gatewayResponse.id': transactionId },
            { 'gatewayResponse.razorpay_order_id': transactionId }
        ]
    });

    if (!payment && mongoose.isValidObjectId(transactionId)) {
        payment = await Payment.findOne({
            $or: [{ _id: transactionId }, { orderId: transactionId }]
        });
    }

    if (!payment) {
        throw new ApiError(404, `Payment ledger record not found for transactionId: ${transactionId}`);
    }

    // Update Payment document
    payment.status = targetStatus;
    payment.gatewayResponse = {
        ...payment.gatewayResponse,
        webhookPayload: rawBody,
        webhookReceivedAt: new Date()
    };
    if (errorMessage) {
        payment.errorMessage = errorMessage;
    }
    await payment.save();

    // 5. Locate linked Order document & update paymentStatus accordingly
    const order = await Order.findById(payment.orderId);
    if (!order) {
        throw new ApiError(404, `Linked Order document not found for orderId: ${payment.orderId}`);
    }

    if (targetStatus === 'Success') {
        order.paymentStatus = 'Paid';
        if (order.fulfillmentStatus === 'Pending') {
            order.fulfillmentStatus = 'Processing';
        }
        await order.save();
    } else if (targetStatus === 'Failed') {
        order.paymentStatus = 'Unpaid';
        await order.save();
    } else if (targetStatus === 'Refunded') {
        order.paymentStatus = 'Refunded';
        order.fulfillmentStatus = 'Cancelled';
        order.cancelledAt = new Date();
        order.cancellationReason = 'Payment refunded';
        await restoreStock(order.items);
        await order.save();
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                paymentId: payment._id,
                orderId: order._id,
                transactionId,
                paymentStatus: payment.status,
                orderPaymentStatus: order.paymentStatus,
                fulfillmentStatus: order.fulfillmentStatus
            },
            `Payment and linked Order successfully updated via webhook (${targetStatus})`
        )
    );
});

/**
 * Verify Razorpay Controller (Client-side callback verification)
 * Decoupled: Updates Payment to 'Success' and Order to 'Paid' upon cryptographic HMAC verification.
 */
const verifyRazorpay = asyncHandler(async (req, res) => {
    // 1. Utilize pre-verified data from paymentVerification middleware if available
    let targetOrder = req.paymentData?.order || null;
    let payment = req.paymentData?.payment || null;
    let isAlreadyPaid = req.paymentData?.isAlreadyPaid || false;
    let isAuthentic = req.paymentData?.isAuthentic || false;

    const razorpay_order_id = req.paymentData?.razorpayOrderId || req.body.razorpay_order_id;
    const razorpay_payment_id = req.paymentData?.razorpayPaymentId || req.body.razorpay_payment_id;
    const razorpay_signature = req.paymentData?.razorpaySignature || req.body.razorpay_signature;
    const orderId = req.body.orderId;
    const userId = req.body.userId;

    // Fallback resolution if called without middleware
    if (!targetOrder) {
        if (!razorpay_order_id && !orderId) {
            throw new ApiError(400, "Missing order identifier");
        }

        if (orderId && mongoose.isValidObjectId(orderId)) {
            targetOrder = await Order.findById(orderId);
        }

        if (!targetOrder && razorpay_order_id) {
            const linkedPayment = await Payment.findOne({ transactionId: razorpay_order_id });
            if (linkedPayment) {
                targetOrder = await Order.findById(linkedPayment.orderId);
            }
        }

        if (!targetOrder) {
            throw new ApiError(404, "Order not found");
        }

        isAlreadyPaid = targetOrder.paymentStatus === 'Paid';
    }

    // 2. Idempotency Check: If already verified and marked Paid, return immediately
    if (isAlreadyPaid || targetOrder.paymentStatus === 'Paid') {
        payment = payment || (await Payment.findOne({ orderId: targetOrder._id }));
        return res.status(200).json(
            new ApiResponse(200, { order: targetOrder, payment }, "Payment already verified successfully (Idempotent)")
        );
    }

    // 3. Cryptographic Signature Verification (fallback if not pre-verified by middleware)
    if (!isAuthentic) {
        if (razorpay_payment_id && razorpay_signature && process.env.RAZORPAY_KEY_SECRET) {
            const expectedSignature = crypto
                .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest("hex");

            if (expectedSignature === razorpay_signature) {
                isAuthentic = true;
            }
        }

        if (!isAuthentic && process.env.ALLOW_MOCK_PAYMENTS === 'true' && (razorpay_signature === 'mock_signature' || razorpay_signature === 'sandbox_verified')) {
            isAuthentic = true;
        }

        if (!isAuthentic && razorpay_order_id) {
            try {
                const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id);
                if (orderInfo && orderInfo.status === "paid") {
                    isAuthentic = true;
                }
            } catch (fetchErr) {
                console.warn("Could not fetch order status directly from Razorpay API:", fetchErr.message);
            }
        }

        if (!isAuthentic) {
            throw new ApiError(400, "Payment verification failed: Invalid cryptographic signature");
        }
    }

    // 5. Update linked Payment document
    if (!payment) {
        payment = await Payment.findOne({
        $or: [
            { orderId: targetOrder._id },
            { transactionId: razorpay_order_id }
        ]
        });
    }

    if (payment) {
        payment.status = 'Success';
        payment.transactionId = razorpay_payment_id || razorpay_order_id;
        payment.gatewayResponse = {
            ...payment.gatewayResponse,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            verifiedAt: new Date()
        };
        await payment.save();
    } else {
        payment = await Payment.create({
            orderId: targetOrder._id,
            userId: targetOrder.userId,
            paymentProvider: 'Razorpay',
            paymentMethod: 'UPI',
            amount: targetOrder.grandTotal,
            currency: currency.toUpperCase(),
            status: 'Success',
            transactionId: razorpay_payment_id || razorpay_order_id,
            gatewayResponse: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
        });
    }

    // 6. Update linked Order document
    targetOrder.paymentStatus = 'Paid';
    if (targetOrder.fulfillmentStatus === 'Pending') {
        targetOrder.fulfillmentStatus = 'Processing';
    }
    await targetOrder.save();

    const currentUserId = userId || targetOrder.userId;
    if (currentUserId) {
        await User.findByIdAndUpdate(currentUserId, { cartData: {} });
    }

    res.status(200).json(
        new ApiResponse(200, { order: targetOrder, payment }, "Payment verified successfully")
    );
});

/**
 * Backward-compatible endpoint: Place order using COD
 * Delegates to the decoupled checkout flow.
 */
const placeOrder = asyncHandler(async (req, res, next) => {
    req.body.paymentProvider = 'COD';
    req.body.paymentMethod = 'Cash';
    return checkout(req, res, next);
});

/**
 * Backward-compatible endpoint: Place order using Razorpay
 * Delegates to the decoupled checkout flow and returns Razorpay gateway session.
 */
const placeOrderRazorpay = asyncHandler(async (req, res, next) => {
    req.body.paymentProvider = 'Razorpay';
    req.body.paymentMethod = req.body.paymentMethod || 'UPI';
    return checkout(req, res, next);
});

/**
 * Public/Buyer endpoint to validate coupons before checkout
 */
const validateCouponEndpoint = asyncHandler(async (req, res) => {
    const { coupon } = req.body;
    const currentUserId = req.user?.id ? req.user.id.toString() : req.body.userId;

    if (!coupon) {
        throw new ApiError(400, "Coupon code is required");
    }

    const validation = await validateCouponHelper(coupon, currentUserId);

    if (!validation.valid) {
        throw new ApiError(400, validation.message);
    }

    res.status(200).json(
        new ApiResponse(200, validation, validation.message)
    );
});

/**
 * All Orders list for Admin Panel & Seller Portal
 */
const allOrders = asyncHandler(async (req, res) => {
    // 3-Tier ACL: Sellers only see their own sales
    if (req.user?.role === 'seller') {
        const sellerId = req.user.id.toString();

        const orders = await Order.find({ "items.sellerId": sellerId })
            .populate('payments')
            .populate({ path: 'items.productId', select: 'category subCategory name price image' })
            .sort({ createdAt: -1 });

        const sellerOrders = orders.map(order => {
            const orderObj = order.toObject({ virtuals: true });
            const vendorItems = (orderObj.items || []).filter(
                item => item.sellerId?.toString() === sellerId
            );
            const vendorSubtotal = vendorItems.reduce(
                (sum, item) => sum + (Number(item.priceAtTimeOfPurchase || item.price || 0) * Number(item.quantity || 1)),
                0
            );

            return {
                ...orderObj,
                items: vendorItems,
                vendorSubtotal
            };
        });

        return res.status(200).json(
            new ApiResponse(200, sellerOrders, "Seller orders fetched successfully")
        );
    }

    // Admins see all orders across the platform
    const orders = await Order.find({})
        .populate('payments')
        .populate({ path: 'items.productId', select: 'category subCategory name price image' })
        .sort({ createdAt: -1 });

    res.status(200).json(
        new ApiResponse(200, orders, "All Orders Fetched Successfully")
    );
});

/**
 * Customer Order History
 */
const userOrders = asyncHandler(async (req, res) => {
    const currentUserId = req.user?.id ? req.user.id.toString() : req.body.userId;
    const requestedUserId = req.targetUserId || req.body.userId || req.query.userId;

    if (!currentUserId) {
        throw new ApiError(400, "User ID is required");
    }

    if (req.user?.role !== 'admin' && requestedUserId && requestedUserId.toString() !== currentUserId) {
        throw new ApiError(403, "Access denied: You can only view your own purchases");
    }

    const orders = await Order.find({ userId: currentUserId })
        .populate('payments')
        .populate({ path: 'items.productId', select: 'category subCategory name price image' })
        .sort({ createdAt: -1 });

    res.status(200).json(
        new ApiResponse(200, orders, "User Orders Fetched successfully")
    );
});

/**
 * Update order status for Admin Panel & Seller Portal
 */
const updateStatus = asyncHandler(async (req, res) => {
    const { orderId, status } = req.body;

    if (!orderId || !status) {
        throw new ApiError(400, "Order ID and status are required");
    }

    if (!mongoose.isValidObjectId(orderId)) {
        throw new ApiError(400, "Invalid Order ID");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    if (req.user?.role === 'seller') {
        const sellerId = req.user.id.toString();
        const hasSellerItem = order.items.some(item => item.sellerId?.toString() === sellerId);
        if (!hasSellerItem) {
            throw new ApiError(403, "Access denied: You can only update orders containing your products");
        }
    }

    // Map legacy status strings to fulfillmentStatus enums
    const statusMap = {
        'Order Placed': 'Pending',
        'Packing': 'Processing',
        'Shipped': 'Shipped',
        'Out for delivery': 'Shipped',
        'Delivered': 'Delivered',
        'Cancelled': 'Cancelled',
        'Pending': 'Pending',
        'Processing': 'Processing'
    };

    const newFulfillmentStatus = statusMap[status] || status;
    order.fulfillmentStatus = newFulfillmentStatus;

    if (newFulfillmentStatus === 'Delivered') {
        order.deliveredAt = new Date();
        // If COD, mark paymentStatus as Paid upon physical delivery
        if (order.paymentStatus === 'Unpaid') {
            const payment = await Payment.findOne({ orderId: order._id });
            if (payment && payment.paymentProvider === 'COD') {
                order.paymentStatus = 'Paid';
                payment.status = 'Success';
                await payment.save();
            }
        }
    } else if (newFulfillmentStatus === 'Cancelled') {
        order.cancelledAt = new Date();
        await restoreStock(order.items);
    }

    await order.save();

    res.status(200).json(
        new ApiResponse(200, order, "Status Updated Successfully")
    );
});

/**
 * Sales Dashboard Analytics for Admin Panel & Seller Portal
 */
const getDashboardStats = asyncHandler(async (req, res) => {
    if (req.user?.role === 'seller') {
        const sellerId = req.user.id.toString();

        const sellerOrders = await Order.find({ "items.sellerId": sellerId }).sort({ createdAt: -1 });
        const totalOrders = sellerOrders.length;
        const deliveredOrders = sellerOrders.filter(o => o.fulfillmentStatus === "Delivered").length;
        const pendingOrders = sellerOrders.filter(o =>
            ["Pending", "Processing", "Shipped"].includes(o.fulfillmentStatus)
        ).length;

        let totalRevenue = 0;
        sellerOrders.forEach(o => {
            if (o.paymentStatus === "Paid" || o.fulfillmentStatus === "Delivered") {
                o.items.forEach(item => {
                    if (item.sellerId?.toString() === sellerId) {
                        totalRevenue += Number(item.priceAtTimeOfPurchase || item.price || 0) * Number(item.quantity || 1);
                    }
                });
            }
        });

        const totalProducts = await Product.countDocuments({ sellerId });

        const stats = {
            totalRevenue,
            totalOrders,
            deliveredOrders,
            pendingOrders,
            totalProducts,
            totalUsers: 0,
            recentOrders: sellerOrders.slice(0, 5).map(o => {
                const obj = o.toObject({ virtuals: true });
                return {
                    ...obj,
                    items: obj.items.filter(i => i.sellerId?.toString() === sellerId)
                };
            })
        };

        return res.status(200).json(
            new ApiResponse(200, stats, "Seller Dashboard metrics fetched successfully")
        );
    }

    // Admin analytics
    const totalOrders = await Order.countDocuments({});
    const deliveredOrders = await Order.countDocuments({ fulfillmentStatus: "Delivered" });
    const pendingOrders = await Order.countDocuments({
        fulfillmentStatus: { $in: ["Pending", "Processing", "Shipped"] }
    });

    const revenueAggregation = await Order.aggregate([
        {
            $match: {
                $or: [{ paymentStatus: "Paid" }, { fulfillmentStatus: "Delivered" }]
            }
        },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$grandTotal" }
            }
        }
    ]);
    const totalRevenue = revenueAggregation[0]?.totalRevenue || 0;

    const razorpayPayments = await Payment.countDocuments({ paymentProvider: "Razorpay" });
    const codPayments = await Payment.countDocuments({ paymentProvider: "COD" });
    const stripePayments = await Payment.countDocuments({ paymentProvider: "Stripe" });

    const totalProducts = await Product.countDocuments({});
    const totalUsers = await User.countDocuments({});

    const recentOrders = await Order.find({})
        .populate('payments')
        .sort({ createdAt: -1 })
        .limit(5);

    const monthlySales = await Order.aggregate([
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m", date: "$createdAt" }
                },
                revenue: { $sum: "$grandTotal" },
                orders: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } },
        { $limit: 6 }
    ]);

    const stats = {
        totalRevenue,
        totalOrders,
        deliveredOrders,
        pendingOrders,
        totalProducts,
        totalUsers,
        paymentDistribution: {
            razorpay: razorpayPayments,
            cod: codPayments,
            stripe: stripePayments
        },
        recentOrders,
        monthlySales
    };

    res.status(200).json(
        new ApiResponse(200, stats, "Dashboard metrics fetched successfully")
    );
});

/**
 * Super Admin Order Deletion & Cancellation
 */
const deleteOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    if (!orderId || !mongoose.isValidObjectId(orderId)) {
        throw new ApiError(400, "Valid Order ID is required");
    }

    if (req.user?.role !== 'admin') {
        throw new ApiError(403, "Access denied: Only Super Admin can delete orders");
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new ApiError(404, "Order not found");
    }

    // Restore inventory
    await restoreStock(order.items);

    // Clean up associated payment ledger records
    await Payment.deleteMany({ orderId });

    await Order.findByIdAndDelete(orderId);

    res.status(200).json(
        new ApiResponse(200, {}, "Order and linked payments deleted successfully")
    );
});

export {
    checkout,
    paymentWebhook,
    verifyRazorpay,
    placeOrder,
    placeOrderRazorpay,
    allOrders,
    userOrders,
    updateStatus,
    getDashboardStats,
    deleteOrder,
    validateCouponEndpoint,
    restoreStock
};
