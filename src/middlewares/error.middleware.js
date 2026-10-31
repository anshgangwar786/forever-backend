import {ApiResponse} from '../utils/ApiResponse.js'

export const errorMiddleware = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || "Something went wrong";

    // MongoDB Duplicate Key Error (E11000)
    if (err.code === 11000) {
        statusCode = 409;
        const field = Object.keys(err.keyValue || {})[0] || "Field";
        message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    }

    // Multer upload errors (file too large, too many files, unexpected field)
    else if (err.name === 'MulterError') {
        statusCode = 400;
        message = err.code === 'LIMIT_FILE_SIZE' ? "Image is too large (max 5 MB)" : err.message;
    }

    // Mongoose Validation Error
    else if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // Invalid MongoDB ObjectId (CastError)
    else if (err.name === 'CastError') {
        statusCode = 400;
        message = `Resource not found. Invalid: ${err.path}`;
    }

    // JWT Errors
    else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = "Invalid token. Please authenticate again.";
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = "Session expired. Please log in again.";
    }

    // Mongoose Buffering / Disconnected Timeout
    else if (err.name === 'MongooseError' && err.message?.includes('buffering timed out')) {
        statusCode = 503;
        message = "Database connection unavailable. Please verify MONGODB_URI in backend/.env";
    }

    // Unexpected errors: log the detail server-side, never leak internals to clients in production
    if (statusCode >= 500) {
        console.error(err);
        if (process.env.NODE_ENV === 'production' && !err.statusCode) {
            message = "Internal server error";
        }
    }

    return res.status(statusCode).json({
        statusCode,
        success: false,
        message,
        data: {}
    });
};