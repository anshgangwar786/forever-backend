import { ApiError } from "../utils/ApiError.js";
import mongoose from "mongoose";

/**
 * Access Control List (ACL) Middleware for 3-Tier Architecture
 * Enforces Role-Based Access Control (RBAC) and Attribute/Ownership-Based Access Control (ABAC).
 */

/**
 * Enforce that the authenticated user possesses one of the allowed roles
 * Usage: authorizeRoles('admin', 'seller')
 */
export const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.role || req.role;

        if (!req.user || !userRole) {
            throw new ApiError(401, "Authentication required to access this resource");
        }

        if (!allowedRoles.includes(userRole)) {
            throw new ApiError(
                403,
                `Access denied: Role '${userRole}' is not authorized to perform this operation. Required: [${allowedRoles.join(", ")}]`
            );
        }

        next();
    };
};

/**
 * Restrict specific roles from accessing an endpoint
 * Example: restrictRoles(['admin', 'seller'], "Admins and sellers do not shop in consumer carts")
 */
export const restrictRoles = (disallowedRoles, message = "Access denied for this role") => {
    return (req, res, next) => {
        const userRole = req.user?.role || req.role;

        if (disallowedRoles.includes(userRole)) {
            throw new ApiError(403, message);
        }

        next();
    };
};

/**
 * Verify resource ownership or allow superuser bypass (Admin).
 * If role is 'admin', ownership check passes automatically.
 * If role is 'seller' or 'user', fetches the resource and checks ownerField === req.user.id.
 * 
 * @param {mongoose.Model} Model - The Mongoose Model to query
 * @param {string} idParamKey - Request body or params key containing resource ID ('id', 'productId', 'orderId')
 * @param {string} ownerField - The field name on the model that stores owner ID ('sellerId', 'userId', '_id')
 */
export const checkOwnership = (Model, idParamKey = "id", ownerField = "sellerId") => {
    return async (req, res, next) => {
        try {
            const userRole = req.user?.role || req.role;
            const currentUserId = req.user?.id?.toString();

            // Admin Superuser has unrestricted access
            if (userRole === "admin") {
                return next();
            }

            // Extract resource ID from params or body
            const resourceId = req.params[idParamKey] || req.body[idParamKey];

            if (!resourceId) {
                throw new ApiError(400, `Resource ID parameter '${idParamKey}' is required for ownership check`);
            }

            if (!mongoose.isValidObjectId(resourceId)) {
                throw new ApiError(400, `Invalid ID format for parameter '${idParamKey}'`);
            }

            const resource = await Model.findById(resourceId);
            if (!resource) {
                throw new ApiError(404, "Requested resource not found");
            }

            // Check if resource belongs to authenticated user
            const resourceOwnerId = resource[ownerField]?.toString();

            if (!resourceOwnerId || resourceOwnerId !== currentUserId) {
                throw new ApiError(
                    403,
                    `Access denied: You do not have ownership privileges over this resource`
                );
            }

            // Attach resource to req for controller reuse
            req.targetResource = resource;
            next();
        } catch (error) {
            next(error);
        }
    };
};

/**
 * Enforce that the user is accessing or modifying ONLY their own profile
 * Superuser (Admin) can access any profile.
 */
export const checkProfileOwnership = () => {
    return (req, res, next) => {
        const userRole = req.user?.role || req.role;
        const currentUserId = req.user?.id?.toString();
        const targetUserId = req.params.id || req.body.userId || req.query.userId;

        // Admin can access/modify any profile
        if (userRole === "admin") {
            return next();
        }

        // If target ID is specified and does not match current user, reject
        if (targetUserId && targetUserId.toString() !== currentUserId) {
            throw new ApiError(403, "Access denied: You can only view or modify your own profile");
        }

        next();
    };
};
