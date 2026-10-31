import {asyncHandler} from '../utils/asyncHandler.js'
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import validator from 'validator'
import mongoose from 'mongoose'
import { User } from '../models/user.model.js'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { blacklistToken, extractToken } from '../utils/tokenBlacklist.js'
import {
    createTOTPSecret,
    createTOTPUri,
    createQRCodeDataURL,
    verifyTOTPCode,
    generateBackupCodes,
    normalizeBackupCode
} from '../utils/totp.js'

const generateUserToken = async function(userId){
   try {
     const user = await User.findById(userId)
     if(!user){
         throw new ApiError(404,"User Not Found while generate tokens")
     }
 
     const token = user.generateJwtToken()
     return token;
   } catch (error) {

        if (error instanceof ApiError) {
            throw error  
        }

        throw new ApiError(500, "Something went wrong while generating token")
    }
}


const register = asyncHandler(async (req , res) => {
    const {name,email,password} = req.body

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
        throw new ApiError(400, "All fields are required")
    }

    if(!validator.isEmail(email.trim())){
        throw new ApiError(400,"Invalid email")
    }

    const existUser = await User.findOne({email : email.trim()})
    if(existUser){
        throw new ApiError(409,"User Already exist")
    }

    if(password.length < 8){
        throw new ApiError(400,"Password must be 8 characters")
    }

    const user = await User.create({
        name,
        email:email.trim(),
        password
    })

    const token = await generateUserToken(user._id)
    const createdUser = await User.findById(user._id).select("-password")


    res
    .status(201)
    .json(
        new ApiResponse(201,token,"User Registered Successfully")
    )

})

const login = asyncHandler(async(req , res) => {
    const {email,password} = req.body
    if(email.trim() == '' || !password?.trim()){
        throw new ApiError(400, "All Filds are required")
    }

    if(!validator.isEmail(email.trim())){
        throw new ApiError(400,"Invalid email")
    }

    const user = await User.findOne({email:email.trim()})

    if(!user){
       throw new ApiError(401,"Invalid email or password")
    }

    const passwordCheck = await user.isPasswordCorrect(password)

    if(!passwordCheck){
        throw new ApiError(401,"Invalid email or password")
    }

    if (user.twoFactorEnabled) {
        const tempToken = jwt.sign(
            {
                id: user._id,
                email: user.email,
                role: user.role || 'user',
                purpose: '2fa_pending',
                isAdmin: false
            },
            process.env.JWT_TOKEN_SECRET,
            { expiresIn: '5m' }
        );

        return res.status(200).json(
            new ApiResponse(
                200,
                { requires2FA: true, tempToken },
                "Two-factor authentication code required"
            )
        );
    }

    const token = await generateUserToken(user._id);

    const safeUser = user.toObject()
    delete safeUser.password

    res.status(200)
    
    .json(
        new ApiResponse(200,token,"User successfully login")
    )


})

// Constant-time string comparison (hash first so differing lengths don't leak via timing)
const safeEqual = (a, b) => {
    const hashA = crypto.createHash('sha256').update(String(a)).digest();
    const hashB = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(hashA, hashB);
};

