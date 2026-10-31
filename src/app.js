import express from 'express'
import cors from 'cors'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { sanitizeInputs } from './middlewares/validator.middleware.js'
import { apiLimiter, authLimiter } from './middlewares/rateLimiter.middleware.js'
import { ApiError } from './utils/ApiError.js'
import userRoutes from './routes/user.routes.js'
import productRoutes from './routes/product.routes.js'
import cartRoutes from './routes/cart.routes.js'
import orderRoutes from './routes/order.routes.js'
import paymentRoutes from './routes/payment.routes.js'
import categoryRoutes from './routes/category.routes.js'
import reviewRoutes from './routes/review.routes.js'
import newsletterRoutes from './routes/newsletter.routes.js'
import { checkout, paymentWebhook } from './controllers/order.controller.js'
import authUser from './middlewares/auth.js'
import { restrictRoles } from './middlewares/acl.middleware.js'
import { verifyWebhookSignature } from './middlewares/paymentVerification.middleware.js'
import cookieParser from 'cookie-parser'
 
const app = express()

app.disable('x-powered-by')
// Behind Vercel/NGINX the client IP arrives in X-Forwarded-For; needed for per-IP rate limiting
app.set('trust proxy', 1)

// Only the storefront and admin panel may make credentialed cross-origin calls.
// Extra origins (e.g. preview deployments) can be supplied as a comma-separated CORS_ORIGINS.
const allowedOrigins = new Set(
    [process.env.FRONTEND_URL, process.env.ADMIN_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
        .map(origin => origin?.trim().replace(/\/+$/, ''))
        .filter(Boolean)
)
const isDev = process.env.NODE_ENV !== 'production'

app.use(cors({
    origin: (origin, callback) => {
        // Server-to-server calls (webhooks, curl) send no Origin header
        if (!origin || allowedOrigins.has(origin)) return callback(null, true)
        if (isDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true)
        return callback(new ApiError(403, `Origin ${origin} is not allowed by CORS`))
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
}))

app.use(express.json({
    limit: "16kb",
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}))
app.use(express.urlencoded({
    extended: true,
    limit: "16kb"
}))
app.use(cookieParser())

// Data sanitization against NoSQL injection
app.use(sanitizeInputs)

// General API Rate Limiting
app.use('/api', apiLimiter)

app.get("/", (req, res) => {
  res.send("Forever eCommerce API is running...");
});

// Guard for consumer checkout & order placement
const buyerOnlyGuard = [authUser, restrictRoles(['admin', 'seller'], "Admins and Sellers do not place consumer orders")];

// Direct checkout & webhook routes
app.post('/checkout', buyerOnlyGuard, checkout);
app.post('/webhook', verifyWebhookSignature, paymentWebhook);

// Strict brute-force limiter only on endpoints that accept credentials or create accounts;
// profile / 2FA status calls use the general API limit so normal browsing can't lock users out of login
app.use([
    '/api/v1/user/login',
    '/api/v1/user/admin',
    '/api/v1/user/register',
    '/api/v1/user/register-seller',
    '/api/v1/user/seller/register',
    '/api/v1/user/2fa/verify-login',
    '/api/v1/user/2fa/disable',
    '/api/v1/newsletter'
], authLimiter)
app.use('/api/v1/user', userRoutes)
app.use('/api/v1/product', productRoutes)
app.use('/api/v1/cart', cartRoutes)
app.use('/api/v1/order', orderRoutes)
app.use('/api/v1/payment', paymentRoutes)
app.use('/api/v1/category', categoryRoutes)
app.use('/api/v1/review', reviewRoutes)
app.use('/api/v1/newsletter', newsletterRoutes)

// 404 Catch-all for undefined routes
app.use((req, res, next) => {
    next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found`));
});

app.use(errorMiddleware)

export { app }
