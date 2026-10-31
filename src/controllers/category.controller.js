import { Category, slugify } from '../models/category.model.js';
import { Product } from '../models/product.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { DEFAULT_CATEGORY_EMOJIS } from '../utils/categoryEmojis.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import mongoose from 'mongoose';

/**
 * Helper to check if potentialParentId is a descendant of categoryId (preventing circular hierarchy)
 */
const isDescendant = async (categoryId, potentialParentId) => {
    let current = await Category.findById(potentialParentId);
    while (current && current.parentCategory) {
        if (current.parentCategory.toString() === categoryId.toString()) {
            return true;
        }
        current = await Category.findById(current.parentCategory);
    }
    return false;
};

/**
 * Public Read: List Categories (Hierarchical or Populated Flat List)
 * GET /api/v1/category
 * Query params:
 *   - hierarchy=true (returns root categories with nested subCategories)
 *   - root=true (returns only root/primary categories)
 *   - search=... (filters by name or slug)
 */
export const listCategories = asyncHandler(async (req, res) => {
    const { hierarchy, root, search } = req.query;

    const filter = {};
    if (search && search.trim()) {
        const regex = new RegExp(search.trim(), 'i');
        filter.$or = [{ name: regex }, { slug: regex }, { description: regex }];
    }

    if (root === 'true') {
        filter.parentCategory = null;
    }

    // Auto-seed default categories if collection is completely empty
    const count = await Category.countDocuments({});
    if (count === 0) {
        const seedRoots = [
            { name: "Beauty & Personal Care", slug: "beauty-personal-care", description: "Skincare, haircare and fragrances" },
            { name: "Electronics", slug: "electronics", description: "Smartphones, laptops, audio and gadgets" },
            { name: "Fashion & Apparel", slug: "fashion-apparel", description: "Men, women and kids fashion" },
            { name: "Furniture", slug: "furniture", description: "Living room, bedroom, office and modern furniture" },
            { name: "Home & Kitchen", slug: "home-kitchen", description: "Appliances, cookware and home decor" },
            { name: "Sports & Fitness", slug: "sports-fitness", description: "Gym equipment and athletic gear" }
        ];
        const createdRoots = await Category.insertMany(
            seedRoots.map(r => ({ ...r, emoji: DEFAULT_CATEGORY_EMOJIS[r.slug] || '' }))
        );
        const rootMap = new Map(createdRoots.map(r => [r.slug, r._id]));

        const seedSubs = [
            { name: "Skincare", slug: "skincare", parentCategory: rootMap.get("beauty-personal-care") },
            { name: "Haircare", slug: "haircare", parentCategory: rootMap.get("beauty-personal-care") },
            { name: "Fragrances", slug: "fragrances", parentCategory: rootMap.get("beauty-personal-care") },
            { name: "Makeup", slug: "makeup", parentCategory: rootMap.get("beauty-personal-care") },
            { name: "Smartphones", slug: "smartphones", parentCategory: rootMap.get("electronics") },
            { name: "Laptops", slug: "laptops", parentCategory: rootMap.get("electronics") },
            { name: "Audio & Headphones", slug: "audio-headphones", parentCategory: rootMap.get("electronics") },
            { name: "Wearables & Smartwatches", slug: "wearables-smartwatches", parentCategory: rootMap.get("electronics") },
            { name: "Men's Wear", slug: "mens-wear", parentCategory: rootMap.get("fashion-apparel") },
            { name: "Women's Wear", slug: "womens-wear", parentCategory: rootMap.get("fashion-apparel") },
            { name: "Footwear", slug: "footwear", parentCategory: rootMap.get("fashion-apparel") },
            { name: "Accessories", slug: "accessories", parentCategory: rootMap.get("fashion-apparel") },
            { name: "Living Room", slug: "living-room", parentCategory: rootMap.get("furniture") },
            { name: "Bedroom", slug: "bedroom", parentCategory: rootMap.get("furniture") },
            { name: "Dining & Kitchen", slug: "dining-kitchen", parentCategory: rootMap.get("furniture") },
            { name: "Office Furniture", slug: "office-furniture", parentCategory: rootMap.get("furniture") },
            { name: "Cookware", slug: "cookware", parentCategory: rootMap.get("home-kitchen") },
            { name: "Small Appliances", slug: "small-appliances", parentCategory: rootMap.get("home-kitchen") },
            { name: "Gym Equipment", slug: "gym-equipment", parentCategory: rootMap.get("sports-fitness") },
            { name: "Athletic Gear", slug: "athletic-gear", parentCategory: rootMap.get("sports-fitness") },
            { name: "Fitness Accessories", slug: "fitness-accessories", parentCategory: rootMap.get("sports-fitness") },
            { name: "Sports Apparel", slug: "sports-apparel", parentCategory: rootMap.get("sports-fitness") }
        ];
        await Category.insertMany(
            seedSubs.map(s => ({ ...s, emoji: DEFAULT_CATEGORY_EMOJIS[s.slug] || '' }))
        );
    }

    // Hierarchical Tree Query
    if (hierarchy === 'true') {
        const primaryCategories = await Category.find({ parentCategory: null })
            .populate({
                path: 'subCategories',
                options: { sort: { name: 1 } }
            })
            .sort({ name: 1 });

        return res.status(200).json(
            new ApiResponse(200, primaryCategories, "Hierarchical categories fetched successfully")
        );
    }

    // Flat list populated with parent details
    const categories = await Category.find(filter)
        .populate('parentCategory', 'name slug emoji')
        .sort({ parentCategory: 1, name: 1 });

    res.status(200).json(
        new ApiResponse(200, categories, "Categories fetched successfully")
    );
});