const adminLogin = asyncHandler(async (req, res) => {

    const { email, password } = req.body;

    const configuredEmail = (process.env.ADMIN_EMAIL || "admin@forever.com").trim().toLowerCase();
    // No default password: if ADMIN_PASSWORD is unset the env super-admin login is simply disabled
    const configuredPassword = (process.env.ADMIN_PASSWORD || "").trim();

    const providedEmail = email ? email.trim().toLowerCase() : "";
    const providedPassword = password ? password.trim() : "";

    if (!providedEmail || !providedPassword) {
        throw new ApiError(400, "Email and password are required");
    }

    // 1. Check configured env Super Admin
    if (
        configuredPassword &&
        providedEmail === configuredEmail &&
        safeEqual(providedPassword, configuredPassword)
    ) {
        let superAdminUser = await User.findOne({ email: configuredEmail });
        if (!superAdminUser) {
            superAdminUser = await User.create({
                name: "Super Admin",
                email: configuredEmail,
                password: configuredPassword,
                role: "admin",
                storeName: "Forever Head Office"
            });
        }

        if (superAdminUser.twoFactorEnabled) {
            const tempToken = jwt.sign(
                {
                    id: superAdminUser._id,
                    email: superAdminUser.email,
                    name: superAdminUser.name,
                    storeName: superAdminUser.storeName,
                    role: 'admin',
                    purpose: '2fa_pending',
                    isAdmin: true
                },
                process.env.ADMIN_JWT_SECRET,
                { expiresIn: "5m" }
            );

            return res
                .status(200)
                .json(
                    new ApiResponse(200, { requires2FA: true, tempToken }, "Two-factor authentication code required")
                );
        }

        const token = jwt.sign(
            { 
              id: superAdminUser._id,
              email: configuredEmail,
              name: "Super Admin",
              storeName: "Forever Head Office",
              role: "admin"
            },
            process.env.ADMIN_JWT_SECRET,
            { expiresIn: "24h" }
        );

        return res
            .status(200)
            .json(
                new ApiResponse(200, token, "Admin Login Successfully")
            );

    }

    // 2. Check registered Seller / Admin in database
    const user = await User.findOne({ email: providedEmail });

    if (!user) {
        throw new ApiError(401, "Invalid Admin / Seller Credentials");
    }

    if (user.role !== 'admin' && user.role !== 'seller') {
        throw new ApiError(403, "Access denied: Account is not registered as a seller or admin");
    }

    const isMatch = await user.isPasswordCorrect(providedPassword);
    if (!isMatch) {
        throw new ApiError(401, "Invalid Admin / Seller Credentials");
    }

    if (user.twoFactorEnabled) {
        const tempToken = jwt.sign(
            {
                id: user._id,
                email: user.email,
                name: user.name,
                storeName: user.storeName || `${user.name}'s Store`,
                role: user.role,
                purpose: '2fa_pending',
                isAdmin: true
            },
            process.env.ADMIN_JWT_SECRET,
            { expiresIn: "5m" }
        );

        return res
            .status(200)
            .json(
                new ApiResponse(200, { requires2FA: true, tempToken }, "Two-factor authentication code required")
            );
    }

    const token = jwt.sign(
        {
            id: user._id,
            email: user.email,
            name: user.name,
            storeName: user.storeName || `${user.name}'s Store`,
            role: user.role
        },
        process.env.ADMIN_JWT_SECRET,
        { expiresIn: "24h" }
    );

    return res
        .status(200)
        .json(
            new ApiResponse(200, token, "Seller logged in successfully")
        );

});

const registerSeller = asyncHandler(async (req, res) => {
    const { name, email, password, storeName, phone } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
        throw new ApiError(400, "Name, email, and password are required");
    }

    if (!validator.isEmail(email.trim())) {
        throw new ApiError(400, "Invalid email address");
    }

    if (password.trim().length < 8) {
        throw new ApiError(400, "Password must be at least 8 characters");
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Prevent collision with configured env superadmin
    const configuredEmail = (process.env.ADMIN_EMAIL || "admin@forever.com").trim().toLowerCase();
    if (normalizedEmail === configuredEmail) {
        throw new ApiError(409, "Email is reserved for Super Admin");
    }

    const existUser = await User.findOne({ email: normalizedEmail });
    if (existUser) {
        throw new ApiError(409, "An account with this email already exists");
    }

    const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: password.trim(),
        role: 'seller',
        storeName: storeName?.trim() || `${name.trim()}'s Store`,
        phone: phone?.trim() || ''
    });

    const token = jwt.sign(
        {
            id: user._id,
            email: user.email,
            role: user.role,
            name: user.name,
            storeName: user.storeName
        },
        process.env.ADMIN_JWT_SECRET,
        { expiresIn: "24h" }
    );

    res.status(201).json(
        new ApiResponse(201, token, "Seller registered successfully")
    );
});

