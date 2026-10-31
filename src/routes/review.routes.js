import { Router } from 'express';
import {
    addReview,
    getProductReviews,
    getUserReview,
    deleteReview,
    mailActionReview,
    adminGetReviews,
    adminUpdateReviewStatus
} from '../controllers/review.controller.js';
import authUser from '../middlewares/auth.js';
import adminAuth from '../middlewares/adminAuth.js';

const router = Router();

// One-Click Email Approval Action (clicked directly from Admin/Seller notification email)
router.route('/mail-action').get(mailActionReview);

// Public Read: Fetch all approved reviews and statistical breakdown for a product
router.route('/product/:productId').get(getProductReviews);

// Authenticated (Buyer): Check current user's existing review for this product
router.route('/my-review/:productId').get(authUser, getUserReview);

// Authenticated (Buyer): Add or update review
router.route('/add').post(authUser, addReview);

// Authenticated: Delete review (Owner, Seller or Admin)
router.route('/delete').post(authUser, deleteReview);
router.route('/:id').delete(authUser, deleteReview);

// Admin & Seller Moderation endpoints
router.route('/admin/list').get(adminAuth, adminGetReviews);
router.route('/admin/update-status').post(adminAuth, adminUpdateReviewStatus);

export default router;
