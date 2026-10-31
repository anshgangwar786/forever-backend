import crypto from 'crypto';
import mongoose from 'mongoose';
import { Review } from '../models/review.model.js';
import { Product } from '../models/product.model.js';
import { Order } from '../models/order.model.js';
import { User } from '../models/user.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendReviewApprovalEmail } from '../utils/mailService.js';
import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Add or Update Product Review
 * Access: Authenticated Users (Buyers who purchased the item)
 * Default Status: 'pending' (Awaiting Admin or Seller Approval)
 */
export const addReview = asyncHandler(async (req, res) => {
    const { productId, rating, title = '', comment } = req.body;
    const userId = req.user?.id;

    if (!userId) {
        throw new ApiError(401, "Authentication required to submit a review");
    }

    if (!productId || !mongoose.isValidObjectId(productId)) {
        throw new ApiError(400, "Valid Product ID is required");
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        throw new ApiError(400, "Rating must be a valid number between 1 and 5");
    }

    if (!comment || typeof comment !== 'string' || comment.trim().length < 3) {
        throw new ApiError(400, "Review comment must be at least 3 characters long");
    }

    const product = await Product.findById(productId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Fetch user details for display name
    const user = await User.findById(userId).select("name email");
    const reviewerName = user?.name || req.user.name || "Customer";

    // Strictly enforce: Only users who have placed an order containing this product can review
    // A verified purchase is an order that was paid for or delivered (COD), and not cancelled
    const hasPurchased = await Order.findOne({
        userId: userId.toString(),
        fulfillmentStatus: { $ne: "Cancelled" },
        $and: [
            {
                $or: [
                    { "items._id": productId.toString() },
                    { "items._id": new mongoose.Types.ObjectId(productId) },
                    { "items.productId": productId.toString() }
                ]
            },
            { $or: [{ paymentStatus: "Paid" }, { fulfillmentStatus: "Delivered" }] }
        ]
    });

    if (!hasPurchased) {
        throw new ApiError(
            403,
            "Access denied: Only customers who have placed an order for this product can submit a review."
        );
    }

    // Generate fresh secure token for email-based approval action
    const approvalToken = crypto.randomBytes(32).toString('hex');

    // Find seller email if product belongs to a specific vendor
    let sellerEmail = null;
    if (product.sellerId) {
        const seller = await User.findById(product.sellerId).select('email');
        sellerEmail = seller?.email || null;
    }

    // Check if user already reviewed this product -> Update existing, else create
    let review = await Review.findOne({ productId, userId });

    if (review) {
        review.rating = numRating;
        review.title = title ? title.trim() : '';
        review.comment = comment.trim();
        review.userName = reviewerName;
        review.verifiedPurchase = true;
        review.status = 'pending';
        review.isApproved = false;
        review.approvalToken = approvalToken;
        review.rejectionReason = '';
        await review.save();
    } else {
        review = await Review.create({
            productId,
            userId,
            userName: reviewerName,
            rating: numRating,
            title: title ? title.trim() : '',
            comment: comment.trim(),
            verifiedPurchase: true,
            status: 'pending',
            isApproved: false,
            approvalToken
        });
    }

    // Dispatch approval request email to Admin and/or Product's Seller asynchronously
    sendReviewApprovalEmail({
        review,
        product,
        sellerEmail,
        adminEmail: process.env.ADMIN_EMAIL || 'admin@forever.com'
    }).catch(err => console.error("Error triggering review approval email:", err));

    return res.status(201).json(
        new ApiResponse(201, {
            review: { ...review.toObject(), approvalToken: undefined }
        }, "Review submitted successfully! It will be displayed once approved by the store admin or seller.")
    );
});

/**
 * Handle Direct One-Click Approval or Rejection from Email Link
 * Access: Public (Authenticated via secure one-time cryptographic token)
 * Route: GET /api/v1/review/mail-action?token=...&action=approve|reject
 */
export const mailActionReview = asyncHandler(async (req, res) => {
    const { token, action } = req.query;

    if (!token) {
        return res.status(400).send(renderResponseHtml({
            status: 'error',
            title: 'Invalid Request',
            message: 'Approval token is required.'
        }));
    }

    const review = await Review.findOne({ approvalToken: token }).populate('productId');
    if (!review) {
        return res.status(404).send(renderResponseHtml({
            status: 'error',
            title: 'Review Not Found or Link Expired',
            message: 'This review approval link may have expired or was already processed.'
        }));
    }

    const product = review.productId;
    const productName = product?.name || 'Product';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5174';

    if (action === 'approve') {
        review.status = 'approved';
        review.isApproved = true;
        review.approvedAt = new Date();
        review.approvedByEmail = 'Approved via Email';
        review.rejectionReason = '';
        review.approvalToken = undefined;
        await review.save();
        await Review.calculateProductRating(review.productId?._id || review.productId);

        return res.status(200).send(renderResponseHtml({
            status: 'success',
            title: 'Review Approved Successfully!',
            message: `The review by <strong>${escapeHtml(review.userName)}</strong> for <strong>"${escapeHtml(productName)}"</strong> has been approved and is now live on the store front.`,
            review,
            product,
            frontendUrl,
            adminUrl
        }));
    } else if (action === 'reject') {
        review.status = 'rejected';
        review.isApproved = false;
        review.approvedAt = new Date();
        review.approvedByEmail = 'Rejected via Email';
        review.approvalToken = undefined;
        await review.save();
        await Review.calculateProductRating(review.productId?._id || review.productId);

        return res.status(200).send(renderResponseHtml({
            status: 'rejected',
            title: 'Review Rejected',
            message: `The review by <strong>${escapeHtml(review.userName)}</strong> for <strong>"${escapeHtml(productName)}"</strong> has been marked as rejected and will not be displayed on the store.`,
            review,
            product,
            frontendUrl,
            adminUrl
        }));
    } else {
        return res.status(400).send(renderResponseHtml({
            status: 'error',
            title: 'Invalid Action',
            message: 'Action must be either "approve" or "reject".'
        }));
    }
});

/**
 * Get Product Reviews with Aggregated Rating Breakdown
 * Access: Public (Returns ONLY approved reviews)
 */
export const getProductReviews = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!productId || !mongoose.isValidObjectId(productId)) {
        throw new ApiError(400, "Valid Product ID is required");
    }

    // Only fetch reviews that are approved!
    const reviews = await Review.find({
        productId,
        $or: [
            { status: 'approved' },
            { isApproved: true }
        ]
    }).sort({ createdAt: -1 });

    const totalReviews = reviews.length;
    let ratingSum = 0;
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach((r) => {
        ratingSum += r.rating;
        const rounded = Math.round(r.rating);
        if (breakdown[rounded] !== undefined) {
            breakdown[rounded] += 1;
        }
    });

    const averageRating = totalReviews > 0 ? Math.round((ratingSum / totalReviews) * 10) / 10 : 0;

    const breakdownPercentages = {};
    for (let star = 1; star <= 5; star++) {
        breakdownPercentages[star] = totalReviews > 0
            ? Math.round((breakdown[star] / totalReviews) * 100)
            : 0;
    }

    const stats = {
        totalReviews,
        averageRating,
        breakdown,
        breakdownPercentages
    };

    res.status(200).json(
        new ApiResponse(200, { reviews, stats }, "Product reviews fetched successfully")
    );
});

