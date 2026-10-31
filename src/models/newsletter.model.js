import mongoose from 'mongoose'

const newsletterSubscriberSchema = new mongoose.Schema({
   email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254
   },
   source: { type: String, default: 'storefront', trim: true }
}, { timestamps: true })

export const NewsletterSubscriber = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema)
