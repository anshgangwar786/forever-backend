import { Router } from "express";
import { addProducts, listProducts, updateProduct, removeProduct, singleProduct, updateDiscount, getProductInsights } from "../controllers/product.controller.js";
import {upload} from '../middlewares/multer.js'
import adminAuth from "../middlewares/adminAuth.js";

const router = Router()

// CRUD Routes for Admin & Sellers
router.route("/add").post(adminAuth, upload.fields([
    {name:'image1',maxCount:1},
    {name:'image2',maxCount:1},
    {name:'image3',maxCount:1},
    {name:'image4',maxCount:1},
]), addProducts)

router.route("/update").post(adminAuth, upload.fields([
    {name:'image1',maxCount:1},
    {name:'image2',maxCount:1},
    {name:'image3',maxCount:1},
    {name:'image4',maxCount:1},
]), updateProduct)

router.route("/discount").post(adminAuth, updateDiscount)
router.route("/remove").post(adminAuth, removeProduct)
router.route("/delete").post(adminAuth, removeProduct)
router.route("/single").post(singleProduct)
router.route("/list").get(listProducts)

// Product Insights & Performance Analytics for Admin & Sellers
router.route("/insights/:productId").get(adminAuth, getProductInsights)
router.route("/insights").post(adminAuth, getProductInsights)

export default router