/**
 * Get Current User's Review & Purchase Eligibility for a Product
 * Access: Authenticated (Returns user's own review even if pending approval)
 */
export const getUserReview = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user?.id;

    if (!productId || !mongoose.isValidObjectId(productId)) {
        throw new ApiError(400, "Valid Product ID is required");
    }

    if (!userId) {
        return res.status(200).json(
            new ApiResponse(200, { review: null, canReview: false }, "Not authenticated")
        );
    }

    const review = await Review.findOne({ productId, userId });

    // Check if user has placed an order containing this product
    // A verified purchase is an order that was paid for or delivered (COD), and not cancelled
    const hasPurchased = await Order.findOne({
        userId: userId.toString(),
        fulfillmentStatus: { $ne: "Cancelled" },
        $and: [
            {
                $or: [
                    { "items._id": productId.toString() },
                    { "items._id": new mongoose.Types.ObjectId(productId) },
                    { "items.productId": productId.toString() }
                ]
            },
            { $or: [{ paymentStatus: "Paid" }, { fulfillmentStatus: "Delivered" }] }
        ]
    });

    res.status(200).json(
        new ApiResponse(200, {
            review: review || null,
            canReview: !!hasPurchased
        }, "User review status fetched successfully")
    );
});

/**
 * Admin / Seller: List Reviews for Moderation
 * Access: Admin or Seller
 */
