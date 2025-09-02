import express from 'express';
import User from '../models/User.js';
import { z } from 'zod';

const router = express.Router();

// Only enable in development
if (process.env.NODE_ENV !== 'development') {
    router.use((req, res) => {
        res.status(404).json({ error: 'Debug endpoints not available in production' });
    });
} else {
    // Promote user to admin - development only
    router.post('/promote-admin', async (req, res, next) => {
        try {
            const { email, secret } = req.body;
            
            // Simple protection
            if (secret !== 'debug-promote-secret-123') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Invalid debug secret'
                });
            }
            
            if (!email) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Email is required'
                });
            }
            
            // Find and update user
            const user = await User.findOneAndUpdate(
                { email: email.toLowerCase() },
                { role: 'admin' },
                { new: true }
            ).select('-password -refreshTokens');
            
            if (!user) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'User not found'
                });
            }
            
            res.json({
                message: 'User promoted to admin successfully',
                user
            });
            
        } catch (error) {
            next(error);
        }
    });
    
    // List all users - development only
    router.get('/users', async (req, res, next) => {
        try {
            const users = await User.find()
                .select('email username role isActive createdAt')
                .sort({ createdAt: -1 })
                .limit(50);
            
            res.json({ users });
        } catch (error) {
            next(error);
        }
    });
}

export default router;