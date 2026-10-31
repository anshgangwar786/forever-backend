import rateLimit from 'express-rate-limit';

// Strict rate limiter for authentication routes (login, register, admin login)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        statusCode: 429,
        success: false,
        message: "Too many authentication requests from this IP. Please try again in 15 minutes.",
        data: {}
    }
});

// General rate limiter for all public API endpoints
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 600, // 600 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        statusCode: 429,
        success: false,
        message: "Too many requests from this IP. Please slow down.",
        data: {}
    }
});