const logout = asyncHandler(async (req, res) => {
    const token = extractToken(req);
    if (!token) {
        throw new ApiError(400, "Token is required for logout");
    }
    await blacklistToken(token);
    return res
        .status(200)
        .json(
            new ApiResponse(200, {}, "User logged out successfully")
        );
});

// ==========================================
// 2FA / TOTP CONTROLLER ACTIONS
// ==========================================

const setup2FA = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const secret = createTOTPSecret();
    const appName = "Forever Store";
    const otpauthUri = createTOTPUri(user.email, secret, appName);
    const qrCodeDataUrl = await createQRCodeDataURL(otpauthUri);

    user.twoFactorTempSecret = secret;
    await user.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                qrCode: qrCodeDataUrl,
                secret,
                manualEntryKey: secret,
                otpauthUri
            },
            "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)"
        )
    );
});

const verifySetup2FA = asyncHandler(async (req, res) => {
    const { code } = req.body;
    if (!code?.trim()) {
        throw new ApiError(400, "Verification code is required");
    }

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (!user.twoFactorTempSecret) {
        throw new ApiError(400, "2FA setup has not been initiated. Please start setup first.");
    }

    const isValid = verifyTOTPCode(code, user.twoFactorTempSecret);
    if (!isValid) {
        throw new ApiError(400, "Invalid 6-digit code. Please verify the code in your authenticator app.");
    }

    const plainBackupCodes = generateBackupCodes(8);
    user.twoFactorBackupCodes = plainBackupCodes.map((c) => ({ code: c, used: false }));
    user.twoFactorSecret = user.twoFactorTempSecret;
    user.twoFactorTempSecret = "";
    user.twoFactorEnabled = true;
    await user.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                twoFactorEnabled: true,
                backupCodes: plainBackupCodes
            },
            "Two-Factor Authentication successfully enabled! Save your backup codes in a safe place."
        )
    );
});

const disable2FA = asyncHandler(async (req, res) => {
    const { password, code } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (!user.twoFactorEnabled) {
        throw new ApiError(400, "Two-factor authentication is not currently enabled");
    }

    // Require password or TOTP code verification to disable
    if (!password?.trim() && !code?.trim()) {
        throw new ApiError(400, "Please provide your current password or 6-digit authenticator code");
    }

    if (password?.trim()) {
        const isMatch = await user.isPasswordCorrect(password);
        if (!isMatch) {
            throw new ApiError(401, "Incorrect password");
        }
    } else if (code?.trim()) {
        const isValid = verifyTOTPCode(code, user.twoFactorSecret);
        if (!isValid) {
            throw new ApiError(400, "Invalid authenticator code");
        }
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = "";
    user.twoFactorTempSecret = "";
    user.twoFactorBackupCodes = [];
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, { twoFactorEnabled: false }, "Two-Factor Authentication disabled successfully")
    );
});

const get2FAStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const remainingBackupCodes = (user.twoFactorBackupCodes || []).filter((c) => !c.used).length;

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                twoFactorEnabled: !!user.twoFactorEnabled,
                remainingBackupCodes,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    storeName: user.storeName,
                    phone: user.phone
                }
            },
            "2FA status fetched successfully"
        )
    );
});

const regenerateBackupCodes = asyncHandler(async (req, res) => {
    const { code, password } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (!user.twoFactorEnabled) {
        throw new ApiError(400, "Two-factor authentication is not enabled");
    }

    let verified = false;
    if (code?.trim()) {
        verified = verifyTOTPCode(code, user.twoFactorSecret);
    } else if (password?.trim()) {
        verified = await user.isPasswordCorrect(password);
    }

    if (!verified) {
        throw new ApiError(400, "Valid 6-digit authenticator code or password is required to generate new backup codes");
    }

    const newCodes = generateBackupCodes(8);
    user.twoFactorBackupCodes = newCodes.map((c) => ({ code: c, used: false }));
    await user.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            { backupCodes: newCodes },
            "New backup codes generated. Previous backup codes are now invalid."
        )
    );
});

