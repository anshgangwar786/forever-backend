import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';

/**
 * Generate a new Base32 secret for TOTP
 */
export const createTOTPSecret = () => {
    return generateSecret();
};

/**
 * Generate an otpauth URI for Authenticator apps
 */
export const createTOTPUri = (email, secret, issuer = 'Forever Store') => {
    return generateURI({
        issuer,
        label: email,
        secret
    });
};

/**
 * Generate a QR Code Data URL from the otpauth URI
 */
export const createQRCodeDataURL = async (otpauthUri) => {
    return await QRCode.toDataURL(otpauthUri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 256
    });
};

/**
 * Verify a 6-digit TOTP code against a secret
 * epochTolerance: 30 allows +/- 1 step (30s window) for network/device time drift
 */
export const verifyTOTPCode = (token, secret) => {
    if (!token || !secret) return false;
    const cleanToken = String(token).trim();
    const result = verifySync({
        token: cleanToken,
        secret,
        epochTolerance: 30
    });
    return result && result.valid === true;
};

/**
 * Generate 8 single-use recovery / backup codes formatted as XXXX-XXXX
 */
export const generateBackupCodes = (count = 8) => {
    const codes = [];
    for (let i = 0; i < count; i++) {
        const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    }
    return codes;
};

/**
 * Normalize a backup code by removing spaces/hyphens and uppercasing
 */
export const normalizeBackupCode = (code) => {
    if (!code) return '';
    return String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
};
