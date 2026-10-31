import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Order Item Subdocument Schema
 * Represents a physical SKU item purchased in the order.
 */
const orderItemSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'productId is required']
        },
        variantId: {
            type: String,
            default: null
        },
        quantity: {
            type: Number,
            required: [true, 'Item quantity is required'],
            min: [1, 'Quantity must be at least 1']
        },
        priceAtTimeOfPurchase: {
            type: Number,
            required: [true, 'priceAtTimeOfPurchase is required'],
            min: [0, 'priceAtTimeOfPurchase cannot be negative']
        },
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true
        },
        // Embedded display metadata to preserve historical line-item snapshot
        name: {
            type: String,
            trim: true
        },
        category: {
            type: String,
            default: 'General'
        },
        subCategory: {
            type: String,
            default: ''
        },
        size: {
            type: String,
            trim: true,
            default: null
        },
        image: {
            type: Array,
            default: []
        },
        storeName: {
            type: String,
            default: ''
        }
    },
    { _id: true }
);

/**
 * Shipping Address Subdocument Schema
 */
const shippingAddressSchema = new mongoose.Schema(
    {
        firstName: { type: String, required: true, trim: true },
        lastName: { type: String, required: true, trim: true },
        email: { type: String, trim: true, lowercase: true },
        phone: { type: String, required: true, trim: true },
        street: { type: String, required: true, trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        zipcode: { type: String, required: true, trim: true },
        country: { type: String, required: true, trim: true }
    },
    { _id: false }
);

/**
 * Order Schema - Physical Fulfillment Model
 * Dedicated exclusively to order lifecycle, shipment tracking, line items, and financial summary.
 */
const orderSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'User ID is required'],
            index: true
        },
        orderNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
            index: true
        },
        items: {
            type: [orderItemSchema],
            required: [true, 'Order items are required'],
            validate: {
                validator: (val) => Array.isArray(val) && val.length > 0,
                message: 'Order items array cannot be empty'
            }
        },
        // Financial Summary Fields
        subTotal: {
            type: Number,
            required: [true, 'subTotal is required'],
            min: [0, 'subTotal cannot be negative']
        },
        taxAmount: {
            type: Number,
            default: 0,
            min: [0, 'taxAmount cannot be negative']
        },
        shippingCost: {
            type: Number,
            default: 0,
            min: [0, 'shippingCost cannot be negative']
        },
        discountAmount: {
            type: Number,
            default: 0,
            min: [0, 'discountAmount cannot be negative']
        },
        grandTotal: {
            type: Number,
            required: [true, 'grandTotal is required'],
            min: [0, 'grandTotal cannot be negative']
        },
        shippingAddress: {
            type: shippingAddressSchema,
            required: [true, 'shippingAddress is required']
        },
        fulfillmentStatus: {
            type: String,
            required: true,
            enum: {
                values: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
                message: '{VALUE} is not a valid fulfillment status'
            },
            default: 'Pending',
            index: true
        },
        paymentStatus: {
            type: String,
            required: true,
            enum: {
                values: ['Unpaid', 'Partially_Paid', 'Paid', 'Refunded'],
                message: '{VALUE} is not a valid payment status'
            },
            default: 'Unpaid',
            index: true
        },
        // Operational & tracking metadata
        coupon: {
            type: String,
            trim: true,
            default: ''
        },
        idempotencyKey: {
            type: String,
            sparse: true,
            unique: true
        },
        notes: {
            type: String,
            default: ''
        },
        deliveredAt: {
            type: Date,
            default: null
        },
        cancelledAt: {
            type: Date,
            default: null
        },
        cancellationReason: {
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

// Pre-validate hook to guarantee a unique, human-readable orderNumber
orderSchema.pre('validate', function () {
    if (!this.orderNumber) {
        const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
        this.orderNumber = `ORD-${datePart}-${randomPart}`;
    }
});

// Backward-compatibility virtual getters & setters for existing frontend & admin views
orderSchema.virtual('amount')
    .get(function () {
        return this.grandTotal;
    })
    .set(function (val) {
        this.grandTotal = val;
    });

orderSchema.virtual('status')
    .get(function () {
        return this.fulfillmentStatus;
    })
    .set(function (val) {
        this.fulfillmentStatus = val;
    });

orderSchema.virtual('payment')
    .get(function () {
        return this.paymentStatus === 'Paid';
    })
    .set(function (val) {
        this.paymentStatus = val ? 'Paid' : 'Unpaid';
    });

orderSchema.virtual('address')
    .get(function () {
        return this.shippingAddress;
    })
    .set(function (val) {
        this.shippingAddress = val;
    });

orderSchema.virtual('date')
    .get(function () {
        return this.createdAt ? new Date(this.createdAt).getTime() : Date.now();
    });

orderSchema.virtual('paymentMethod')
    .get(function () {
        if (this.payments && Array.isArray(this.payments) && this.payments.length > 0) {
            return this.payments[0].paymentProvider || this.payments[0].paymentMethod || 'COD';
        }
        return 'COD';
    });

orderSchema.virtual('paymentProvider')
    .get(function () {
        if (this.payments && Array.isArray(this.payments) && this.payments.length > 0) {
            return this.payments[0].paymentProvider;
        }
        return 'COD';
    });

// Virtual populate for linked Payment documents
orderSchema.virtual('payments', {
    ref: 'Payment',
    localField: '_id',
    foreignField: 'orderId'
});

// Compound & Performance Indexes
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ fulfillmentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'items.productId': 1 });
orderSchema.index({ 'items.sellerId': 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
