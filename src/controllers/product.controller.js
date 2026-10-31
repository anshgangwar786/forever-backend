import { asyncHandler } from '../utils/asyncHandler.js'
import {v2 as cloudinary} from 'cloudinary'
import { Product } from '../models/product.model.js'
import { Order } from '../models/order.model.js'
import { Review } from '../models/review.model.js'
import { ApiResponse } from '../utils/ApiResponse.js'
import { ApiError } from '../utils/ApiError.js'
import mongoose, { isValidObjectId } from 'mongoose'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import { VARIANT_SEPARATOR, getEffectiveAttributes } from '../utils/variantPricing.js'

const IMAGE_SLOTS = ['image1', 'image2', 'image3', 'image4'];

/**
 * Validate the variant → image links sent by the admin form.
 * `image` is either an existing image URL or "upload:<slot>" for a file uploaded in this request.
 * Links whose attribute/value no longer exist, or whose image isn't on the product, are dropped.
 */
const resolveVariantImages = (raw, attributes, finalImages, slotUrls = {}) => {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (e) { throw new ApiError(400, "Invalid JSON format for variantImages"); }
    }
    if (!Array.isArray(parsed)) return [];

    const imageSet = new Set(finalImages);
    const seen = new Set();
    const resolved = [];
    for (const link of parsed) {
        if (!link || typeof link !== 'object') continue;
        const attribute = String(link.attribute || '').trim();
        const value = String(link.value || '').trim();
        let image = String(link.image || '').trim();
        if (image.startsWith('upload:')) image = slotUrls[image.slice('upload:'.length)] || '';

        const attr = attributes.find((a) => a.name === attribute);
        const key = `${attribute}\u0000${value}`;
        if (!attr || !attr.values.includes(value) || !imageSet.has(image) || seen.has(key)) continue;
        seen.add(key);
        resolved.push({ attribute, value, image });
    }
    return resolved;
};

/**
 * Option values become cart keys (`cartData.<productId>.<label>`) and sizeStock keys, and labels are
 * joined with " / ", so "." (Mongo path separator), a leading "$" and " / " would corrupt carts.
 */
const assertSafeOptionText = (text, kind) => {
    if (text.includes('.') || text.startsWith('$') || text.includes(VARIANT_SEPARATOR.trim())) {
        throw new ApiError(400, `${kind} "${text}" can't contain ".", "/" or start with "$" (e.g. write "1,5L" or "1-5L" instead of "1.5L")`);
    }
};

/**
 * Validate per-option price adjustments: [{ attribute, value, priceDelta }].
 * Drops links to unknown options; rejects adjustments that would make the price negative.
 */
const resolveVariantPrices = (raw, attributes, basePrice) => {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (e) { throw new ApiError(400, "Invalid JSON format for variantPrices"); }
    }
    if (!Array.isArray(parsed)) return [];

    const seen = new Set();
    const resolved = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const attribute = String(entry.attribute || '').trim();
        const value = String(entry.value || '').trim();
        const priceDelta = Math.round(Number(entry.priceDelta) * 100) / 100;
        const attr = attributes.find((a) => a.name === attribute);
        const key = `${attribute}\u0000${value}`;
        if (!attr || !attr.values.includes(value) || !Number.isFinite(priceDelta) || priceDelta === 0 || seen.has(key)) continue;
        if (Number(basePrice) + priceDelta < 0) {
            throw new ApiError(400, `Price adjustment for ${attribute} "${value}" would make the price negative`);
        }
        seen.add(key);
        resolved.push({ attribute, value, priceDelta });
    }
    return resolved;
};

