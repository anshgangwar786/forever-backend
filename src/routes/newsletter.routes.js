import { Router } from 'express'
import validator from 'validator'
import { NewsletterSubscriber } from '../models/newsletter.model.js'
import { ApiResponse } from '../utils/ApiResponse.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

const router = Router()

// Public: subscribe an email to offers. Re-subscribing is a no-op so it can't be used to probe who is subscribed.
router.route('/subscribe').post(asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!validator.isEmail(email)) {
        throw new ApiError(400, "Please enter a valid email address")
    }

    await NewsletterSubscriber.updateOne(
        { email },
        { $setOnInsert: { email, source: 'storefront' } },
        { upsert: true }
    )

    res.status(200).json(new ApiResponse(200, null, "You're subscribed. Watch your inbox for offers."))
}))

export default router
