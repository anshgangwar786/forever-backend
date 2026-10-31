import { User } from "../models/user.model.js"
import { Product } from "../models/product.model.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { getVariantLabelError, getVariantSizeValue } from "../utils/variantPricing.js"
import mongoose from "mongoose"

// The label is used as a Mongo path segment (cartData.<id>.<label>), so it must be a real option of the product
const assertValidVariant = (product, label) => {
    const error = getVariantLabelError(product, label);
    if (error) throw new ApiError(400, error);
};

// Units available for this option: per-size stock when tracked, else total stock
const getAvailableStock = (product, label) => {
    const total = product.stock !== undefined ? product.stock : 50;
    const sizeValue = getVariantSizeValue(product, label);
    if (!sizeValue || !product.sizeStock) return total;
    const perSize = product.sizeStock instanceof Map ? product.sizeStock.get(sizeValue) : product.sizeStock[sizeValue];
    return perSize !== undefined ? Math.min(total, perSize) : total;
};

// Atomically add item to cart to prevent race conditions / collisions
const addToCart = asyncHandler(async (req, res) => {
    // Enforce role: Only buyers (customers) can have a shopping cart
    if (req.user?.role !== 'user') {
        throw new ApiError(403, "Admins and Sellers do not participate in consumer shopping carts");
    }

    // Enforce ownership: Cart belongs strictly to the authenticated buyer
    const userId = req.user.id;
    const { itemId, size } = req.body;

    if (!itemId || !size) {
        throw new ApiError(400, "Missing required cart parameters (itemId, size)");
    }

    if (!mongoose.isValidObjectId(itemId)) {
        throw new ApiError(400, "Invalid product");
    }

    // Verify product exists, the option is real, and live inventory covers one more unit
    const product = await Product.findById(itemId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }
    assertValidVariant(product, size);

    const availableStock = getAvailableStock(product, size);
    if (availableStock <= 0) {
        throw new ApiError(400, "This piece is currently out of stock");
    }
    const currentUser = await User.findById(userId).select("cartData");
    const inCart = Number(currentUser?.cartData?.[itemId]?.[size]) || 0;
    if (inCart + 1 > availableStock) {
        throw new ApiError(400, `Only ${availableStock} available — you already have ${inCart} in your bag`);
    }

    // Atomic $inc operation prevents race condition on concurrent clicks
    const fieldPath = `cartData.${itemId}.${size}`;
    const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { [fieldPath]: 1 } },
        { new: true }
    );

    if (!updatedUser) {
        throw new ApiError(404, "User not found");
    }

    res.status(200).json(
        new ApiResponse(200, updatedUser.cartData || {}, "Added To Cart")
    );
});

// Atomically update item quantity in cart
const updateCart = asyncHandler(async (req, res) => {
    // Enforce role: Only buyers (customers) can have a shopping cart
    if (req.user?.role !== 'user') {
        throw new ApiError(403, "Admins and Sellers do not participate in consumer shopping carts");
    }

    // Enforce ownership: Cart belongs strictly to the authenticated buyer
    const userId = req.user.id;
    const { itemId, size } = req.body;

    if (!itemId || !size || req.body.quantity === undefined || !Number.isFinite(Number(req.body.quantity))) {
        throw new ApiError(400, "Missing required cart parameters (itemId, size, quantity)");
    }
    if (!mongoose.isValidObjectId(itemId) || typeof size !== 'string' || size.includes('.') || size.startsWith('$')) {
        throw new ApiError(400, "Invalid cart item");
    }
    const quantity = Math.floor(Number(req.body.quantity));

    if (quantity > 0) {
        const product = await Product.findById(itemId);
        if (!product) {
            throw new ApiError(404, "Product not found");
        }
        assertValidVariant(product, size);
        const availableStock = getAvailableStock(product, size);
        if (quantity > availableStock) {
            throw new ApiError(400, `Cannot request ${quantity} units. Only ${availableStock} available in stock.`);
        }
    }

    const fieldPath = `cartData.${itemId}.${size}`;
    let updateOp;

    if (quantity <= 0) {
        // If quantity is 0 or less, atomically remove the size key
        updateOp = { $unset: { [fieldPath]: "" } };
    } else {
        updateOp = { $set: { [fieldPath]: quantity } };
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateOp, { new: true });

    if (!updatedUser) {
        throw new ApiError(404, "User not found");
    }

    res.status(200).json(
        new ApiResponse(200, updatedUser.cartData || {}, "Cart Updated")
    );
});

const getUserCart = asyncHandler(async (req, res) => {
    // Enforce role: Only buyers (customers) can have a shopping cart
    if (req.user?.role !== 'user') {
        throw new ApiError(403, "Admins and Sellers do not participate in consumer shopping carts");
    }

    // Enforce ownership: Cart belongs strictly to the authenticated buyer
    const userId = req.user.id;

    const userData = await User.findById(userId).select("cartData");
    const cartData = userData?.cartData || {};

    res.status(200).json(
        new ApiResponse(200, cartData, "Cart Data Fetched Successfully")
    );
});

export {
    addToCart,
    updateCart,
    getUserCart
}

