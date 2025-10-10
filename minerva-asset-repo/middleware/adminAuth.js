import { requireAuth, requireRole } from './auth.js';

// Middleware to check if request is from allowed admin origins
export const checkAdminOrigin = (req, res, next) => {
    const allowedAdminOrigins = process.env.ADMIN_ALLOWED_ORIGINS?.split(',') || [];
    
    if (allowedAdminOrigins.length === 0) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin panel is not configured'
        });
    }
    
    const origin = req.get('origin') || req.get('referer');
    
    if (!origin) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Origin header required for admin access'
        });
    }
    
    const isAllowedOrigin = allowedAdminOrigins.some(allowedOrigin => 
        origin.startsWith(allowedOrigin)
    );
    
    if (!isAllowedOrigin) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access not allowed from this origin'
        });
    }
    
    next();
};

// Combined admin authentication middleware
export const adminAuth = [
    checkAdminOrigin,
    requireAuth,
    requireRole(['admin', 'moderator'])
];

// Super admin only (admin role)
export const superAdminAuth = [
    checkAdminOrigin,
    requireAuth,
    requireRole(['admin'])
];