/**
 * Public Read: Single Category Details
 * GET /api/v1/category/:id
 */
export const getCategoryById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        throw new ApiError(400, "Invalid Category ID");
    }

    const category = await Category.findById(id)
        .populate('parentCategory', 'name slug')
        .populate('subCategories');

    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    res.status(200).json(
        new ApiResponse(200, category, "Category fetched successfully")
    );
});

/**
 * Admin ONLY: Create New Category or Sub-Category
 * POST /api/v1/category
 */
export const createCategory = asyncHandler(async (req, res) => {
    const { name, slug: providedSlug, description = '', image = '', emoji = '', parentCategory } = req.body;

    if (!name?.trim()) {
        throw new ApiError(400, "Category name is required");
    }

    const cleanName = name.trim();
    const finalSlug = slugify(providedSlug || cleanName);

    if (!finalSlug) {
        throw new ApiError(400, "Valid category slug could not be generated");
    }

    // Verify slug uniqueness
    const existingSlug = await Category.findOne({ slug: finalSlug });
    if (existingSlug) {
        throw new ApiError(409, `A category with slug '${finalSlug}' already exists. Please provide a unique slug.`);
    }

    // Validate parentCategory if specified
    let validParentId = null;
    if (parentCategory && parentCategory !== 'null' && parentCategory !== '') {
        if (!mongoose.isValidObjectId(parentCategory)) {
            throw new ApiError(400, "Invalid parentCategory ID format");
        }
        const parentDoc = await Category.findById(parentCategory);
        if (!parentDoc) {
            throw new ApiError(404, "Specified parent category does not exist");
        }
        validParentId = parentDoc._id;
    }

    const category = await Category.create({
        name: cleanName,
        slug: finalSlug,
        description: description?.trim() || '',
        image: image?.trim() || '',
        emoji: emoji?.trim() || '',
        parentCategory: validParentId
    });

    const populatedCategory = await Category.findById(category._id).populate('parentCategory', 'name slug emoji');

    res.status(201).json(
        new ApiResponse(201, populatedCategory, "Category created successfully")
    );
});

