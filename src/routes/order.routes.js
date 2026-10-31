import { Router } from 'express';
import {
    checkout,
    paymentWebhook,
    placeOrder,
    placeOrderRazorpay,
    allOrders,
    userOrders,
    updateStatus,
    verifyRazorpay,
    getDashboardStats,
    deleteOrder,
    validateCouponEndpoint
} from '../controllers/order.controller.js';
import adminAuth from '../middlewares/adminAuth.js';
import authUser from '../middlewares/auth.js';
import { authorizeRoles, restrictRoles } from '../middlewares/acl.middleware.js';
import { verifyRazorpayPayment, verifyWebhookSignature } from '../middlewares/paymentVerification.middleware.js';

const router = Router();

// Guard for consumer checkout & order placement (Admins & Sellers blocked)
const buyerOnlyGuard = [authUser, restrictRoles(['admin', 'seller'], "Admins and Sellers do not place consumer orders")];

// ========================================================
// Task 2: Core Decoupled Checkout & Payment Webhook Routes
// ========================================================

// POST /checkout (and /api/v1/order/checkout)
router.route('/checkout').post(buyerOnlyGuard, checkout);

// Payment Webhook endpoint for Razorpay, Stripe, and external gateways
router.route('/webhook').post(verifyWebhookSignature, paymentWebhook);

// ========================================================
// Backward-compatible Place Order Routes
// ========================================================
router.route('/place').post(buyerOnlyGuard, placeOrder);
router.route('/razorpay').post(buyerOnlyGuard, placeOrderRazorpay);
router.route('/verifyRazorpay').post(authUser, verifyRazorpayPayment, verifyRazorpay);

// ========================================================
// Order History & Management
// ========================================================
router.route('/validate-coupon').post(authUser, validateCouponEndpoint);
router.route('/userorders').get(authUser, userOrders).post(authUser, userOrders);

// Admin & Seller Management Features
router.route('/list').get(adminAuth, allOrders).post(adminAuth, allOrders);
router.route('/status').post(adminAuth, updateStatus);
router.route('/delete').post(adminAuth, authorizeRoles('admin'), deleteOrder);
router.route('/dashboard').get(adminAuth, getDashboardStats).post(adminAuth, getDashboardStats);

export default router;
