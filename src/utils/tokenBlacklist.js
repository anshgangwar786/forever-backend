import { TokenBlacklist } from '../models/tokenBlacklist.model.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * Standardize and extract token from request headers or cookies.
 * Supports req.headers.token, req.headers.authorization, Bearer prefixes, and cookies.
 */
export const extractToken = (req) => {
    if (!req) return null;
    let token = req.headers?.token || req.headers?.authorization;
    if (!token && req.cookies) {
        token = req.cookies.token;
    }
    if (typeof token === 'string') {
        token = token.trim();
        if (token.startsWith('Bearer ') || token.startsWith('bearer ')) {
            token = token.slice(7).trim();
        }
    }
    return token || null;
};

/**
 * Compute SHA-256 hash of a token
 */
export const hashToken = (token) => {
    if (!token) return '';
    const cleanToken = (token.startsWith('Bearer ') || token.startsWith('bearer '))
        ? token.slice(7).trim()
        : token.trim();
    return crypto.createHash('sha256').update(cleanToken).digest('hex');
};

/**
 * Check if a token has been blacklisted / revoked
 */
export const isTokenBlacklisted = async (token) => {
    if (!token) return false;
    try {
        const tokenHash = hashToken(token);
        const found = await TokenBlacklist.exists({ tokenHash });
        return Boolean(found);
    } catch (error) {
        console.error("Error checking token blacklist:", error.message);
        return false;
    }
};

/**
 * Add a token to the blacklist with SHA-256 hash and TTL auto-cleanup
 */
export const blacklistToken = async (token) => {
    if (!token) return null;
    try {
        const cleanToken = (token.startsWith('Bearer ') || token.startsWith('bearer '))
            ? token.slice(7).trim()
            : token.trim();
        const decoded = jwt.decode(cleanToken);
        // Default expiry to 7 days from now if not present in token
        const expiresAt = decoded?.exp 
            ? new Date(decoded.exp * 1000) 
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        
        const tokenHash = hashToken(cleanToken);

        return await TokenBlacklist.findOneAndUpdate(
            { tokenHash },
            { tokenHash, expiresAt },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (error) {
        console.error("Error blacklisting token:", error.message);
        throw error;
    }
};
