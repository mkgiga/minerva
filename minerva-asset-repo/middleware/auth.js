import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Optional authentication middleware - allows both authenticated and unauthenticated requests
export const optionalAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            // No token provided - continue as unauthenticated user
            req.user = null;
            return next();
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password -refreshTokens');
        
        if (!user || !user.isActive) {
            // Invalid or inactive user - continue as unauthenticated
            req.user = null;
            return next();
        }

        req.user = user;
        next();
    } catch (error) {
        // Token verification failed - continue as unauthenticated
        req.user = null;
        next();
    }
};

// Required authentication middleware - requires valid JWT token
export const requireAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Access token is required'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password -refreshTokens');
        
        if (!user) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'User not found'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Account is inactive'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Invalid access token'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Access token expired'
            });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({ 
            error: 'Internal Server Error',
            message: 'Authentication verification failed'
        });
    }
};

// Check if user owns the resource or is admin/moderator
export const checkResourceOwnership = (Model) => {
    return async (req, res, next) => {
        try {
            const resourceId = req.params.id;
            const resource = await Model.findById(resourceId);
            
            if (!resource) {
                return res.status(404).json({ 
                    error: 'Not Found',
                    message: 'Resource not found'
                });
            }

            // Check if user owns the resource or has admin/moderator privileges
            if (resource.author.toString() !== req.user._id.toString() && 
                !['admin', 'moderator'].includes(req.user.role)) {
                return res.status(403).json({ 
                    error: 'Forbidden',
                    message: 'You can only modify your own resources'
                });
            }

            req.resource = resource;
            next();
        } catch (error) {
            console.error('Resource ownership check error:', error);
            return res.status(500).json({ 
                error: 'Internal Server Error',
                message: 'Failed to verify resource ownership'
            });
        }
    };
};

// Middleware to check if user has specific role
export const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Forbidden',
                message: 'Insufficient privileges'
            });
        }

        next();
    };
};