import crypto from 'crypto';
import mongoose from 'mongoose';
import razorpay from 'razorpay';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Lazy-initialized Razorpay instance for API-level verification fallbacks
const getRazorpayInstance = () => {
    return new razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
        key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
    });
};

/**
 * Constant-time HMAC SHA256 signature verification helper
 * Prevents timing attacks on cryptographic signature validation.
 */
const verifyHmacSha256 = (payload, providedSignature, secret) => {
    if (!payload || !providedSignature || !secret) return false;
    try {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const providedBuffer = Buffer.from(providedSignature, 'utf8');

        if (expectedBuffer.length !== providedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    } catch (err) {
        return false;
    }
};

/**
 * Middleware: Verify Razorpay Client Payment Callback
 * 
 * Cryptographically validates the Razorpay payment response payload:
 * 1. Checks presence of razorpay_order_id, razorpay_payment_id, and razorpay_signature.
 * 2. Computes and validates HMAC-SHA256 signature (with timing-safe comparison).
 * 3. Fallback check via Razorpay Gateway REST API if HMAC fails or secret is rotated.
 * 4. Resolves target Order & Payment documents from the database.
 * 5. Enforces security / ownership: Ensures requester owns the order (or is Admin).
 * 6. Checks idempotency (if order is already Paid).
 * 7. Injects verified data into `req.paymentData` for downstream controller handlers.
 */
export const verifyRazorpayPayment = asyncHandler(async (req, res, next) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        orderId
    } = req.body;

    // 1. Basic payload integrity check
    if (!razorpay_order_id && !orderId) {
        throw new ApiError(400, "Missing required payment order identifier (razorpay_order_id or orderId)");
    }

    // 2. Resolve Target Order
    let targetOrder = null;
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
        throw new ApiError(404, "Target order associated with this payment could not be found");
    }

    // 3. Authorization & Ownership Guard
    // If request has authenticated user, ensure they own the order unless admin
    if (req.user) {
        const requesterId = req.user.id || req.user._id;
        const isAdmin = req.user.role === 'admin' || req.role === 'admin';
        if (!isAdmin && requesterId && targetOrder.userId.toString() !== requesterId.toString()) {
            throw new ApiError(403, "Access denied: You do not have permission to verify payment for this order");
        }
    }

    // 4. Idempotency Check: Order already confirmed paid
    const isAlreadyPaid = targetOrder.paymentStatus === 'Paid';

    // The gateway order being verified must be the one created for THIS order; otherwise a valid
    // signature/paid status from a different (cheaper) order could mark this one as paid.
    if (!isAlreadyPaid) {
        const ownPayment = await Payment.findOne({ orderId: targetOrder._id, paymentProvider: 'Razorpay' });
        if (!ownPayment || !razorpay_order_id || ownPayment.transactionId !== razorpay_order_id) {
            throw new ApiError(400, "Payment verification failed: payment does not belong to this order");
        }
    }

    // 5. Cryptographic Signature Verification
    let isAuthentic = false;

    if (razorpay_payment_id && razorpay_signature && process.env.RAZORPAY_KEY_SECRET) {
        const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
        isAuthentic = verifyHmacSha256(payload, razorpay_signature, process.env.RAZORPAY_KEY_SECRET);
    }

    // Test-only shortcut; must be explicitly enabled and is never on by default
    if (!isAuthentic && process.env.ALLOW_MOCK_PAYMENTS === 'true' && (razorpay_signature === 'mock_signature' || razorpay_signature === 'sandbox_verified')) {
        isAuthentic = true;
    }

    // Gateway API Verification Fallback (e.g. if secret differs or direct query needed)
    if (!isAuthentic && razorpay_order_id && !isAlreadyPaid) {
        try {
            const rzp = getRazorpayInstance();
            const orderInfo = await rzp.orders.fetch(razorpay_order_id);
            if (orderInfo && (orderInfo.status === 'paid' || orderInfo.amount_paid > 0)) {
                isAuthentic = true;
            }
        } catch (fetchErr) {
            console.warn("[PaymentVerificationMiddleware] Razorpay API fallback fetch error:", fetchErr.message);
        }
    }

    // If already marked Paid in DB, allow request through with idempotency flag
    if (!isAuthentic && !isAlreadyPaid) {
        throw new ApiError(400, "Payment verification failed: Invalid cryptographic signature or unauthorized callback");
    }

    // 6. Resolve or prepare Payment document
    let payment = await Payment.findOne({
        $or: [
            { orderId: targetOrder._id },
            { transactionId: razorpay_order_id }
        ]
    });

    // 7. Inject verified context into req for downstream handlers
    req.paymentData = {
        isAuthentic: true,
        order: targetOrder,
        payment,
        isAlreadyPaid,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature
    };

    next();
});

