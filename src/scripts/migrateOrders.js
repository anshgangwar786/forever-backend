/**
 * Standalone One-Time Data Migration Script
 * Decouples Legacy Combined Orders into Order (Fulfillment) & Payment (Financial Ledger) collections.
 *
 * Usage:
 *   node src/scripts/migrateOrders.js
 *   node src/scripts/migrateOrders.js --dry-run
 *   node src/scripts/migrateOrders.js --force
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import crypto from 'crypto';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_NAME = process.env.DB_NAME || 'ecommerceDB';

// CLI Flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');

// ==========================================
// Mapping Dictionaries & Normalizers
// ==========================================

const mapPaymentProviderAndMethod = (legacyMethod = '') => {
    const raw = (legacyMethod || '').trim().toUpperCase();

    if (raw === 'COD' || raw === 'CASH') {
        return { provider: 'COD', method: 'Cash' };
    }
    if (raw === 'RAZORPAY') {
        return { provider: 'Razorpay', method: 'UPI' };
    }
    if (raw === 'STRIPE') {
        return { provider: 'Stripe', method: 'Credit_Card' };
    }

    return { provider: 'COD', method: 'Cash' };
};

const mapFulfillmentStatus = (legacyStatus = '') => {
    const raw = (legacyStatus || '').trim().toLowerCase();

    switch (raw) {
        case 'order placed':
            return 'Pending';
        case 'packing':
            return 'Processing';
        case 'shipped':
        case 'out for delivery':
            return 'Shipped';
        case 'delivered':
            return 'Delivered';
        case 'cancelled':
            return 'Cancelled';
        case 'pending':
            return 'Pending';
        case 'processing':
            return 'Processing';
        default:
            return 'Pending';
    }
};

const mapPaymentStatus = (legacyOrder) => {
    const isPaidBoolean = Boolean(legacyOrder.payment);
    const legacyStatus = (legacyOrder.status || '').trim().toLowerCase();
    const legacyMethod = (legacyOrder.paymentMethod || '').trim().toUpperCase();

    // If marked paid in legacy document
    if (isPaidBoolean) {
        if (legacyStatus === 'cancelled') {
            return { orderPaymentStatus: 'Refunded', paymentDocStatus: 'Refunded' };
        }
        return { orderPaymentStatus: 'Paid', paymentDocStatus: 'Success' };
    }

    // If COD and already marked Delivered, payment was collected on delivery
    if (legacyMethod === 'COD' && legacyStatus === 'delivered') {
        return { orderPaymentStatus: 'Paid', paymentDocStatus: 'Success' };
    }

    // If order was cancelled before payment
    if (legacyStatus === 'cancelled') {
        return { orderPaymentStatus: 'Unpaid', paymentDocStatus: 'Failed' };
    }

    // Default pending/unpaid
    return { orderPaymentStatus: 'Unpaid', paymentDocStatus: 'Initiated' };
};

const formatLineItems = (rawItems = []) => {
    if (!Array.isArray(rawItems)) return [];

    return rawItems.map((item) => {
        const pid = item.productId || item._id;
        const validProductId = pid && mongoose.isValidObjectId(pid)
            ? new mongoose.Types.ObjectId(pid)
            : new mongoose.Types.ObjectId();

        const validSellerId = item.sellerId && mongoose.isValidObjectId(item.sellerId)
            ? new mongoose.Types.ObjectId(item.sellerId)
            : null;

        return {
            productId: validProductId,
            variantId: item.variantId || item.size || null,
            quantity: Math.max(1, Number(item.quantity) || 1),
            priceAtTimeOfPurchase: Number(item.priceAtTimeOfPurchase || item.price) || 0,
            sellerId: validSellerId,
            name: item.name || 'Product',
            size: item.size || null,
            image: Array.isArray(item.image) ? item.image : (item.image ? [item.image] : []),
            storeName: item.storeName || 'Forever Head Office'
        };
    });
};

const formatShippingAddress = (legacyAddress = {}) => {
    return {
        firstName: (legacyAddress.firstName || legacyAddress.name || 'Customer').trim(),
        lastName: (legacyAddress.lastName || '').trim(),
        email: (legacyAddress.email || '').trim().toLowerCase(),
        phone: (legacyAddress.phone || legacyAddress.mobileNumber || 'N/A').trim(),
        street: (legacyAddress.street || legacyAddress.addressLine1 || 'N/A').trim(),
        city: (legacyAddress.city || 'N/A').trim(),
        state: (legacyAddress.state || 'N/A').trim(),
        zipcode: (legacyAddress.zipcode || legacyAddress.zip || '000000').trim(),
        country: (legacyAddress.country || 'India').trim()
    };
};

const generateOrderNumber = (legacyOrder) => {
    if (legacyOrder.orderNumber) {
        return legacyOrder.orderNumber;
    }
    const dateSource = legacyOrder.date
        ? new Date(legacyOrder.date)
        : (legacyOrder.createdAt ? new Date(legacyOrder.createdAt) : new Date());

    const dateStr = dateSource.toISOString().slice(0, 10).replace(/-/g, '');
    const idSuffix = legacyOrder._id.toString().slice(-4).toUpperCase();
    return `ORD-${dateStr}-${idSuffix}`;
};

// ==========================================
// Main Migration Engine
// ==========================================

const runMigration = async () => {
    console.log('\n======================================================');
    console.log('📦 E-Commerce Architecture Decoupling: Order & Payment');
    console.log('======================================================');
    if (isDryRun) {
        console.log('🔍 MODE: DRY-RUN (Previewing changes only - no DB writes)\n');
    } else {
        console.log('🚀 MODE: LIVE MIGRATION (Mutating database)\n');
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI is not defined in environment variables.');
        process.exit(1);
    }

    let connectionString;
    if (uri.includes('?')) {
        const [base, query] = uri.split('?');
        const cleanBase = base.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`)
            ? `${cleanBase}?${query}`
            : `${cleanBase}/${DB_NAME}?${query}`;
    } else {
        const cleanBase = uri.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`)
            ? cleanBase
            : `${cleanBase}/${DB_NAME}`;
    }

    console.log(`⏳ Connecting to MongoDB database '${DB_NAME}'...`);
    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 8000 });
    console.log(`✅ MongoDB Connection established.\n`);

    const db = mongoose.connection.db;
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');

    // Retrieve all legacy order documents
    const totalOrders = await ordersCollection.countDocuments({});
    console.log(`📊 Discovered ${totalOrders} order records in 'orders' collection.`);

    if (totalOrders === 0) {
        console.log('✨ No orders found to migrate. Exiting.');
        await mongoose.disconnect();
        return;
    }

    const legacyOrders = await ordersCollection.find({}).toArray();

    const stats = {
        scanned: totalOrders,
        migrated: 0,
        skipped: 0,
        paymentsCreated: 0,
        errors: 0
    };

    const previewTable = [];

    for (const order of legacyOrders) {
        try {
            // Check if already decoupled
            const isAlreadyDecoupled =
                !isForce &&
                order.fulfillmentStatus &&
                order.paymentStatus &&
                order.orderNumber &&
                order.grandTotal !== undefined;

            const existingPayment = await paymentsCollection.findOne({ orderId: order._id });

            if (isAlreadyDecoupled && existingPayment) {
                stats.skipped += 1;
                continue;
            }

            // 1. Extract Financial & Fulfillment Data
            const amount = Number(order.amount) || 0;
            const deliveryCharge = Number(order.deliveryCharge) || 0;
            const discountAmount = Number(order.discountAmount) || 0;
            const taxAmount = 0;
            const subTotal = Number(
                (order.subTotal !== undefined
                    ? order.subTotal
                    : Math.max(0, amount - deliveryCharge + discountAmount)
                ).toFixed(2)
            );
            const grandTotal = amount;

            // 2. Map Payment Provider, Method & Statuses
            const { provider, method } = mapPaymentProviderAndMethod(order.paymentMethod);
            const fulfillmentStatus = mapFulfillmentStatus(order.status);
            const { orderPaymentStatus, paymentDocStatus } = mapPaymentStatus(order);

            // 3. Format Subdocuments
            const orderNumber = generateOrderNumber(order);
            const structuredItems = formatLineItems(order.items || []);
            const shippingAddress = formatShippingAddress(order.address || order.shippingAddress || {});

            const validUserId = order.userId && mongoose.isValidObjectId(order.userId)
                ? new mongoose.Types.ObjectId(order.userId)
                : new mongoose.Types.ObjectId();

            const transactionId =
                order.razorpayPaymentId ||
                order.razorpayOrderId ||
                `LEGACY-TXN-${order._id.toString()}`;

            const paymentDoc = {
                orderId: order._id,
                userId: validUserId,
                paymentProvider: provider,
                paymentMethod: method,
                amount: grandTotal,
                currency: 'USD',
                status: paymentDocStatus,
                transactionId,
                gatewayResponse: {
                    migratedFromLegacy: true,
                    originalPaymentMethod: order.paymentMethod,
                    originalPaymentBoolean: order.payment,
                    originalStatus: order.status,
                    migratedAt: new Date()
                },
                errorMessage: paymentDocStatus === 'Failed' ? 'Order cancelled in legacy ledger' : null,
                createdAt: order.createdAt || new Date(order.date || Date.now()),
                updatedAt: new Date()
            };

            const orderUpdates = {
                userId: validUserId,
                orderNumber,
                items: structuredItems,
                subTotal,
                taxAmount,
                shippingCost: deliveryCharge,
                discountAmount,
                grandTotal,
                shippingAddress,
                fulfillmentStatus,
                paymentStatus: orderPaymentStatus,
                // Preserved backward compatibility fields
                amount: grandTotal,
                status: fulfillmentStatus,
                payment: orderPaymentStatus === 'Paid',
                updatedAt: new Date()
            };

            previewTable.push({
                OrderId: order._id.toString().slice(-8),
                OrderNum: orderNumber,
                Items: structuredItems.length,
                GrandTotal: `$${grandTotal}`,
                Fulfillment: `${order.status || 'N/A'} ➔ ${fulfillmentStatus}`,
                Payment: `${order.payment ? 'True' : 'False'} ➔ ${orderPaymentStatus}`,
                Provider: `${order.paymentMethod || 'N/A'} ➔ ${provider}/${method}`,
                PayStatus: paymentDocStatus
            });

            if (!isDryRun) {
                // Upsert Payment Ledger Document
                await paymentsCollection.updateOne(
                    { orderId: order._id },
                    { $set: paymentDoc },
                    { upsert: true }
                );
                stats.paymentsCreated += 1;

                // Update Order Document with Decoupled Fulfillment Schema
                await ordersCollection.updateOne(
                    { _id: order._id },
                    { $set: orderUpdates }
                );
                stats.migrated += 1;
            } else {
                stats.migrated += 1;
                stats.paymentsCreated += 1;
            }
        } catch (err) {
            stats.errors += 1;
            console.error(`❌ Error migrating order ${order._id}:`, err.message);
        }
    }

    console.log('📋 Migration Transformation Preview:');
    console.table(previewTable);

    console.log('\n======================================================');
    console.log('🏁 Migration Summary');
    console.log('======================================================');
    console.log(`• Total Orders Scanned:     ${stats.scanned}`);
    console.log(`• Orders Migrated:          ${stats.migrated}`);
    console.log(`• Payment Records Created:  ${stats.paymentsCreated}`);
    console.log(`• Orders Already Decoupled: ${stats.skipped}`);
    console.log(`• Errors Encountered:       ${stats.errors}`);

    if (isDryRun) {
        console.log('\n💡 Dry run completed successfully! Run without --dry-run to commit changes.');
    } else {
        console.log('\n🎉 Decoupling migration completed successfully!');
    }

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.\n');
};

// Execute script
runMigration().catch((err) => {
    console.error('💥 Fatal Migration Error:', err);
    process.exit(1);
});
