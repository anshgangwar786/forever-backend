import { Router } from 'express';
import {
    checkout,
    paymentWebhook,
    getAllPayments,
    getPaymentById,
    getPaymentsByOrderId,
    processRefund
} from '../controllers/payment.controller.js';
import authUser from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';
import { restrictRoles } from '../middlewares/acl.middleware.js';
import { verifyRazorpay } from '../controllers/order.controller.js';
import { verifyRazorpayPayment, verifyWebhookSignature } from '../middlewares/paymentVerification.middleware.js';

const router = Router();

const buyerOnlyGuard = [authUser, restrictRoles(['admin', 'seller'], "Admins and Sellers do not place consumer orders")];

// Decoupled checkout endpoint
router.route('/checkout').post(buyerOnlyGuard, checkout);

// Gateway Webhook callback endpoint
// Verification and Webhook endpoints
router.route('/verify').post(authUser, verifyRazorpayPayment, verifyRazorpay);
router.route('/webhook').post(verifyWebhookSignature, paymentWebhook);

// Admin & Seller Transaction Ledger routes
router.route('/list').get(adminAuth, getAllPayments).post(adminAuth, getAllPayments);
router.route('/admin/all').get(adminAuth, getAllPayments);
router.route('/refund').post(adminAuth, processRefund);

// Payment ledger lookups
router.route('/order/:orderId').get(authUser, getPaymentsByOrderId);
router.route('/:paymentId').get(authUser, getPaymentById);

export default router;
