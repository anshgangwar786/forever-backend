import mongoose from 'mongoose';
import crypto from 'crypto';

const tokenBlacklistSchema = new mongoose.Schema({
    tokenHash: { // Renamed for clarity and security (SHA-256)
        type: String,
        required: true,
        unique: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        expires: 0 // MongoDB TTL index: documents are automatically deleted when expiresAt is reached
    }
}, { timestamps: true });

// Pre-save hook to automatically hash the token before saving
tokenBlacklistSchema.pre('save', function (next) {
    if (this.isModified('tokenHash')) {
        // Hash only if not already a 64-character SHA-256 hex string
        if (!/^[a-f0-9]{64}$/i.test(this.tokenHash)) {
            this.tokenHash = crypto.createHash('sha256').update(this.tokenHash).digest('hex');
        }
    }
    if (typeof next === 'function') next();
});

export const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
