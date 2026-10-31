import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { app } from '../app.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { User } from '../models/user.model.js';
import { Product } from '../models/product.model.js';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const runIntegrationTest = async () => {
    console.log('🧪 Starting End-to-End Test of Decoupled Checkout Architecture...\n');

    const uri = process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
    let connectionString;
    if (uri.includes('?')) {
        const [base, query] = uri.split('?');
        const cleanBase = base.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`) ? `${cleanBase}?${query}` : `${cleanBase}/${DB_NAME}?${query}`;
    } else {
        const cleanBase = uri.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`) ? cleanBase : `${cleanBase}/${DB_NAME}`;
    }

    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ Connected to MongoDB Atlas');

    // 1. Locate or create a test buyer user
    let user = await User.findOne({ role: 'user' });
    if (!user) {
        user = await User.create({
            name: 'Test Buyer',
            email: `testbuyer_${Date.now()}@example.com`,
            password: 'password123',
            role: 'user'
        });
    }

    const token = jwt.sign(
        { id: user._id.toString(), email: user.email, role: 'user' },
        process.env.JWT_TOKEN_SECRET || 'secret',
        { expiresIn: '1h' }
    );

    // 2. Locate or create a test product
    let product = await Product.findOne({ stock: { $gt: 5 } });
    if (!product) {
        product = await Product.create({
            name: 'Integration Test Hoodie',
            description: 'Test apparel',
            price: 45,
            image: ['https://example.com/hoodie.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            stock: 20,
            date: Date.now()
        });
    }

    console.log(`👤 Test User: ${user.name} (${user._id})`);
    console.log(`🛍️ Test Product: ${product.name} - $${product.price} (Stock: ${product.stock})`);

    const { checkout, paymentWebhook } = await import('../controllers/order.controller.js');

    // Helper to invoke Express middleware and await response
    const invokeHandler = (handler, req) => {
        return new Promise((resolve, reject) => {
            const res = {
                statusCode: 200,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(payload) {
                    resolve({ statusCode: this.statusCode, payload });
                    return this;
                }
            };
            handler(req, res, (err) => {
                if (err) reject(err);
            });
        });
    };

    // ==========================================
    // Test 1: POST /checkout Controller Execution
    // ==========================================
    console.log('\n--- TEST 1: Executing POST /checkout ---');

    const checkoutReq = {
        headers: { token, 'idempotency-key': `test-idemp-${Date.now()}` },
        user: { id: user._id.toString(), role: 'user' },
        body: {
            items: [
                {
                    productId: product._id.toString(),
                    quantity: 2,
                    price: product.price,
                    size: 'L'
                }
            ],
            shippingAddress: {
                firstName: 'Alice',
                lastName: 'Smith',
                email: 'alice@example.com',
                phone: '+1-555-0199',
                street: '123 Market St',
                city: 'San Francisco',
                state: 'CA',
                zipcode: '94103',
                country: 'USA'
            },
            paymentProvider: 'COD',
            paymentMethod: 'Cash'
        }
    };

    const checkoutRes = await invokeHandler(checkout, checkoutReq);

    console.log(`Response Status: ${checkoutRes.statusCode}`);
    console.log(`Success Flag: ${checkoutRes.payload?.success}`);
    console.log(`Order Number: ${checkoutRes.payload?.data?.order?.orderNumber}`);
    console.log(`Order Fulfillment Status: ${checkoutRes.payload?.data?.order?.fulfillmentStatus}`);
    console.log(`Order Payment Status: ${checkoutRes.payload?.data?.order?.paymentStatus}`);
    console.log(`Payment Status (Ledger): ${checkoutRes.payload?.data?.payment?.status}`);
    console.log(`Payment Provider: ${checkoutRes.payload?.data?.payment?.paymentProvider}`);
    console.log(`Payment Transaction ID: ${checkoutRes.payload?.data?.payment?.transactionId}`);

    if (
        checkoutRes.statusCode !== 201 ||
        checkoutRes.payload?.data?.order?.paymentStatus !== 'Unpaid' ||
        checkoutRes.payload?.data?.payment?.status !== 'Initiated'
    ) {
        throw new Error('Test 1 Failed: Order should be Unpaid and Payment should be Initiated.');
    }
    console.log('✅ TEST 1 PASSED: Order created as Unpaid and Payment immediately created as Initiated!');

    const createdOrder = checkoutRes.payload.data.order;
    const createdPayment = checkoutRes.payload.data.payment;

    // ==========================================
    // Test 2: Webhook Controller (Payment Succeeded)
    // ==========================================
    console.log('\n--- TEST 2: Executing Payment Webhook (Success) ---');

    const webhookSuccessReq = {
        headers: {},
        body: {
            transactionId: createdPayment.transactionId,
            status: 'success',
            gatewayOrderId: createdPayment.transactionId,
            gatewayPaymentId: `pay_mock_${Date.now()}`,
            amount: createdPayment.amount,
            notes: 'Test gateway success webhook'
        }
    };

    const webhookSuccessRes = await invokeHandler(paymentWebhook, webhookSuccessReq);

    console.log(`Webhook Status Code: ${webhookSuccessRes.statusCode}`);
    console.log(`Updated Payment Status: ${webhookSuccessRes.payload?.data?.paymentStatus}`);
    console.log(`Updated Order Payment Status: ${webhookSuccessRes.payload?.data?.orderPaymentStatus}`);
    console.log(`Updated Order Fulfillment Status: ${webhookSuccessRes.payload?.data?.fulfillmentStatus}`);

    // Verify in database directly
    const dbPayment = await Payment.findById(createdPayment._id);
    const dbOrder = await Order.findById(createdOrder._id);

    console.log(`Direct DB Payment Status: ${dbPayment.status}`);
    console.log(`Direct DB Order Payment Status: ${dbOrder.paymentStatus}`);

    if (dbPayment.status !== 'Success' || dbOrder.paymentStatus !== 'Paid') {
        throw new Error('Test 2 Failed: DB Payment should be Success and DB Order should be Paid.');
    }
    console.log('✅ TEST 2 PASSED: Webhook updated Payment to Success and Order paymentStatus to Paid!');

    // ==========================================
    // Test 3: Webhook Controller (Payment Failed)
    // ==========================================
    console.log('\n--- TEST 3: Executing Payment Webhook (Failure Scenario) ---');

    // Create a new order & payment to test failure webhook
    checkoutReq.headers['idempotency-key'] = `test-idemp-fail-${Date.now()}`;
    const checkoutFailRes = await invokeHandler(checkout, checkoutReq);

    const failedOrder = checkoutFailRes.payload.data.order;
    const failedPayment = checkoutFailRes.payload.data.payment;

    const webhookFailedReq = {
        headers: {},
        body: {
            transactionId: failedPayment.transactionId,
            status: 'failed',
            errorMessage: 'Customer card declined by bank network'
        }
    };

    const webhookFailRes = await invokeHandler(paymentWebhook, webhookFailedReq);

    const dbFailedPayment = await Payment.findById(failedPayment._id);
    const dbFailedOrder = await Order.findById(failedOrder._id);

    console.log(`Failed Payment Status: ${dbFailedPayment.status}`);
    console.log(`Failed Payment Error Message: ${dbFailedPayment.errorMessage}`);
    console.log(`Failed Order Payment Status: ${dbFailedOrder.paymentStatus}`);

    if (dbFailedPayment.status !== 'Failed' || dbFailedOrder.paymentStatus !== 'Unpaid') {
        throw new Error('Test 3 Failed: Payment should be Failed and Order should remain Unpaid.');
    }
    console.log('✅ TEST 3 PASSED: Webhook updated Payment to Failed with error message and Order to Unpaid!');

    // Clean up test orders and payments
    await Payment.deleteMany({ _id: { $in: [createdPayment._id, failedPayment._id] } });
    await Order.deleteMany({ _id: { $in: [createdOrder._id, failedOrder._id] } });
    console.log('\n🧹 Cleaned up temporary test documents.');

    await mongoose.disconnect();
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
};

runIntegrationTest().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
