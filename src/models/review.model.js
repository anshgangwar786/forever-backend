import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    userName: {
        type: String,
        required: true,
        trim: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    title: {
        type: String,
        default: '',
        trim: true
    },
    comment: {
        type: String,
        required: true,
        trim: true
    },
    verifiedPurchase: {
        type: Boolean,
        default: false
    },
    // Review Approval Workflow
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    isApproved: {
        type: Boolean,
        default: false,
        index: true
    },
    approvalToken: {
        type: String,
        index: true,
        select: false // secret moderation token; must never reach API responses
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedByEmail: {
        type: String,
        default: ''
    },
    approvedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        default: '',
        trim: true
    }
}, { timestamps: true });

// Prevent duplicate reviews from the same user for the same product
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, createdAt: -1 });
reviewSchema.index({ productId: 1, status: 1 });

// Static method to recalculate average rating & review count on the Product
// Strictly counts ONLY approved reviews
reviewSchema.statics.calculateProductRating = async function(productId) {
    try {
        const stats = await this.aggregate([
            {
                $match: {
                    productId: new mongoose.Types.ObjectId(productId),
                    $or: [
                        { status: 'approved' },
                        { isApproved: true }
                    ]
                }
            },
            {
                $group: {
                    _id: "$productId",
                    ratingCount: { $sum: 1 },
                    ratingAverage: { $avg: "$rating" }
                }
            }
        ]);

        if (stats.length > 0) {
            await mongoose.model('Product').findByIdAndUpdate(productId, {
                ratingCount: stats[0].ratingCount,
                ratingAverage: Math.round(stats[0].ratingAverage * 10) / 10
            });
        } else {
            await mongoose.model('Product').findByIdAndUpdate(productId, {
                ratingCount: 0,
                ratingAverage: 0
            });
        }
    } catch (error) {
        console.error("Error updating product rating average:", error.message);
    }
};

reviewSchema.post("save", async function() {
    await this.constructor.calculateProductRating(this.productId);
});

reviewSchema.post("findOneAndDelete", async function(doc) {
    if (doc) {
        await doc.constructor.calculateProductRating(doc.productId);
    }
});

reviewSchema.post("deleteOne", { document: true, query: false }, async function() {
    await this.constructor.calculateProductRating(this.productId);
});

export const Review = mongoose.model('Review', reviewSchema);