//Function for add product (Dynamic attributes & any product type)
const addProducts = asyncHandler(async (req, res) => {
    const {
        name,
        description,
        price,
        category,
        subCategory,
        attributes,
        sizes,
        bestseller,
        discount,
        stock,
        sizeStock,
        variantImages,
        variantPrices
    } = req.body;

    if (!name || !price || !category) {
        throw new ApiError(400, "Required fields missing (name, price, category)");
    }

    const uploadedSlots = IMAGE_SLOTS
        .map((slot) => [slot, req.files?.[slot]?.[0]])
        .filter(([, file]) => file != undefined);

    if (uploadedSlots.length === 0) {
        throw new ApiError(400, "At least one image is required");
    }

    let imagesUrl = await Promise.all(
        uploadedSlots.map(async([, item]) => {
            let result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
            try {
                fs.unlinkSync(item.path);
            } catch (e) {}
            return result.secure_url;
        })
    );
    const slotUrls = Object.fromEntries(uploadedSlots.map(([slot], i) => [slot, imagesUrl[i]]));

    const sellerId = (req.user?.id && isValidObjectId(req.user.id)) ? req.user.id : null;
    const storeName = req.user?.storeName || (req.user?.name ? `${req.user.name}'s Store` : 'Forever Head Office');
    const parsedDiscount = Math.min(100, Math.max(0, Number(discount) || 0));
    const totalStock = stock !== undefined && stock !== "" && !isNaN(Number(stock))
        ? Math.max(0, parseInt(stock))
        : 50;

    // Parse, validate, and clean dynamic attributes array
    let parsedAttributes = [];
    if (attributes) {
        try {
            parsedAttributes = typeof attributes === 'string' ? JSON.parse(attributes) : attributes;
        } catch (e) {
            throw new ApiError(400, "Invalid JSON format for product attributes");
        }
    }

    if (!Array.isArray(parsedAttributes)) {
        throw new ApiError(400, "Attributes must be an array of objects");
    }

    const cleanedAttributes = [];
    for (const attr of parsedAttributes) {
        if (!attr || typeof attr !== 'object') continue;
        const attrName = typeof attr.name === 'string' ? attr.name.trim() : '';
        if (!attrName) continue;

        let rawValues = [];
        if (Array.isArray(attr.values)) {
            rawValues = attr.values;
        } else if (typeof attr.values === 'string') {
            rawValues = attr.values.split(',');
        }

        const cleanedValues = rawValues
            .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
            .filter(Boolean);

        if (cleanedValues.length > 0) {
            assertSafeOptionText(attrName, 'Attribute name');
            cleanedValues.forEach((v) => assertSafeOptionText(v, 'Option'));
            const uniqueValues = Array.from(new Set(cleanedValues));
            cleanedAttributes.push({
                name: attrName,
                values: uniqueValues
            });
        }
    }

    // Backward compatibility for legacy sizes
    let legacySizes = [];
    if (sizes) {
        try {
            legacySizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
        } catch (e) {}
    }
    const sizeAttr = cleanedAttributes.find(
        (a) => a.name.toLowerCase() === 'size' || a.name.toLowerCase() === 'sizes'
    );
    if (!sizeAttr && Array.isArray(legacySizes) && legacySizes.length > 0) {
        cleanedAttributes.unshift({
            name: 'Size',
            values: legacySizes
        });
    } else if (sizeAttr && (!legacySizes || legacySizes.length === 0)) {
        legacySizes = sizeAttr.values;
    }

    let parsedSizeStock = {};
    if (sizeStock) {
        try {
            parsedSizeStock = typeof sizeStock === 'string' ? JSON.parse(sizeStock) : sizeStock;
        } catch (e) {}
    } else if (Array.isArray(legacySizes) && legacySizes.length > 0) {
        const perSize = Math.floor(totalStock / legacySizes.length);
        let rem = totalStock % legacySizes.length;
        legacySizes.forEach((sz, idx) => {
            parsedSizeStock[sz] = perSize + (idx === 0 ? rem : 0);
        });
    }

    const productData = await Product.create({
        name: name.trim(),
        description: description?.trim() || '',
        category: category.trim(),
        subCategory: subCategory ? subCategory.trim() : 'General',
        price : Number(price),
        discount: parsedDiscount,
        bestseller: bestseller === 'true' || bestseller === true,
        attributes: cleanedAttributes,
        variantImages: resolveVariantImages(variantImages, getEffectiveAttributes({ attributes: cleanedAttributes, sizes: legacySizes }), imagesUrl, slotUrls),
        variantPrices: resolveVariantPrices(variantPrices, getEffectiveAttributes({ attributes: cleanedAttributes, sizes: legacySizes }), Number(price)),
        sizes: legacySizes,
        stock: totalStock,
        sizeStock: parsedSizeStock,
        image: imagesUrl,
        date: Date.now(),
        sellerId,
        storeName
    });

    res.status(200).json(
        new ApiResponse(200, productData, "Product Added Successfully")
    );
});

