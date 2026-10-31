import { Router } from 'express';
import {
    listCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory
} from '../controllers/category.controller.js';
import adminAuth from '../middlewares/adminAuth.js';
import { authorizeRoles } from '../middlewares/acl.middleware.js';

const router = Router();

// Only Super Admins can mutate catalog taxonomy
const adminOnlyGuard = [adminAuth, authorizeRoles('admin')];

// ==========================================
// RESTful CRUD Routes (/api/v1/category)
// ==========================================

// GET /api/v1/category (Fetch all categories)
// POST /api/v1/category (Create new category/sub-category)
router.route('/')
    .get(listCategories)
    .post(adminOnlyGuard, createCategory);

// Backward compatibility alias for list
router.route('/list').get(listCategories);

// Backward compatibility alias for add
router.route('/add').post(adminOnlyGuard, createCategory);

// Backward compatibility aliases for update and delete
router.route('/update').post(adminOnlyGuard, updateCategory);
router.route('/update/:id').put(adminOnlyGuard, updateCategory);
router.route('/delete').post(adminOnlyGuard, deleteCategory);

// GET /api/v1/category/:id (Fetch single category)
// PUT /api/v1/category/:id (Update category details)
// DELETE /api/v1/category/:id (Delete category with integrity checks)
router.route('/:id')
    .get(getCategoryById)
    .put(adminOnlyGuard, updateCategory)
    .delete(adminOnlyGuard, deleteCategory);

export default router;
