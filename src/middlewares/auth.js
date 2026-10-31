import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted, extractToken } from "../utils/tokenBlacklist.js";

const authUser = asyncHandler(async (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
        throw new ApiError(401, "First You Have To Login");
    }

    if (await isTokenBlacklisted(token)) {
        throw new ApiError(401, "Session expired or logged out. Please login again.");
    }

    try {
        let token_decode;
        try {
            token_decode = jwt.verify(token, process.env.JWT_TOKEN_SECRET);
        } catch (err) {
            token_decode = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
        }

        if (token_decode.purpose === '2fa_pending') {
            throw new ApiError(401, "Two-factor authentication pending. Please verify your 2FA code.");
        }

        req.user = {
            id: token_decode.id,
            email: token_decode.email,
            role: token_decode.role || 'user'
        };
        req.role = req.user.role;
        if (!req.body) req.body = {};
        if (req.body.userId && req.body.userId.toString() !== token_decode.id.toString()) {
            req.targetUserId = req.body.userId;
        } else {
            req.body.userId = token_decode.id; // backward compatibility
        }
        next();

    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(401, "Invalid or Expired Token Please login again");
    }
});

export default authUser;
