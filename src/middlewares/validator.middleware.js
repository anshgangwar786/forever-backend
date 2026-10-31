import validator from 'validator';
import { ApiError } from '../utils/ApiError.js';

/**
 * Recursive sanitizer to neutralize NoSQL injection characters ($ and .)
 * from request body, query parameters, and route params.
 */
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        // Strip leading dollar signs or dots which represent MongoDB query operators
        const cleanKey = key.replace(/^\$|\./g, '');
        if (typeof value === 'object' && value !== null) {
            sanitized[cleanKey] = sanitizeObject(value);
        } else if (typeof value === 'string') {
            sanitized[cleanKey] = value.trim();
        } else {
            sanitized[cleanKey] = value;
        }
    }
    return sanitized;
};

/**
 * Middleware: Sanitize all incoming request inputs
 * Note: Express 5 defines req.query as a getter, so we mutate its properties in-place.
 */
export const sanitizeInputs = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        for (const key of Object.keys(req.query)) {
            if (typeof req.query[key] === 'string') {
                req.query[key] = req.query[key].replace(/^\$|\./g, '').trim();
            }
        }
    }
    if (req.params && typeof req.params === 'object') {
        for (const key of Object.keys(req.params)) {
            if (typeof req.params[key] === 'string') {
                req.params[key] = req.params[key].replace(/^\$|\./g, '').trim();
            }
        }
    }
    next();
};

/**
 * Validation middleware for User Registration
 */
export const validateRegistration = (req, res, next) => {
    const { name, email, password } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new ApiError(400, "Full name is required");
    }

    if (!email || !validator.isEmail(email.trim())) {
        throw new ApiError(400, "A valid email address is required");
    }

    if (!password || password.length < 8) {
        throw new ApiError(400, "Password must be at least 8 characters long");
    }

    req.body.email = email.trim().toLowerCase();
    req.body.name = name.trim();
    next();
};

/**
 * Validation middleware for Orders
 */
export const validateOrderInput = (req, res, next) => {
    const { items, amount, address } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, "Order must contain at least one item");
    }

    if (typeof amount !== 'number' || amount <= 0) {
        const numAmount = Number(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            throw new ApiError(400, "Order amount must be a positive number");
        }
        req.body.amount = numAmount;
    }

    if (!address || typeof address !== 'object') {
        throw new ApiError(400, "Valid delivery address is required");
    }

    next();
};