const verify2FALogin = asyncHandler(async (req, res) => {
    const { tempToken, code, isBackupCode } = req.body;

    if (!tempToken?.trim()) {
        throw new ApiError(400, "Temporary session token is required");
    }

    if (!code?.trim()) {
        throw new ApiError(400, "Verification code or backup code is required");
    }

    let decoded;
    try {
        decoded = jwt.verify(tempToken, process.env.JWT_TOKEN_SECRET);
    } catch (err) {
        try {
            decoded = jwt.verify(tempToken, process.env.ADMIN_JWT_SECRET);
        } catch (adminErr) {
            throw new ApiError(401, "2FA verification session has expired. Please log in again.");
        }
    }

    if (decoded.purpose !== '2fa_pending') {
        throw new ApiError(400, "Invalid token purpose for 2FA verification");
    }

    const user = await User.findById(decoded.id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ApiError(400, "Two-factor authentication is not active on this account");
    }

    if (isBackupCode) {
        const inputNorm = normalizeBackupCode(code);
        const matchIdx = (user.twoFactorBackupCodes || []).findIndex(
            (c) => !c.used && normalizeBackupCode(c.code) === inputNorm
        );

        if (matchIdx === -1) {
            throw new ApiError(400, "Invalid or already used backup code");
        }

        user.twoFactorBackupCodes[matchIdx].used = true;
        await user.save();
    } else {
        const isValid = verifyTOTPCode(code, user.twoFactorSecret);
        if (!isValid) {
            throw new ApiError(400, "Invalid 6-digit authenticator code. Please check your authenticator app.");
        }
    }

    // Issue permanent auth token
    if (decoded.isAdmin) {
        const token = jwt.sign(
            {
                id: user._id,
                email: user.email,
                name: user.name,
                storeName: user.storeName || `${user.name}'s Store`,
                role: user.role
            },
            process.env.ADMIN_JWT_SECRET,
            { expiresIn: "24h" }
        );

        return res.status(200).json(
            new ApiResponse(200, token, "Seller logged in successfully")
        );
    } else {
        const token = await generateUserToken(user._id);
        return res.status(200).json(
            new ApiResponse(200, token, "User successfully login")
        );
    }
});

// ==========================================
// 3-Tier ACL: Users & Profiles Management
// ==========================================

/**
 * Get User Profile
 * Access: Admin (Any user), Seller / Buyer (Own profile only)
 */
const getUserProfile = asyncHandler(async (req, res) => {
    const targetUserId = req.params.id || req.query.id || req.user?.id;

    if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
        throw new ApiError(400, "Valid User ID is required");
    }

    // ABAC / Ownership: Non-admins can only view their own profile
    if (req.user?.role !== 'admin' && targetUserId.toString() !== req.user?.id?.toString()) {
        throw new ApiError(403, "Access denied: You can only view your own profile");
    }

    const user = await User.findById(targetUserId).select(
        "-password -twoFactorSecret -twoFactorTempSecret -twoFactorBackupCodes"
    );

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    res.status(200).json(
        new ApiResponse(200, user, "User profile fetched successfully")
    );
});

/**
 * Update User Profile
 * Access: Admin (Any user), Seller / Buyer (Own profile only)
 */
const updateUserProfile = asyncHandler(async (req, res) => {
    const targetUserId = req.params.id || req.body.userId || req.body.id || req.user?.id;

    if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
        throw new ApiError(400, "Valid User ID is required");
    }

    // ABAC / Ownership: Non-admins can only update their own profile
    if (req.user?.role !== 'admin' && targetUserId.toString() !== req.user?.id?.toString()) {
        throw new ApiError(403, "Access denied: You can only modify your own profile");
    }

    const user = await User.findById(targetUserId);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const { name, phone, storeName, role } = req.body;

    if (name?.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();

    // Store Name can be modified by sellers and admins
    if (storeName !== undefined) {
        user.storeName = storeName.trim();
    }

    // Role elevation is strictly restricted to Admin Superuser
    if (role && req.user?.role === 'admin') {
        if (!['user', 'seller', 'admin'].includes(role)) {
            throw new ApiError(400, "Invalid role. Allowed roles: user, seller, admin");
        }
        user.role = role;
    }

    await user.save();

    const sanitizedUser = await User.findById(user._id).select(
        "-password -twoFactorSecret -twoFactorTempSecret -twoFactorBackupCodes"
    );

    res.status(200).json(
        new ApiResponse(200, sanitizedUser, "User profile updated successfully")
    );
});