export const adminGetReviews = asyncHandler(async (req, res) => {
    const { status = 'all', search = '', productId } = req.query;
    const currentUserId = req.user?.id?.toString();
    const isSeller = req.user?.role === 'seller';

    const filter = {};

    // If logged in as Seller, strictly restrict to products owned by this seller
    if (isSeller) {
        const sellerProducts = await Product.find({
            $or: [
                { sellerId: currentUserId },
                { storeName: req.user.storeName }
            ]
        }).select('_id');

        const productIds = sellerProducts.map(p => p._id);
        filter.productId = { $in: productIds };
    } else if (productId && mongoose.isValidObjectId(productId)) {
        filter.productId = productId;
    }

    // Status filter
    if (status === 'pending') {
        filter.status = 'pending';
    } else if (status === 'approved') {
        filter.$or = [{ status: 'approved' }, { isApproved: true }];
    } else if (status === 'rejected') {
        filter.status = 'rejected';
    }

    // Text search on userName, title, comment
    if (search && search.trim()) {
        const searchRegex = new RegExp(search.trim(), 'i');
        filter.$and = filter.$and || [];
        filter.$and.push({
            $or: [
                { userName: searchRegex },
                { title: searchRegex },
                { comment: searchRegex }
            ]
        });
    }

    // Get count breakdown for quick tabs
    const baseSellerFilter = isSeller ? filter.productId : null;
    const matchFilter = baseSellerFilter ? { productId: baseSellerFilter } : {};

    const [totalCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
        Review.countDocuments(matchFilter),
        Review.countDocuments({ ...matchFilter, status: 'pending' }),
        Review.countDocuments({ ...matchFilter, $or: [{ status: 'approved' }, { isApproved: true }] }),
        Review.countDocuments({ ...matchFilter, status: 'rejected' })
    ]);

    const reviews = await Review.find(filter)
        .populate('productId', 'name image price category subCategory storeName')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 });

    res.status(200).json(
        new ApiResponse(200, {
            reviews,
            counts: {
                all: totalCount,
                pending: pendingCount,
                approved: approvedCount,
                rejected: rejectedCount
            }
        }, "Reviews fetched successfully for admin moderation")
    );
});

/**
 * Admin / Seller: Update Review Status (Approve / Reject)
 * Access: Admin or Seller owning the product
 */
export const adminUpdateReviewStatus = asyncHandler(async (req, res) => {
    const { reviewId, status, rejectionReason = '' } = req.body;

    if (!reviewId || !mongoose.isValidObjectId(reviewId)) {
        throw new ApiError(400, "Valid Review ID is required");
    }

    if (!['pending', 'approved', 'rejected'].includes(status)) {
        throw new ApiError(400, "Invalid status. Must be pending, approved, or rejected");
    }

    const review = await Review.findById(reviewId);
    if (!review) {
        throw new ApiError(404, "Review not found");
    }

    // Seller authorization check: Must own the product
    if (req.user?.role === 'seller') {
        const product = await Product.findById(review.productId);
        const currentUserId = req.user?.id?.toString();
        const isOwner = product && (
            product.sellerId?.toString() === currentUserId ||
            (product.storeName && req.user.storeName && product.storeName.toLowerCase() === req.user.storeName.toLowerCase())
        );
        if (!isOwner) {
            throw new ApiError(403, "Access denied: You do not own the product for this review");
        }
    }

    review.status = status;
    review.isApproved = status === 'approved';
    review.approvedBy = req.user?.id;
    review.approvedByEmail = req.user?.email || 'Admin/Seller';
    review.approvedAt = new Date();
    if (rejectionReason) {
        review.rejectionReason = rejectionReason.trim();
    } else if (status === 'approved') {
        review.rejectionReason = '';
    }

    await review.save();
    await Review.calculateProductRating(review.productId);

    res.status(200).json(
        new ApiResponse(200, review, `Review marked as ${status} successfully`)
    );
});

