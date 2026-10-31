import { Router } from 'express'
import { addToCart, updateCart, getUserCart } from '../controllers/cart.controller.js'
import authUser from '../middlewares/auth.js'
import { restrictRoles } from '../middlewares/acl.middleware.js'

const router = Router()

// Cart ACL: Restricted to Buyers (Customers) only. Admins & Sellers do not have a cart.
const cartGuard = [authUser, restrictRoles(['admin', 'seller'], "Admins and Sellers do not participate in consumer shopping carts")];

router.route('/get').post(cartGuard, getUserCart)
router.route('/add').post(cartGuard, addToCart)
router.route('/update').post(cartGuard, updateCart)

export default router