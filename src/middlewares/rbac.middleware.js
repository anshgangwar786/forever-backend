import { ApiError } from '../utils/ApiError.js';

/**
 * Role-Based Access Control (RBAC) middleware
 * Checks if the authenticated user has one of the allowed roles
 * Usage: authorizeRoles('admin'), authorizeRoles('admin', 'manager')
 */
export const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.role || req.role;

        if (!userRole) {
            throw new ApiError(403, "Access denied: No role assigned to user");
        }

        if (!allowedRoles.includes(userRole)) {
            throw new ApiError(
                403,
                `Access denied: Role '${userRole}' is not authorized to access this resource`
            );
        }

        next();
    };
};