/**
 * Admin ONLY: Update Category Details
 * PUT /api/v1/category/:id
 */
export const updateCategory = asyncHandler(async (req, res) => {
    const targetId = req.params.id || req.body.id;
    const { name, slug: providedSlug, description, image, emoji, parentCategory } = req.body;

    if (!targetId || !mongoose.isValidObjectId(targetId)) {
        throw new ApiError(400, "Valid Category ID is required");
    }

    const category = await Category.findById(targetId);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    // 1. Update Name
    if (name?.trim()) {
        category.name = name.trim();
    }

    // 2. Update Slug if changed
    if (providedSlug?.trim()) {
        const newSlug = slugify(providedSlug);
        if (newSlug !== category.slug) {
            const existingSlug = await Category.findOne({ slug: newSlug, _id: { $ne: category._id } });
            if (existingSlug) {
                throw new ApiError(409, `Slug '${newSlug}' is already taken by another category.`);
            }
            category.slug = newSlug;
        }
    }

    // 3. Update Parent Category with Circular Reference Protection
    if (parentCategory !== undefined) {
        if (!parentCategory || parentCategory === 'null' || parentCategory === '') {
            category.parentCategory = null;
        } else {
            if (!mongoose.isValidObjectId(parentCategory)) {
                throw new ApiError(400, "Invalid parentCategory ID format");
            }
            if (parentCategory.toString() === category._id.toString()) {
                throw new ApiError(400, "A category cannot be its own parent");
            }

            // Prevent circular lineage
            const causesLoop = await isDescendant(category._id, parentCategory);
            if (causesLoop) {
                throw new ApiError(400, "Circular reference detected: cannot select a descendant sub-category as a parent");
            }

            const parentDoc = await Category.findById(parentCategory);
            if (!parentDoc) {
                throw new ApiError(404, "Specified parent category does not exist");
            }
            category.parentCategory = parentDoc._id;
        }
    }

    if (description !== undefined) category.description = description.trim();
    if (image !== undefined) category.image = image.trim();
    if (emoji !== undefined) category.emoji = emoji.trim();

    await category.save();

    const updatedCategory = await Category.findById(category._id).populate('parentCategory', 'name slug emoji');

    res.status(200).json(
        new ApiResponse(200, updatedCategory, "Category updated successfully")
    );
});

/**
 * Admin ONLY: Delete Category
 * DELETE /api/v1/category/:id
 * Prevents deletion if products are actively linked to this category or if child sub-categories exist.
 */
export const deleteCategory = asyncHandler(async (req, res) => {
    const targetId = req.params.id || req.body.id;

    if (!targetId || !mongoose.isValidObjectId(targetId)) {
        throw new ApiError(400, "Valid Category ID is required");
    }

    const category = await Category.findById(targetId);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    // 1. Relational Integrity Check: Prevent deletion if products actively link to this category
    const linkedProductsCount = await Product.countDocuments({
        $or: [
            { category: category.name },
            { category: category.slug },
            { subCategory: category.name },
            { subCategory: category.slug }
        ]
    });

    if (linkedProductsCount > 0) {
        throw new ApiError(
            400,
            `Cannot delete category '${category.name}': ${linkedProductsCount} product(s) are actively linked to it. Please reassign or delete those products first.`
        );
    }

    // 2. Relational Integrity Check: Prevent deletion if sub-categories depend on this category
    const childCategoriesCount = await Category.countDocuments({
        parentCategory: category._id
    });

    if (childCategoriesCount > 0) {
        throw new ApiError(
            400,
            `Cannot delete category '${category.name}': ${childCategoriesCount} sub-category(ies) are currently assigned to it. Please delete or reassign them first.`
        );
    }

    await Category.findByIdAndDelete(category._id);

    res.status(200).json(
        new ApiResponse(200, { id: category._id }, `Category '${category.name}' deleted successfully`)
    );
});