/**
 * Delete Review
 * Access: Review Owner or Admin Superuser or Product Seller
 */
export const deleteReview = asyncHandler(async (req, res) => {
    const targetId = req.params.id || req.body.id || req.body.reviewId;

    if (!targetId || !mongoose.isValidObjectId(targetId)) {
        throw new ApiError(400, "Valid Review ID is required");
    }

    const review = await Review.findById(targetId);
    if (!review) {
        throw new ApiError(404, "Review not found");
    }

    const currentUserId = req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';

    // Allow Admin Superuser, Buyer who created it, or Seller owning this product to delete
    let isSellerOwner = false;
    if (req.user?.role === 'seller') {
        const product = await Product.findById(review.productId);
        if (product && (product.sellerId?.toString() === currentUserId || (product.storeName && req.user.storeName && product.storeName.trim().toLowerCase() === req.user.storeName.trim().toLowerCase()))) {
            isSellerOwner = true;
        }
    }

    if (!isAdmin && !isSellerOwner && review.userId.toString() !== currentUserId) {
        throw new ApiError(403, "Access denied: You are not authorized to delete this review");
    }

    const productId = review.productId;
    await Review.findByIdAndDelete(targetId);
    await Review.calculateProductRating(productId);

    res.status(200).json(
        new ApiResponse(200, {}, "Review deleted successfully")
    );
});

/**
 * Helper to render full-page responsive HTML for Email Action response
 */
function renderResponseHtml({ status, title, message, review, product, frontendUrl = 'http://localhost:5173', adminUrl = 'http://localhost:5174' }) {
    const isSuccess = status === 'success';
    const isRejected = status === 'rejected';

    const accentColor = isSuccess ? '#10b981' : isRejected ? '#f59e0b' : '#ef4444';
    const iconSvg = isSuccess
        ? `<svg style="width: 48px; height: 48px; color: #10b981;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`
        : isRejected
        ? `<svg style="width: 48px; height: 48px; color: #f59e0b;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`
        : `<svg style="width: 48px; height: 48px; color: #ef4444;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Forever Store</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .card { max-width: 520px; width: 100%; background: #ffffff; border-radius: 20px; padding: 40px 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e2e8f0; text-align: center; }
        .icon-circle { width: 80px; height: 80px; border-radius: 50%; background: ${isSuccess ? '#ecfdf5' : isRejected ? '#fffbeb' : '#fef2f2'}; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }
        h1 { margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #0f172a; }
        p { margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #64748b; }
        .details-box { background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 16px; margin-bottom: 28px; text-align: left; }
        .details-box p { margin: 6px 0; font-size: 13px; color: #334155; }
        .btn-group { display: flex; flex-direction: column; gap: 10px; }
        .btn { display: block; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; transition: opacity 0.2s; }
        .btn-primary { background: #0f172a; color: #ffffff !important; }
        .btn-secondary { background: #f1f5f9; color: #334155 !important; }
        .btn:hover { opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon-circle">
          ${iconSvg}
        </div>
        <h1>${title}</h1>
        <p>${message}</p>

        ${review ? `
        <div class="details-box">
          <p><strong>Reviewer:</strong> ${escapeHtml(review.userName)}</p>
          <p><strong>Rating:</strong> ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating} / 5)</p>
          ${review.title ? `<p><strong>Title:</strong> "${escapeHtml(review.title)}"</p>` : ''}
          <p><strong>Comment:</strong> ${escapeHtml(review.comment)}</p>
        </div>
        ` : ''}

        <div class="btn-group">
          ${product ? `<a href="${frontendUrl}/product/${product._id || product}" class="btn btn-primary">View Product in Store</a>` : ''}
          <a href="${adminUrl}/reviews" class="btn btn-secondary">Open Admin Reviews Dashboard</a>
        </div>
      </div>
    </body>
    </html>
    `;
}
