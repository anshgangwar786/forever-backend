import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from '../db/MongoDB.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { User } from '../models/user.model.js';
import {
    verifyRazorpayPayment,
    verifyWebhookSignature,
    verifyPaymentAmount
} from '../middlewares/paymentVerification.middleware.js';

const runTests = async () => {
    console.log('--- STARTING PAYMENT VERIFICATION MIDDLEWARE UNIT & INTEGRATION TESTS ---\n');

    await connectDB();

    const testSecret = process.env.RAZORPAY_KEY_SECRET || 'test_razorpay_secret_123';
    process.env.RAZORPAY_KEY_SECRET = testSecret;

    const mockUserId1 = new mongoose.Types.ObjectId();
    const mockUserId2 = new mongoose.Types.ObjectId();

    // Setup a mock test order in MongoDB
    const testOrder = await Order.create({
        userId: mockUserId1,
        orderNumber: `ORD-TEST-${Date.now()}`,
        items: [{
            productId: new mongoose.Types.ObjectId(),
            name: "Test Product",
            quantity: 1,
            priceAtTimeOfPurchase: 100
        }],
        subTotal: 100,
        deliveryFee: 10,
        discountAmount: 0,
        grandTotal: 110,
        paymentProvider: 'Razorpay',
        paymentMethod: 'UPI',
        paymentStatus: 'Unpaid',
        fulfillmentStatus: 'Pending',
        shippingAddress: {
            firstName: "John",
            lastName: "Doe",
            phone: "1234567890",
            street: "123 Test St",
            city: "Test City",
            state: "CA",
            zipcode: "90001",
            country: "USA"
        }
    });

    const mockRzpOrderId = `order_test_${Date.now()}`;
    const mockRzpPaymentId = `pay_test_${Date.now()}`;

    // Compute legitimate HMAC signature
    const validSignature = crypto
        .createHmac('sha256', testSecret)
        .update(`${mockRzpOrderId}|${mockRzpPaymentId}`)
        .digest('hex');

    const invalidSignature = 'invalid_tampered_signature_hex_value';

    // Helper to invoke middleware
    const invokeMiddleware = (middleware, req) => {
        return new Promise((resolve, reject) => {
            const res = {
                status: (code) => ({
                    json: (data) => resolve({ statusCode: code, data })
                })
            };
            const next = (err) => {
                if (err) reject(err);
                else resolve({ passed: true, req });
            };
            try {
                middleware(req, res, next);
            } catch (err) {
                reject(err);
            }
        });
    };

    // =========================================================================
    // TEST 1: Valid Razorpay cryptographic signature and order ownership
    // =========================================================================
    console.log('Test 1: Valid HMAC signature with owner authentication...');
    const req1 = {
        body: {
            orderId: testOrder._id.toString(),
            razorpay_order_id: mockRzpOrderId,
            razorpay_payment_id: mockRzpPaymentId,
            razorpay_signature: validSignature
        },
        user: { id: mockUserId1.toString(), role: 'user' }
    };

    const res1 = await invokeMiddleware(verifyRazorpayPayment, req1);
    if (!res1.passed || !req1.paymentData?.isAuthentic) {
        throw new Error('Test 1 Failed: Expected valid paymentData on req');
    }
    console.log('✅ TEST 1 PASSED: Valid signature verified and req.paymentData injected!\n');

    // =========================================================================
    // TEST 2: Tampered / Invalid cryptographic signature rejection
    // =========================================================================
    console.log('Test 2: Tampered / Invalid signature rejection...');
    const req2 = {
        body: {
            orderId: testOrder._id.toString(),
            razorpay_order_id: mockRzpOrderId,
            razorpay_payment_id: mockRzpPaymentId,
            razorpay_signature: invalidSignature
        },
        user: { id: mockUserId1.toString(), role: 'user' }
    };

    let caughtError2 = null;
    try {
        await invokeMiddleware(verifyRazorpayPayment, req2);
    } catch (err) {
        caughtError2 = err;
    }

    if (!caughtError2 || caughtError2.statusCode !== 400) {
        throw new Error(`Test 2 Failed: Expected 400 ApiError, got: ${caughtError2}`);
    }
    console.log('✅ TEST 2 PASSED: Tampered signature rejected with 400 Bad Request!\n');

    // =========================================================================
    // TEST 3: Unauthorized user attempting to verify another user's order
    // =========================================================================
    console.log('Test 3: Authorization check (rejecting mismatched user)...');
    const req3 = {
        body: {
            orderId: testOrder._id.toString(),
            razorpay_order_id: mockRzpOrderId,
            razorpay_payment_id: mockRzpPaymentId,
            razorpay_signature: validSignature
        },
        user: { id: mockUserId2.toString(), role: 'user' } // Different user ID!
    };

    let caughtError3 = null;
    try {
        await invokeMiddleware(verifyRazorpayPayment, req3);
    } catch (err) {
        caughtError3 = err;
    }

    if (!caughtError3 || caughtError3.statusCode !== 403) {
        throw new Error(`Test 3 Failed: Expected 403 Forbidden, got: ${caughtError3}`);
    }
    console.log('✅ TEST 3 PASSED: Unauthorized user rejected with 403 Forbidden!\n');

    // =========================================================================
    // TEST 4: Admin role bypass for order ownership check
    // =========================================================================
    console.log('Test 4: Admin role ownership bypass...');
    const req4 = {
        body: {
            orderId: testOrder._id.toString(),
            razorpay_order_id: mockRzpOrderId,
            razorpay_payment_id: mockRzpPaymentId,
            razorpay_signature: validSignature
        },
        user: { id: mockUserId2.toString(), role: 'admin' } // Admin role
    };

    const res4 = await invokeMiddleware(verifyRazorpayPayment, req4);
    if (!res4.passed || !req4.paymentData?.isAuthentic) {
        throw new Error('Test 4 Failed: Admin should be permitted to verify');
    }
    console.log('✅ TEST 4 PASSED: Admin permitted to verify payment successfully!\n');

    // =========================================================================
    // TEST 5: Webhook Signature Verification
    // =========================================================================
    console.log('Test 5: Webhook HMAC signature verification...');
    const webhookSecret = 'test_webhook_secret_xyz';
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    const webhookBody = { event: 'payment.captured', id: 'pay_wh_123' };
    const rawWebhookPayload = JSON.stringify(webhookBody);
    const validWhSig = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawWebhookPayload)
        .digest('hex');

    const req5Valid = {
        headers: { 'x-razorpay-signature': validWhSig },
        body: webhookBody,
        rawBody: Buffer.from(rawWebhookPayload)
    };

    const res5Valid = await invokeMiddleware(verifyWebhookSignature, req5Valid);
    if (!res5Valid.passed || !req5Valid.webhookData?.verified) {
        throw new Error('Test 5 Failed: Webhook signature should pass');
    }

    const req5Invalid = {
        headers: { 'x-razorpay-signature': 'tampered_webhook_signature' },
        body: webhookBody,
        rawBody: Buffer.from(rawWebhookPayload)
    };

    let caughtError5 = null;
    try {
        await invokeMiddleware(verifyWebhookSignature, req5Invalid);
    } catch (err) {
        caughtError5 = err;
    }

    if (!caughtError5 || caughtError5.statusCode !== 401) {
        throw new Error(`Test 5 Failed: Expected 401 for bad webhook signature, got: ${caughtError5}`);
    }
    console.log('✅ TEST 5 PASSED: Webhook signature successfully validated and forged webhook rejected!\n');

    // =========================================================================
    // TEST 6: Payment Amount Verification (Tampering Protection)
    // =========================================================================
    console.log('Test 6: Payment amount integrity check (against grandTotal)...');
    const req6Matching = {
        paymentData: { order: testOrder },
        body: { amount: 110 }
    };
    const req6Tampered = {
        paymentData: { order: testOrder },
        body: { amount: 10 } // Tampered: only paid $10 instead of $110
    };

    const amountGuard = verifyPaymentAmount();
    await invokeMiddleware(amountGuard, req6Matching);

    let caughtError6 = null;
    try {
        await invokeMiddleware(amountGuard, req6Tampered);
    } catch (err) {
        caughtError6 = err;
    }

    if (!caughtError6 || caughtError6.statusCode !== 400) {
        throw new Error(`Test 6 Failed: Expected 400 for tampered amount, got: ${caughtError6}`);
    }
    console.log('✅ TEST 6 PASSED: Correct amount accepted, tampered amount rejected with 400 Bad Request!\n');

    // Clean up test order
    await Order.findByIdAndDelete(testOrder._id);
    await mongoose.disconnect();

    console.log('🎉 ALL 6 PAYMENT VERIFICATION MIDDLEWARE TESTS PASSED WITH 100% SUCCESS!\n');
};

runTests().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
