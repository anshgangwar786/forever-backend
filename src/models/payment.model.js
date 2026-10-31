import mongoose from 'mongoose';

/**
 * Payment Schema - Financial Ledger
 * Tracks gateway transactions, webhooks, and payment lifecycle independently of fulfillment.
 */
const paymentSchema = new mongoose.Schema(
    {
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            required: [true, 'Order reference (orderId) is required'],
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'User reference (userId) is required'],
            index: true
        },
        transactionId: {
            type: String,
            trim: true,
            index: true,
            sparse: true
        },
        paymentProvider: {
            type: String,
            required: [true, 'Payment provider is required'],
            enum: {
                values: ['Razorpay', 'Stripe', 'COD'],
                message: '{VALUE} is not a supported payment provider'
            },
            index: true
        },
        paymentMethod: {
            type: String,
            required: [true, 'Payment method is required'],
            enum: {
                values: ['Credit_Card', 'UPI', 'NetBanking', 'Cash'],
                message: '{VALUE} is not a supported payment method'
            },
            index: true
        },
        amount: {
            type: Number,
            required: [true, 'Payment amount is required'],
            min: [0, 'Amount must be greater than or equal to 0']
        },
        currency: {
            type: String,
            required: [true, 'Currency is required'],
            uppercase: true,
            trim: true,
            default: 'USD'
        },
        status: {
            type: String,
            required: true,
            enum: {
                values: ['Initiated', 'Authorized', 'Success', 'Failed', 'Refunded'],
                message: '{VALUE} is not a valid payment status'
            },
            default: 'Initiated',
            index: true
        },
        gatewayResponse: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        errorMessage: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// High-performance query indexes
paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ transactionId: 1, paymentProvider: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ paymentProvider: 1, status: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);
