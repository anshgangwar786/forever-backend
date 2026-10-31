import jwt from 'jsonwebtoken'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/ApiError.js'
import { isTokenBlacklisted, extractToken } from '../utils/tokenBlacklist.js'

const adminAuth = asyncHandler(async (req, res, next) => {
    try {
        const token = extractToken(req);
    
        if (!token) {
            throw new ApiError(401, "Admin / Seller Not Logged In");
        }

        if (await isTokenBlacklisted(token)) {
            throw new ApiError(401, "Session expired or logged out. Please login again.");
        }
    
        let decodeData;
        try {
            decodeData = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
        } catch (err) {
            decodeData = jwt.verify(token, process.env.JWT_TOKEN_SECRET);
        }
    
        if (decodeData.purpose === '2fa_pending') {
            throw new ApiError(401, "Two-factor authentication pending. Please verify your 2FA code.");
        }

        if (decodeData.role !== 'admin' && decodeData.role !== 'seller') {
            throw new ApiError(403, "Access denied: Admin or Seller role required");
        }

        req.user = {
            id: decodeData.id,
            email: decodeData.email,
            role: decodeData.role,
            name: decodeData.name,
            storeName: decodeData.storeName
        };
        req.role = decodeData.role;

        next();
    } catch (error) {
        if (error instanceof ApiError) {
            throw error; 
        }
        throw new ApiError(401, "Invalid or Expired Token");
    } 
});

export default adminAuth;
