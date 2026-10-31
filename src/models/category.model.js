import mongoose from 'mongoose';

/**
 * Slugify utility helper
 */
export const slugify = (text = '') => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')   // Remove invalid chars
        .replace(/[\s_-]+/g, '-')    // Swap whitespace/underscores for single hyphen
        .replace(/^-+|-+$/g, '');    // Trim leading/trailing hyphens
};

/**
 * Category Schema
 * Represents product taxonomy: Primary Categories and nested Sub-Categories.
 */
const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Category name is required'],
            trim: true,
            index: true
        },
        slug: {
            type: String,
            required: [true, 'Category slug is required'],
            unique: true,
            trim: true,
            lowercase: true,
            index: true
        },
        description: {
            type: String,
            default: '',
            trim: true
        },
        image: {
            type: String,
            default: '',
            trim: true
        },
        emoji: {
            type: String,
            default: '',
            trim: true
        },
        parentCategory: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
            index: true
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Pre-validate hook: auto-generate slug from name if not provided
categorySchema.pre('validate', function () {
    if (!this.slug && this.name) {
        this.slug = slugify(this.name);
    } else if (this.slug) {
        this.slug = slugify(this.slug);
    }
});

// Virtual for sub-categories
categorySchema.virtual('subCategories', {
    ref: 'Category',
    localField: '_id',
    foreignField: 'parentCategory'
});

export const Category = mongoose.model('Category', categorySchema);