// Function for list products with pagination, filtration, and full-text search
const listProducts = asyncHandler(async (req, res) => {
    const {
        search,
        category,
        subCategory,
        minPrice,
        maxPrice,
        bestseller,
        sort,
        page,
        limit = 10,
        paginate
    } = req.query;

    const filter = {};

    // 1. Search filter (utilizing text index or regex)
    if (search && search.trim() !== "") {
        const cleanSearch = search.trim();
        filter.$or = [
            { name: { $regex: cleanSearch, $options: "i" } },
            { description: { $regex: cleanSearch, $options: "i" } },
            { category: { $regex: cleanSearch, $options: "i" } }
        ];
    }

    // 2. Category filter (supports single or comma-separated)
    if (category) {
        const catArray = Array.isArray(category)
            ? category
            : category.split(',').map(c => c.trim()).filter(Boolean);
        if (catArray.length > 0) {
            filter.category = { $in: catArray };
        }
    }

    // 3. SubCategory filter
    if (subCategory) {
        const subCatArray = Array.isArray(subCategory)
            ? subCategory
            : subCategory.split(',').map(s => s.trim()).filter(Boolean);
        if (subCatArray.length > 0) {
            filter.subCategory = { $in: subCatArray };
        }
    }

    // 4. Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined && !isNaN(Number(minPrice))) {
            filter.price.$gte = Number(minPrice);
        }
        if (maxPrice !== undefined && !isNaN(Number(maxPrice))) {
            filter.price.$lte = Number(maxPrice);
        }
    }

    // 5. Bestseller filter
    if (bestseller !== undefined) {
        filter.bestseller = bestseller === 'true' || bestseller === true;
    }

    // 5.1 Seller / Store Filter (Strict Multi-Vendor Isolation)
    if (req.query.sellerId && isValidObjectId(req.query.sellerId)) {
        filter.sellerId = req.query.sellerId;
    }
    if (req.query.storeName && req.query.storeName.trim() !== '') {
        filter.storeName = { $regex: req.query.storeName.trim(), $options: 'i' };
    }

    // If request contains an authenticated seller token, strictly scope inventory to their store
    const authToken = req.headers.token || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.split(" ")[1] : null);
    if (authToken) {
        try {
            const decoded = jwt.decode(authToken);
            if (decoded?.role === 'seller' && decoded?.id) {
                filter.sellerId = decoded.id;
            }
        } catch (e) {}
    }

    // 6. Sorting
    let sortOptions = { date: -1 };
    if (sort === "low-high" || sort === "price_asc") {
        sortOptions = { price: 1 };
    } else if (sort === "high-low" || sort === "price_desc") {
        sortOptions = { price: -1 };
    } else if (sort === "oldest") {
        sortOptions = { date: 1 };
    } else if (sort === "newest") {
        sortOptions = { date: -1 };
    }

    const total = await Product.countDocuments(filter);

    // 7. Pagination
    if (page || paginate === 'true') {
        const currentPage = Math.max(1, parseInt(page) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(limit) || 10));
        const totalPages = Math.ceil(total / pageSize);

        const products = await Product.find(filter)
            .sort(sortOptions)
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        const responsePayload = paginate === 'true'
            ? { products, total, totalPages, currentPage, pageSize }
            : products;

        return res.status(200).json(
            new ApiResponse(
                200,
                responsePayload,
                products.length === 0 ? "No products found" : "Products fetched successfully",
                { total, totalPages, currentPage, pageSize }
            )
        );
    }

    // Default: Return all matching products (preserves backward compatibility)
    const products = await Product.find(filter).sort(sortOptions);

    res.status(200).json(
        new ApiResponse(
            200,
            products,
            products.length === 0 ? "Products list is empty" : "Products Fetched Successfully",
            { total, totalPages: 1, currentPage: 1, pageSize: total }
        )
    );
});