/**
 * Get All Users (Admin CRUD: Read All)
 * Access: Admin Only
 */
const getAllUsers = asyncHandler(async (req, res) => {
    const { role, search, page, limit = 20 } = req.query;

    const filter = {};
    if (role && ['user', 'seller', 'admin'].includes(role)) {
        filter.role = role;
    }

    if (search && search.trim() !== "") {
        const cleanSearch = search.trim();
        filter.$or = [
            { name: { $regex: cleanSearch, $options: "i" } },
            { email: { $regex: cleanSearch, $options: "i" } },
            { storeName: { $regex: cleanSearch, $options: "i" } }
        ];
    }

    const total = await User.countDocuments(filter);
    const currentPage = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(limit) || 20));
    const totalPages = Math.ceil(total / pageSize);

    const users = await User.find(filter)
        .select("-password -twoFactorSecret -twoFactorTempSecret -twoFactorBackupCodes")
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize);

    res.status(200).json(
        new ApiResponse(
            200,
            { users, total, totalPages, currentPage, pageSize },
            "Users fetched successfully"
        )
    );
});

/**
 * Create User by Admin (Admin CRUD: Create)
 * Access: Admin Only
 */
const createUser = asyncHandler(async (req, res) => {
    const { name, email, password, role = 'user', storeName = '', phone = '' } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
        throw new ApiError(400, "Name, email, and password are required");
    }

    if (!validator.isEmail(email.trim())) {
        throw new ApiError(400, "Invalid email address");
    }

    if (!['user', 'seller', 'admin'].includes(role)) {
        throw new ApiError(400, "Invalid role. Allowed roles: user, seller, admin");
    }

    const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingUser) {
        throw new ApiError(409, "User with this email already exists");
    }

    const newUser = await User.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        storeName: storeName.trim(),
        phone: phone.trim()
    });

    const sanitizedUser = await User.findById(newUser._id).select(
        "-password -twoFactorSecret -twoFactorTempSecret -twoFactorBackupCodes"
    );

    res.status(201).json(
        new ApiResponse(201, sanitizedUser, `User created successfully with role '${role}'`)
    );
});

/**
 * Delete User (Admin CRUD: Delete)
 * Access: Admin Only
 */
const deleteUser = asyncHandler(async (req, res) => {
    const targetUserId = req.params.id || req.body.userId || req.body.id;

    if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
        throw new ApiError(400, "Valid User ID is required");
    }

    // Prevent self-deletion
    if (targetUserId.toString() === req.user?.id?.toString()) {
        throw new ApiError(400, "Security restriction: Admins cannot delete their own account");
    }

    const userToDelete = await User.findById(targetUserId);
    if (!userToDelete) {
        throw new ApiError(404, "User not found");
    }

    // Protect superadmin account from deletion
    if (userToDelete.email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase()) {
        throw new ApiError(403, "Protected account: Cannot delete the Primary Super Admin account");
    }

    await User.findByIdAndDelete(targetUserId);

    res.status(200).json(
        new ApiResponse(200, {}, "User deleted successfully")
    );
});

export {
    register,
    login,
    adminLogin,
    registerSeller,
    logout,
    setup2FA,
    verifySetup2FA,
    disable2FA,
    get2FAStatus,
    regenerateBackupCodes,
    verify2FALogin,
    getUserProfile,
    updateUserProfile,
    getAllUsers,
    createUser,
    deleteUser
}