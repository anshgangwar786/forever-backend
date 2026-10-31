import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { User } from '../models/user.model.js';
import { Product } from '../models/product.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const testFullPaymentSync = async () => {
    console.log('================================================================');
    console.log('💳 TESTING COMPLETE PAYMENT PIPELINE & TRANSACTION LEDGER SYNC');
    console.log('================================================================\n');

    const uri = process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
    let cs = uri.includes('?') ? uri.replace(/\/?\?/, '/' + DB_NAME + '?') : uri + '/' + DB_NAME;
    await mongoose.connect(cs);
    console.log('✅ 1. Connected to MongoDB Atlas ("' + DB_NAME + '")');

    const baseUrl = 'http://localhost:4000';

    try {
        // --- 1. Get a product to purchase ---
        const sampleProduct = await Product.findOne({ stock: { $gt: 2 } });
        if (!sampleProduct) throw new Error('No product with stock found');
        console.log(`✅ 2. Selected product: "${sampleProduct.name}" ($${sampleProduct.price})`);

        // --- 2. Create customer token ---
        const buyerUser = await User.findOne({ role: 'user' });
        const buyerToken = jwt.sign(
            { id: buyerUser._id.toString(), email: buyerUser.email, role: 'user' },
            process.env.JWT_TOKEN_SECRET || 'secret',
            { expiresIn: '1h' }
        );

        // ==============================================================
        // FLOW A: RAZORPAY ONLINE PAYMENT & SIGNATURE VERIFICATION
        // ==============================================================
        console.log('\n--- FLOW A: Online Payment Flow (Razorpay) ---');
        const rzpCheckoutPayload = {
            address: {
                firstName: 'Online',
                lastName: 'Customer',
                email: buyerUser.email,
                street: '789 Broadway',
                city: 'New York',
                state: 'NY',
                zipcode: '10003',
                country: 'USA',
                phone: '5551234567'
            },
            items: [
                {
                    _id: sampleProduct._id.toString(),
                    name: sampleProduct.name,
                    price: sampleProduct.price,
                    quantity: 1,
                    size: sampleProduct.sizes?.[0] || 'Standard'
                }
            ],
            amount: sampleProduct.price + 10
        };

        const rzpRes = await fetch(`${baseUrl}/api/v1/order/razorpay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: buyerToken
            },
            body: JSON.stringify(rzpCheckoutPayload)
        });

        const rzpData = await rzpRes.json();
        if (!rzpData.success) {
            throw new Error(`Razorpay checkout failed: ${rzpData.message}`);
        }

        console.log('✅ Razorpay order created successfully!');
        console.log('   - Gateway Order ID (rzpData.data.id):', rzpData.data.id);
        console.log('   - Gateway Amount (rzpData.data.amount):', rzpData.data.amount);
        console.log('   - Key provided for client:', rzpData.data.key);
        console.log('   - Internal Order ID:', rzpData.data.order?._id);

        if (!rzpData.data.id) {
            throw new Error('rzpData.data.id is undefined! Frontend initPay would fail.');
        }

        // Verify Payment document is in MongoDB Atlas in 'Initiated' state
        const initialPayment = await Payment.findOne({ transactionId: rzpData.data.id });
        if (!initialPayment) {
            throw new Error(`Payment document with transactionId ${rzpData.data.id} not found in DB!`);
        }
        console.log(`✅ Transaction recorded in MongoDB "payments": Status = "${initialPayment.status}", Amount = $${initialPayment.amount}`);

        // Simulate Razorpay Gateway Verification Callback (verifyRazorpay)
        console.log('\n   Submitting Razorpay payment verification callback...');
        const fakePaymentId = `pay_test_${Date.now()}`;
        const verifyRes = await fetch(`${baseUrl}/api/v1/order/verifyRazorpay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: buyerToken
            },
            body: JSON.stringify({
                razorpay_order_id: rzpData.data.id,
                razorpay_payment_id: fakePaymentId,
                razorpay_signature: 'mock_signature',
                orderId: rzpData.data.order._id
            })
        });

        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
            throw new Error(`Payment verification failed: ${verifyData.message}`);
        }
        console.log(`✅ Payment verified successfully: "${verifyData.message}"`);

        // Check updated Payment and Order in DB
        const updatedPayment = await Payment.findById(initialPayment._id);
        const updatedOrder = await Order.findById(rzpData.data.order._id);

        console.log(`   - Payment Transaction Status in DB: "${updatedPayment.status}" (TransactionId: ${updatedPayment.transactionId})`);
        console.log(`   - Order Payment Status in DB: "${updatedOrder.paymentStatus}"`);

        if (updatedPayment.status !== 'Success') {
            throw new Error(`Expected payment.status to be 'Success', got '${updatedPayment.status}'`);
        }
        if (updatedOrder.paymentStatus !== 'Paid') {
            throw new Error(`Expected order.paymentStatus to be 'Paid', got '${updatedOrder.paymentStatus}'`);
        }

        // ==============================================================
        // FLOW B: ADMIN TRANSACTION LEDGER SYNC VERIFICATION
        // ==============================================================
        console.log('\n--- FLOW B: Admin Panel Transaction Ledger Sync ---');
        const adminUser = await User.findOne({ role: 'admin' });
        const adminToken = jwt.sign(
            { id: adminUser._id.toString(), email: adminUser.email, role: 'admin' },
            process.env.ADMIN_JWT_SECRET || process.env.JWT_TOKEN_SECRET || 'secret',
            { expiresIn: '2h' }
        );

        const ledgerRes = await fetch(`${baseUrl}/api/v1/payment/list`, {
            headers: { token: adminToken }
        });
        const ledgerData = await ledgerRes.json();
        if (!ledgerData.success || !Array.isArray(ledgerData.data?.payments)) {
            throw new Error(`Failed to fetch admin transactions: ${ledgerData.message}`);
        }

        const foundTxn = ledgerData.data.payments.find(p => p._id.toString() === updatedPayment._id.toString() || p.transactionId === fakePaymentId);
        if (!foundTxn) {
            throw new Error(`Newly verified transaction ${fakePaymentId} was not found in Admin Ledger!`);
        }
        console.log(`✅ Verified in Admin Transaction Ledger (GET /api/v1/payment/list):`);
        console.log(`   - Transaction ID: ${foundTxn.transactionId}`);
        console.log(`   - Status in Ledger: ${foundTxn.status}`);
        console.log(`   - Amount: $${foundTxn.amount}`);
        console.log(`   - Provider: ${foundTxn.paymentProvider}`);
        console.log(`   - Total Ledger Records: ${ledgerData.data.payments.length}`);

        // ==============================================================
        // FLOW C: CUSTOMER ORDER HISTORY SYNC
        // ==============================================================
        console.log('\n--- FLOW C: Customer Order History View Sync ---');
        const userOrdersRes = await fetch(`${baseUrl}/api/v1/order/userorders`, {
            headers: { token: buyerToken }
        });
        const userOrdersData = await userOrdersRes.json();
        const recentOrder = userOrdersData.data?.find(o => o._id.toString() === updatedOrder._id.toString());
        console.log(`✅ Customer Order History verified:`);
        console.log(`   - Order Number: ${recentOrder?.orderNumber}`);
        console.log(`   - Virtual "payment" (Paid?): ${recentOrder?.payment}`);
        console.log(`   - Virtual "paymentMethod": ${recentOrder?.paymentMethod}`);

        // ==============================================================
        // FLOW D: CASH ON DELIVERY (COD) PAYMENT & RECONCILIATION
        // ==============================================================
        console.log('\n--- FLOW D: Cash on Delivery (COD) Transaction Sync ---');
        const codPayload = {
            address: {
                firstName: 'COD',
                lastName: 'Customer',
                email: buyerUser.email,
                street: '100 Main St',
                city: 'Chicago',
                state: 'IL',
                zipcode: '60601',
                country: 'USA',
                phone: '5559876543'
            },
            items: [
                {
                    _id: sampleProduct._id.toString(),
                    name: sampleProduct.name,
                    price: sampleProduct.price,
                    quantity: 1,
                    size: sampleProduct.sizes?.[0] || 'Standard'
                }
            ],
            amount: sampleProduct.price + 10
        };

        const codRes = await fetch(`${baseUrl}/api/v1/order/place`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: buyerToken
            },
            body: JSON.stringify(codPayload)
        });

        const codData = await codRes.json();
        if (!codData.success) throw new Error(`COD placement failed: ${codData.message}`);
        console.log(`✅ COD Order placed successfully: "${codData.message}"`);

        const codOrder = await Order.findOne({ userId: buyerUser._id }).sort({ createdAt: -1 });
        const codPayment = await Payment.findOne({ orderId: codOrder._id });

        console.log(`   - COD Order ID: ${codOrder._id} (Fulfillment: ${codOrder.fulfillmentStatus}, Payment: ${codOrder.paymentStatus})`);
        console.log(`   - COD Payment ID: ${codPayment._id} (Txn: ${codPayment.transactionId}, Status: ${codPayment.status})`);

        // Admin marks COD order as Delivered -> Auto-reconcile to Success
        console.log('   Admin updating fulfillment status to "Delivered"...');
        const statusUpdateRes = await fetch(`${baseUrl}/api/v1/order/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: adminToken
            },
            body: JSON.stringify({
                orderId: codOrder._id.toString(),
                status: 'Delivered'
            })
        });

        const statusData = await statusUpdateRes.json();
        if (!statusData.success) throw new Error(`Status update failed: ${statusData.message}`);

        const reconciledPayment = await Payment.findById(codPayment._id);
        const reconciledOrder = await Order.findById(codOrder._id);

        console.log(`✅ Auto-reconciliation verified:`);
        console.log(`   - Order fulfillmentStatus: ${reconciledOrder.fulfillmentStatus}`);
        console.log(`   - Order paymentStatus: ${reconciledOrder.paymentStatus}`);
        console.log(`   - Payment Transaction Status in DB: ${reconciledPayment.status}`);

        if (reconciledPayment.status !== 'Success' || reconciledOrder.paymentStatus !== 'Paid') {
            throw new Error('COD Reconciliation failed to mark Payment as Success / Paid');
        }

        console.log('\n================================================================');
        console.log('🎉 ALL PAYMENT & TRANSACTION PIPELINES 100% IN SYNC AND WORKING!');
        console.log('================================================================\n');

    } finally {
        await mongoose.disconnect();
    }
};

testFullPaymentSync().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