// Function for updating product (Full CRUD Support)
const updateProduct = asyncHandler(async (req, res) => {
    const { id, productId, name, description, price, category, subCategory, attributes, sizes, bestseller, existingImages, discount, stock, sizeStock, variantImages, variantPrices } = req.body;
    const targetId = id || productId;

    if (!isValidObjectId(targetId)) {
        throw new ApiError(400, "Invalid Product ID");
    }

    const product = await Product.findById(targetId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Role-based authorization: Sellers can only edit their own products, Admins can edit any
    if (req.user?.role === 'seller') {
        if (!product.sellerId || product.sellerId.toString() !== req.user.id?.toString()) {
            throw new ApiError(403, "Access denied: You can only edit products belonging to your store");
        }
    }

    // Process newly uploaded images
    const newSlots = IMAGE_SLOTS
        .map((slot) => [slot, req.files?.[slot]?.[0]])
        .filter(([, file]) => Boolean(file));

    let newImageUrls = [];
    if (newSlots.length > 0) {
        newImageUrls = await Promise.all(
            newSlots.map(async ([, item]) => {
                const result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
                try {
                    fs.unlinkSync(item.path);
                } catch (e) {}
                return result.secure_url;
            })
        );
    }

    // Determine final image list
    let finalImages = product.image || [];
    if (existingImages) {
        try {
            const parsedExisting = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
            if (Array.isArray(parsedExisting)) {
                finalImages = parsedExisting;
            }
        } catch (e) {}
    }
    if (newImageUrls.length > 0) {
        finalImages = [...finalImages, ...newImageUrls];
    }

    if (finalImages.length === 0) {
        throw new ApiError(400, "At least one product image is required");
    }

    // Update product fields
    if (name) product.name = name.trim();
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = Number(price);
    if (category) product.category = category.trim();
    if (subCategory) product.subCategory = subCategory.trim();
    if (bestseller !== undefined) product.bestseller = bestseller === 'true' || bestseller === true;
    if (discount !== undefined && discount !== "") {
        product.discount = Math.min(100, Math.max(0, Number(discount) || 0));
    }
    if (attributes !== undefined) {
        let parsedAttrs = [];
        try {
            parsedAttrs = typeof attributes === 'string' ? JSON.parse(attributes) : attributes;
        } catch (e) {}
        if (Array.isArray(parsedAttrs)) {
            const cleanedAttrs = [];
            for (const attr of parsedAttrs) {
                if (!attr || typeof attr !== 'object') continue;
                const attrName = typeof attr.name === 'string' ? attr.name.trim() : '';
                if (!attrName) continue;
                let rawValues = Array.isArray(attr.values) ? attr.values : (typeof attr.values === 'string' ? attr.values.split(',') : []);
                const cleanedValues = Array.from(new Set(rawValues.map(v => String(v).trim()).filter(Boolean)));
                if (cleanedValues.length > 0) {
                    assertSafeOptionText(attrName, 'Attribute name');
                    cleanedValues.forEach((v) => assertSafeOptionText(v, 'Option'));
                    cleanedAttrs.push({ name: attrName, values: cleanedValues });
                }
            }
            product.attributes = cleanedAttrs;
        }
    }
    if (sizes) {
        product.sizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
    }
    if (stock !== undefined && stock !== "" && !isNaN(Number(stock))) {
        product.stock = Math.max(0, parseInt(stock));
    }
    if (sizeStock !== undefined) {
        try {
            product.sizeStock = typeof sizeStock === 'string' ? JSON.parse(sizeStock) : sizeStock;
        } catch (e) {}
    }
    product.image = finalImages;

    if (variantImages !== undefined) {
        const slotUrls = Object.fromEntries(newSlots.map(([slot], i) => [slot, newImageUrls[i]]));
        product.variantImages = resolveVariantImages(variantImages, getEffectiveAttributes(product), finalImages, slotUrls);
    } else {
        // Drop links to removed images or attribute values
        product.variantImages = resolveVariantImages(product.variantImages || [], getEffectiveAttributes(product), finalImages);
    }

    // Re-validate against the (possibly changed) options and base price
    product.variantPrices = resolveVariantPrices(
        variantPrices !== undefined ? variantPrices : (product.variantPrices || []),
        getEffectiveAttributes(product),
        product.price
    );

    await product.save();

    res.status(200).json(
        new ApiResponse(200, product, "Product Updated Successfully")
    );
});

// Function for removing product
const removeProduct = asyncHandler(async(req, res) => {
    const { id, productId } = req.body;
    const targetId = id || productId;

    if (!isValidObjectId(targetId)) {
        throw new ApiError(400, "Invalid ProductId");
    }

    const product = await Product.findById(targetId);
    if (!product) {
        throw new ApiError(404, "Product Not Found");
    }

    // Role-based authorization: Sellers can only delete their own products, Admins can delete any
    if (req.user?.role === 'seller') {
        if (!product.sellerId || product.sellerId.toString() !== req.user.id?.toString()) {
            throw new ApiError(403, "Access denied: You can only delete products belonging to your store");
        }
    }

    await Product.findByIdAndDelete(targetId);

    res.status(200).json(
        new ApiResponse(200, {}, "Product Removed Successfully")
    );
});

// Function for single product info
const singleProduct = asyncHandler(async (req, res) => {

    const {productId, id} = req.body;
    const targetId = productId || id;

    if(!isValidObjectId(targetId)){
        throw new ApiError(400, "Invalid product Id");
    }

    const product = await Product.findById(targetId);

    if(!product){
        throw new ApiError(404, "Product Not Found");
    }

    res
    .status(200)
    .json(
        new ApiResponse(200, product, "Product Fetched Successfully")
    );
});

// Function for updating product discount specifically (Admin & Seller ACL)
const updateDiscount = asyncHandler(async (req, res) => {
    const { id, productId, discount } = req.body;
    const targetId = id || productId;

    if (!isValidObjectId(targetId)) {
        throw new ApiError(400, "Invalid Product ID");
    }

    if (discount === undefined || isNaN(Number(discount))) {
        throw new ApiError(400, "Discount value is required");
    }

    const numDiscount = Math.min(100, Math.max(0, Number(discount)));

    const product = await Product.findById(targetId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Role-based authorization: Sellers can only edit their own products, Admins can edit any
    if (req.user?.role === 'seller') {
        if (!product.sellerId || product.sellerId.toString() !== req.user.id?.toString()) {
            throw new ApiError(403, "Access denied: You can only set discounts on products belonging to your store");
        }
    }

    product.discount = numDiscount;
    await product.save();

    res.status(200).json(
        new ApiResponse(200, product, `Discount updated to ${numDiscount}% successfully`)
    );
});

// Function for Product Dashboard & Insights (Orders, Units, Revenue, Sizes, Reviews, Inventory)
const getProductInsights = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const targetId = productId || req.query.productId || req.body.productId;

    if (!isValidObjectId(targetId)) {
        throw new ApiError(400, "Invalid Product ID");
    }

    const product = await Product.findById(targetId);
    if (!product) {
        throw new ApiError(404, "Product not found");
    }

    // Role-based authorization:
    // Super Admin can view insights for any product
    // Seller can view insights for their own store's products
    if (req.user?.role === 'seller') {
        const sellerId = req.user.id?.toString();
        const productSellerId = product.sellerId ? product.sellerId.toString() : null;
        const isStoreMatch = product.storeName && req.user.storeName && 
            product.storeName.trim().toLowerCase() === req.user.storeName.trim().toLowerCase();

        if (productSellerId && productSellerId !== sellerId && !isStoreMatch) {
            throw new ApiError(403, "Access denied: You can only view insights for products from your store");
        }
    }

    // 1. Fetch all orders containing this product
    const orders = await Order.find({
        $or: [
            { "items._id": targetId.toString() },
            { "items._id": new mongoose.Types.ObjectId(targetId) },
            { "items.productId": targetId.toString() }
        ]
    }).sort({ date: -1 });

    const totalOrders = orders.length;
    let totalUnitsOrdered = 0;
    let totalUnitsSold = 0; // paid or delivered
    let totalRevenue = 0;   // paid or delivered
    let potentialRevenue = 0; // all orders including pending
    let pendingUnits = 0;

    const statusBreakdown = {
        "Order Placed": 0,
        "Packing": 0,
        "Shipped": 0,
        "Out for delivery": 0,
        "Delivered": 0,
        "Cancelled": 0
    };

    const sizeBreakdown = {};
    const paymentBreakdown = {
        Razorpay: { count: 0, units: 0, revenue: 0 },
        COD: { count: 0, units: 0, revenue: 0 }
    };

    const recentOrders = [];
    const monthlySalesMap = {};

    for (const order of orders) {
        // Find matching item(s) in order
        const matchingItems = (order.items || []).filter(item => {
            const iid = (item._id || item.productId)?.toString();
            return iid === targetId.toString();
        });

        const isDeliveredOrPaid = order.payment === true || order.status === "Delivered";

        for (const item of matchingItems) {
            const qty = Number(item.quantity) || 1;
            const price = Number(item.price) || Number(product.price) || 0;
            const subtotal = qty * price;
            const size = item.size || 'Standard';

            totalUnitsOrdered += qty;
            potentialRevenue += subtotal;

            if (isDeliveredOrPaid) {
                totalUnitsSold += qty;
                totalRevenue += subtotal;
            } else {
                pendingUnits += qty;
            }

            // Size demand breakdown
            sizeBreakdown[size] = (sizeBreakdown[size] || 0) + qty;

            // Payment breakdown
            const method = order.paymentMethod === 'Razorpay' ? 'Razorpay' : 'COD';
            if (paymentBreakdown[method]) {
                paymentBreakdown[method].count += 1;
                paymentBreakdown[method].units += qty;
                if (isDeliveredOrPaid) {
                    paymentBreakdown[method].revenue += subtotal;
                }
            }

            // Monthly sales trend
            const orderDate = order.date ? new Date(order.date) : (order.createdAt ? new Date(order.createdAt) : new Date());
            const monthKey = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlySalesMap[monthKey]) {
                monthlySalesMap[monthKey] = { month: monthKey, units: 0, revenue: 0, orders: 0 };
            }
            monthlySalesMap[monthKey].units += qty;
            if (isDeliveredOrPaid) {
                monthlySalesMap[monthKey].revenue += subtotal;
            }
            monthlySalesMap[monthKey].orders += 1;
        }

        // Status breakdown
        if (statusBreakdown[order.status] !== undefined) {
            statusBreakdown[order.status] += 1;
        } else {
            statusBreakdown[order.status] = 1;
        }

        // Add to recentOrders list (up to 15)
        if (recentOrders.length < 15 && matchingItems.length > 0) {
            const itemQty = matchingItems.reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
            const itemSizes = matchingItems.map(i => `${i.size || 'Standard'} (x${i.quantity || 1})`).join(', ');
            const itemSubtotal = matchingItems.reduce((acc, i) => acc + ((Number(i.quantity) || 1) * (Number(i.price) || Number(product.price) || 0)), 0);

            recentOrders.push({
                orderId: order._id,
                date: order.date || order.createdAt,
                customer: {
                    name: `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim() || 'Valued Customer',
                    email: order.address?.email || '',
                    phone: order.address?.phone || '',
                    city: order.address?.city || '',
                    country: order.address?.country || ''
                },
                sizes: itemSizes,
                quantity: itemQty,
                subtotal: itemSubtotal,
                status: order.status,
                paymentMethod: order.paymentMethod,
                payment: order.payment
            });
        }
    }

    // Sort monthly trend chronological
    const monthlySales = Object.values(monthlySalesMap).sort((a, b) => a.month.localeCompare(b.month));

    // 2. Fetch all reviews and compute statistics
    const reviews = await Review.find({ productId: new mongoose.Types.ObjectId(targetId) }).sort({ createdAt: -1 });
    const totalReviews = reviews.length;
    let ratingSum = 0;
    const reviewBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach((r) => {
        ratingSum += Number(r.rating) || 0;
        const rounded = Math.round(r.rating);
        if (reviewBreakdown[rounded] !== undefined) {
            reviewBreakdown[rounded] += 1;
        }
    });

    const averageRating = totalReviews > 0 ? Math.round((ratingSum / totalReviews) * 10) / 10 : (product.ratingAverage || 0);

    const breakdownPercentages = {};
    for (let star = 1; star <= 5; star++) {
        breakdownPercentages[star] = totalReviews > 0
            ? Math.round((reviewBreakdown[star] / totalReviews) * 100)
            : 0;
    }

    // 3. Stock & Inventory Insights
    const currentStock = product.stock !== undefined ? product.stock : 50;
    let sizeStockObj = {};
    if (product.sizeStock instanceof Map) {
        sizeStockObj = Object.fromEntries(product.sizeStock);
    } else if (typeof product.sizeStock === 'object' && product.sizeStock !== null) {
        sizeStockObj = product.sizeStock;
    }

    const stockStatus = currentStock === 0 ? "Out of Stock" : currentStock <= 10 ? "Low Stock" : "In Stock";
    const totalInventoryHandled = currentStock + totalUnitsOrdered;
    const sellThroughRate = totalInventoryHandled > 0 ? Math.round((totalUnitsOrdered / totalInventoryHandled) * 100) : 0;

    const insightsData = {
        product: {
            _id: product._id,
            name: product.name,
            description: product.description,
            price: product.price,
            discount: product.discount || 0,
            discountedPrice: product.discount > 0 ? Math.round(product.price * (1 - product.discount / 100)) : product.price,
            category: product.category,
            subCategory: product.subCategory,
            attributes: product.attributes || [],
            sizes: product.sizes || [],
            image: product.image || [],
            bestseller: !!product.bestseller,
            storeName: product.storeName || 'Forever Head Office',
            sellerId: product.sellerId,
            date: product.date,
            createdAt: product.createdAt
        },
        sales: {
            totalOrders,
            totalUnitsOrdered,
            totalUnitsSold,
            pendingUnits,
            totalRevenue,
            potentialRevenue,
            statusBreakdown,
            sizeBreakdown,
            paymentBreakdown,
            recentOrders,
            monthlySales
        },
        inventory: {
            currentStock,
            sizeStock: sizeStockObj,
            stockStatus,
            sellThroughRate,
            totalInventoryHandled
        },
        reviews: {
            stats: {
                totalReviews,
                averageRating,
                breakdown: reviewBreakdown,
                breakdownPercentages
            },
            items: reviews.map(r => ({
                _id: r._id,
                userName: r.userName,
                userId: r.userId,
                rating: r.rating,
                title: r.title,
                comment: r.comment,
                verifiedPurchase: r.verifiedPurchase,
                createdAt: r.createdAt
            }))
        }
    };

    res.status(200).json(
        new ApiResponse(200, insightsData, "Product insights fetched successfully")
    );
});

export {
    addProducts,
    listProducts,
    updateProduct,
    removeProduct,
    singleProduct,
    updateDiscount,
    getProductInsights
}




