import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { validate } from '../middleware/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { 
    userRegisterSchema, 
    userLoginSchema, 
    refreshTokenSchema 
} from '../schemas/validation.js';

const router = express.Router();

// Helper function to generate tokens
const generateTokens = (userId) => {
    const accessToken = jwt.sign(
        { id: userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    
    const refreshToken = jwt.sign(
        { id: userId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
    
    return { accessToken, refreshToken };
};

// Register new user
router.post('/register', validate(userRegisterSchema), async (req, res, next) => {
    try {
        const { email, password, username } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });
        
        if (existingUser) {
            const field = existingUser.email === email ? 'email' : 'username';
            return res.status(400).json({
                error: 'Registration Failed',
                message: `User with this ${field} already exists`
            });
        }
        
        // Check if user should be admin based on email
        const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(email => email.trim().toLowerCase()) || [];
        const isAdmin = adminEmails.includes(email.toLowerCase());
        
        // Create new user
        const user = new User({ 
            email, 
            password, 
            username,
            role: isAdmin ? 'admin' : 'user'
        });
        await user.save();
        
        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user._id);
        
        // Store refresh token
        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days
        
        user.refreshTokens.push({
            token: refreshToken,
            expiresAt: refreshTokenExpiry
        });
        await user.save();
        
        res.status(201).json({
            message: 'User registered successfully',
            user: user.toJSON(),
            accessToken,
            refreshToken
        });
    } catch (error) {
        next(error);
    }
});

// Login user
router.post('/login', validate(userLoginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        // Find user by email
        const user = await User.findOne({ email, isActive: true });
        if (!user) {
            return res.status(401).json({
                error: 'Login Failed',
                message: 'Invalid email or password'
            });
        }
        
        // Check password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Login Failed',
                message: 'Invalid email or password'
            });
        }
        
        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user._id);
        
        // Store refresh token
        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days
        
        user.refreshTokens.push({
            token: refreshToken,
            expiresAt: refreshTokenExpiry
        });
        
        // Clean up expired tokens
        await user.cleanExpiredTokens();
        
        res.json({
            message: 'Login successful',
            user: user.toJSON(),
            accessToken,
            refreshToken
        });
    } catch (error) {
        next(error);
    }
});

// Refresh access token
router.post('/refresh', validate(refreshTokenSchema), async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        
        // Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        // Find user and check if refresh token exists
        const user = await User.findOne({
            _id: decoded.id,
            'refreshTokens.token': refreshToken,
            'refreshTokens.expiresAt': { $gt: new Date() }
        });
        
        if (!user || !user.isActive) {
            return res.status(401).json({
                error: 'Invalid Token',
                message: 'Refresh token is invalid or expired'
            });
        }
        
        // Generate new tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
        
        // Replace old refresh token with new one
        const tokenIndex = user.refreshTokens.findIndex(
            t => t.token === refreshToken
        );
        
        if (tokenIndex !== -1) {
            const newRefreshTokenExpiry = new Date();
            newRefreshTokenExpiry.setDate(newRefreshTokenExpiry.getDate() + 7);
            
            user.refreshTokens[tokenIndex] = {
                token: newRefreshToken,
                expiresAt: newRefreshTokenExpiry
            };
            
            await user.save();
        }
        
        res.json({
            message: 'Tokens refreshed successfully',
            accessToken,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Invalid Token',
                message: 'Refresh token is invalid or expired'
            });
        }
        next(error);
    }
});

// Logout (invalidate refresh token)
router.post('/logout', validate(refreshTokenSchema), async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        
        // Find user and remove the refresh token
        const user = await User.findOneAndUpdate(
            { 'refreshTokens.token': refreshToken },
            { $pull: { refreshTokens: { token: refreshToken } } },
            { new: true }
        );
        
        if (!user) {
            return res.status(400).json({
                error: 'Logout Failed',
                message: 'Invalid refresh token'
            });
        }
        
        res.json({
            message: 'Logout successful'
        });
    } catch (error) {
        next(error);
    }
});

// Logout from all devices (invalidate all refresh tokens)
router.post('/logout-all', requireAuth, async (req, res, next) => {
    try {
        const user = req.user;
        user.refreshTokens = [];
        await user.save();
        
        res.json({
            message: 'Logged out from all devices successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Get current user profile
router.get('/profile', requireAuth, async (req, res, next) => {
    try {
        res.json({
            user: req.user.toJSON()
        });
    } catch (error) {
        next(error);
    }
});

// Update user profile
router.patch('/profile', requireAuth, async (req, res, next) => {
    try {
        const allowedUpdates = ['username', 'profile.bio', 'profile.avatar', 'profile.website'];
        const updates = {};
        
        // Extract allowed fields from request body
        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                if (key.startsWith('profile.')) {
                    const profileField = key.split('.')[1];
                    if (!updates.profile) updates.profile = {};
                    updates.profile[profileField] = req.body[key];
                } else {
                    updates[key] = req.body[key];
                }
            }
        });
        
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No valid fields provided for update'
            });
        }
        
        // Check if username is being updated and is unique
        if (updates.username) {
            const existingUser = await User.findOne({
                username: updates.username,
                _id: { $ne: req.user._id }
            });
            
            if (existingUser) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Username is already taken'
                });
            }
        }
        
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        );
        
        res.json({
            message: 'Profile updated successfully',
            user: updatedUser.toJSON()
        });
    } catch (error) {
        next(error);
    }
});

export default router;