/**
 * Middleware: Verify Payment Gateway Webhook Signatures
 * 
 * Verifies authenticity of incoming webhooks from Razorpay or Stripe
 * before any database updates occur. Rejects spoofed or unsigned webhook payloads.
 */
export const verifyWebhookSignature = asyncHandler(async (req, res, next) => {
    const razorpaySignature = req.headers['x-razorpay-signature'];
    const stripeSignature = req.headers['stripe-signature'];
    const rawPayload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

    let isWebhookValid = false;
    let provider = 'Unknown';

    // 1. Razorpay Webhook Signature Verification
    if (razorpaySignature) {
        provider = 'Razorpay';
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!webhookSecret) {
            // Fail closed: without a secret anyone could forge "payment captured" webhooks
            throw new ApiError(503, "Razorpay webhooks are not configured (RAZORPAY_WEBHOOK_SECRET missing)");
        } else {
            isWebhookValid = verifyHmacSha256(rawPayload, razorpaySignature, webhookSecret);
            if (!isWebhookValid) {
                throw new ApiError(401, "Webhook signature verification failed: Invalid x-razorpay-signature");
            }
        }
    }
    // 2. Stripe Webhook Signature Verification
    else if (stripeSignature) {
        provider = 'Stripe';
        const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!stripeSecret) {
            throw new ApiError(503, "Stripe webhooks are not configured (STRIPE_WEBHOOK_SECRET missing)");
        } else {
            try {
                // If Stripe SDK is available, constructEvent verifies signature & timestamp
                const Stripe = (await import('stripe')).default;
                const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'dummy_key');
                const event = stripe.webhooks.constructEvent(rawPayload, stripeSignature, stripeSecret);
                req.stripeEvent = event;
                isWebhookValid = true;
            } catch (stripeErr) {
                throw new ApiError(401, `Stripe webhook verification failed: ${stripeErr.message}`);
            }
        }
    }
    // 3. Direct/Internal API Calls (e.g. from tests or trusted internal callers)
    else {
        // If neither header is present, check if internal signature or test request
        if (process.env.ALLOW_UNSIGNED_WEBHOOKS !== 'true') {
            throw new ApiError(400, "Missing payment gateway webhook signature header");
        }
        isWebhookValid = true;
        provider = 'Direct/Test';
    }

    req.webhookData = {
        verified: isWebhookValid,
        provider,
        receivedAt: new Date()
    };

    next();
});

/**
 * Middleware: Verify Payment Amount Integrity
 * Ensures that the amount charged by the payment gateway matches the order's grandTotal.
 * Prevents client-side parameter tampering (e.g. changing $500 to $5).
 */
export const verifyPaymentAmount = (tolerance = 0.01) => {
    return (req, res, next) => {
        const order = req.paymentData?.order;
        const amountReceived = Number(req.body.amount || req.body.paidAmount);

        if (order && !isNaN(amountReceived)) {
            const expectedAmount = Number(order.grandTotal);
            const difference = Math.abs(expectedAmount - amountReceived);

            if (difference > tolerance) {
                throw new ApiError(
                    400,
                    `Payment amount mismatch: Expected $${expectedAmount.toFixed(2)}, but received $${amountReceived.toFixed(2)}`
                );
            }
        }

        next();
    };
};
