import mongoose from 'mongoose'

const attributeSchema = new mongoose.Schema({
   name: { type: String, required: true, trim: true },
   values: [{ type: String, required: true, trim: true }]
}, { _id: false });

// Links one attribute value (e.g. Color = "Silver Gray") to one of the product's image URLs
const variantImageSchema = new mongoose.Schema({
   attribute: { type: String, required: true, trim: true },
   value: { type: String, required: true, trim: true },
   image: { type: String, required: true, trim: true }
}, { _id: false });

const variantPriceSchema = new mongoose.Schema({
   attribute: { type: String, required: true, trim: true },
   value: { type: String, required: true, trim: true },
   priceDelta: { type: Number, required: true }
}, { _id: false });

const productSchema = new mongoose.Schema({
   name: { type: String, required: true, trim: true, index: true },
   description: { type: String, required: true },
   price: { type: Number, required: true, index: true },
   image: { type: Array, required: true },
   category: { type: String, required: true, index: true },
   subCategory: { type: String, required: true, index: true },
   // Dynamic attributes array replacing static apparel sizes
   attributes: {
      type: [attributeSchema],
      default: []
   },
   variantImages: {
      type: [variantImageSchema],
      default: []
   },
   // Price adjustment per attribute value (e.g. Size = "XL" → +20); see utils/variantPricing.js
   variantPrices: {
      type: [variantPriceSchema],
      default: []
   },
   // Backward compatibility for existing records
   sizes: { type: Array, default: [] },
   stock: { type: Number, default: 50, min: 0, index: true },
   sizeStock: { type: Map, of: Number, default: {} },
   bestseller: { type: Boolean, default: false, index: true },
   date: { type: Number, required: true, index: true },
   sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
   storeName: { type: String, default: '' },
   discount: { type: Number, default: 0, min: 0, max: 100 },
   ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
   ratingCount: { type: Number, default: 0 }
}, { timestamps: true })

// Text index for full-text search
productSchema.index({ name: 'text', description: 'text', category: 'text' })

// Compound index for category/subcategory and price range queries
productSchema.index({ category: 1, subCategory: 1, price: 1 })
productSchema.index({ "attributes.name": 1, "attributes.values": 1 })
productSchema.index({ date: -1 })

export const Product = mongoose.model('Product',productSchema)