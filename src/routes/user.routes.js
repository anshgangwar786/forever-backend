import { Router } from 'express'
import {
    login,
    adminLogin,
    register,
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
} from '../controllers/user.controller.js'
import authUser from '../middlewares/auth.js'
import adminAuth from '../middlewares/adminAuth.js'
import { authorizeRoles, checkProfileOwnership } from '../middlewares/acl.middleware.js'

const router = Router()

// Standard Auth Routes
router.route('/register').post(register)
router.route('/register-seller').post(registerSeller)
router.route('/seller/register').post(registerSeller)
router.route('/login').post(login)
router.route('/admin').post(adminLogin)
router.route('/logout').post(logout)

// 2FA Routes
router.route('/2fa/verify-login').post(verify2FALogin)
router.route('/2fa/status').get(authUser, get2FAStatus)
router.route('/2fa/setup').post(authUser, setup2FA)
router.route('/2fa/verify-setup').post(authUser, verifySetup2FA)
router.route('/2fa/disable').post(authUser, disable2FA)
router.route('/2fa/regenerate-backup-codes').post(authUser, regenerateBackupCodes)

// 3-Tier ACL: Profile Management (Buyer & Seller read/update own; Admin can read/update any)
router.route('/profile')
    .get(authUser, checkProfileOwnership(), getUserProfile)
    .put(authUser, checkProfileOwnership(), updateUserProfile)
    .post(authUser, checkProfileOwnership(), updateUserProfile)

router.route('/profile/:id')
    .get(authUser, checkProfileOwnership(), getUserProfile)
    .put(authUser, checkProfileOwnership(), updateUserProfile)

router.route('/update-profile').post(authUser, checkProfileOwnership(), updateUserProfile)

// 3-Tier ACL: Admin Superuser CRUD on All Users
router.route('/all').get(adminAuth, authorizeRoles('admin'), getAllUsers)
router.route('/create').post(adminAuth, authorizeRoles('admin'), createUser)
router.route('/update-user').post(adminAuth, authorizeRoles('admin'), updateUserProfile)
router.route('/role').post(adminAuth, authorizeRoles('admin'), updateUserProfile)
router.route('/delete').post(adminAuth, authorizeRoles('admin'), deleteUser)
router.route('/:id').delete(adminAuth, authorizeRoles('admin'), deleteUser)

export default router;