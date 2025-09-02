import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Character from '../models/Character.js';
import Note from '../models/Note.js';
import Scenario from '../models/Scenario.js';
import { adminAuth, superAdminAuth } from '../middleware/adminAuth.js';
import { validate } from '../middleware/validation.js';
import { idParamSchema, paginationSchema } from '../schemas/validation.js';
import { z } from 'zod';
import adminEvents from '../utils/adminEvents.js';

const router = express.Router();

// Admin dashboard stats
router.get('/stats', adminAuth, async (req, res, next) => {
    try {
        const [
            totalUsers,
            activeUsers,
            totalCharacters,
            publicCharacters,
            totalNotes,
            publicNotes,
            totalScenarios,
            publicScenarios,
            recentUsers,
            topAuthors
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            Character.countDocuments(),
            Character.countDocuments({ isPublic: true }),
            Note.countDocuments(),
            Note.countDocuments({ isPublic: true }),
            Scenario.countDocuments(),
            Scenario.countDocuments({ isPublic: true }),
            User.find()
                .sort({ createdAt: -1 })
                .limit(10)
                .select('username email createdAt isActive')
                .lean(),
            User.find({ isActive: true })
                .sort({ 'stats.totalDownloads': -1 })
                .limit(10)
                .select('username stats')
                .lean()
        ]);

        const dbStats = {
            collections: {},
            indexes: {}
        };

        // Get collection stats
        const collections = ['users', 'characters', 'notes', 'scenarios'];
        for (const collectionName of collections) {
            try {
                const stats = await mongoose.connection.db.collection(collectionName).stats();
                dbStats.collections[collectionName] = {
                    count: stats.count,
                    size: stats.size,
                    avgObjSize: stats.avgObjSize,
                    storageSize: stats.storageSize,
                    indexes: stats.nindexes
                };
            } catch (error) {
                dbStats.collections[collectionName] = { error: error.message };
            }
        }

        res.json({
            users: {
                total: totalUsers,
                active: activeUsers,
                inactive: totalUsers - activeUsers
            },
            resources: {
                characters: { total: totalCharacters, public: publicCharacters },
                notes: { total: totalNotes, public: publicNotes },
                scenarios: { total: totalScenarios, public: publicScenarios }
            },
            recent: {
                users: recentUsers
            },
            topAuthors,
            database: dbStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
});

// User management
router.get('/users', 
    adminAuth,
    async (req, res, next) => {
        try {
            // Manual query parameter validation and defaults
            const search = req.query.search || undefined;
            const status = req.query.status || 'all';
            const role = req.query.role || 'all';
            const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
            const offset = Math.max(parseInt(req.query.offset) || 0, 0);
            
            const query = {};
            
            if (search) {
                query.$or = [
                    { username: new RegExp(search, 'i') },
                    { email: new RegExp(search, 'i') }
                ];
            }
            
            if (status !== 'all') {
                query.isActive = status === 'active';
            }
            
            if (role !== 'all') {
                query.role = role;
            }
            
            const [users, total] = await Promise.all([
                User.find(query)
                    .sort({ createdAt: -1 })
                    .skip(offset)
                    .limit(limit)
                    .select('-refreshTokens')
                    .lean(),
                User.countDocuments(query)
            ]);
            
            res.json({
                users,
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: offset + limit < total
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get specific user details
router.get('/users/:id',
    adminAuth,
    validate(idParamSchema, 'params'),
    async (req, res, next) => {
        try {
            const user = await User.findById(req.params.id)
                .select('-refreshTokens')
                .lean();
            
            if (!user) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'User not found'
                });
            }
            
            // Get user's resources
            const [characters, notes, scenarios] = await Promise.all([
                Character.find({ author: user._id }).select('name isPublic stats createdAt').lean(),
                Note.find({ author: user._id }).select('title isPublic stats createdAt').lean(),
                Scenario.find({ author: user._id }).select('name isPublic stats createdAt').lean()
            ]);
            
            res.json({
                user,
                resources: {
                    characters,
                    notes,
                    scenarios
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// Update user status/role
router.patch('/users/:id',
    superAdminAuth, // Only super admins can modify users
    validate(idParamSchema, 'params'),
    validate(z.object({
        isActive: z.boolean().optional(),
        role: z.enum(['user', 'moderator', 'admin']).optional()
    })),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            // Prevent self-demotion
            if (req.user._id.toString() === id && updates.role && updates.role !== 'admin') {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Cannot change your own admin role'
                });
            }
            
            const user = await User.findByIdAndUpdate(
                id,
                updates,
                { new: true, runValidators: true }
            ).select('-refreshTokens -password');
            
            if (!user) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'User not found'
                });
            }
            
            res.json({
                message: 'User updated successfully',
                user
            });
        } catch (error) {
            next(error);
        }
    }
);

// Bulk actions for resources
router.post('/resources/bulk-action',
    adminAuth,
    validate(z.object({
        action: z.enum(['delete', 'hide', 'approve']),
        type: z.enum(['character', 'note', 'scenario']),
        ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(50)
    })),
    async (req, res, next) => {
        try {
            const { action, type, ids } = req.body;
            
            let Model;
            switch (type) {
                case 'character': Model = Character; break;
                case 'note': Model = Note; break;
                case 'scenario': Model = Scenario; break;
            }
            
            let result;
            switch (action) {
                case 'delete':
                    result = await Model.deleteMany({ _id: { $in: ids } });
                    break;
                case 'hide':
                    result = await Model.updateMany(
                        { _id: { $in: ids } },
                        { isPublic: false }
                    );
                    break;
                case 'approve':
                    result = await Model.updateMany(
                        { _id: { $in: ids } },
                        { isPublic: true }
                    );
                    break;
            }
            
            res.json({
                message: `Bulk ${action} completed`,
                affected: result.modifiedCount || result.deletedCount,
                requested: ids.length
            });
        } catch (error) {
            next(error);
        }
    }
);

// Recent activity feed
router.get('/activity',
    adminAuth,
    validate(z.object({
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0)
    }), 'query'),
    async (req, res, next) => {
        try {
            const { limit, offset } = req.query;
            
            // Get recent resources from all collections
            const [characters, notes, scenarios, users] = await Promise.all([
                Character.find()
                    .sort({ createdAt: -1 })
                    .skip(offset / 4) // Distribute offset across collections
                    .limit(Math.ceil(limit / 4))
                    .select('name authorName createdAt isPublic')
                    .lean(),
                Note.find()
                    .sort({ createdAt: -1 })
                    .skip(offset / 4)
                    .limit(Math.ceil(limit / 4))
                    .select('title authorName createdAt isPublic')
                    .lean(),
                Scenario.find()
                    .sort({ createdAt: -1 })
                    .skip(offset / 4)
                    .limit(Math.ceil(limit / 4))
                    .select('name authorName createdAt isPublic')
                    .lean(),
                User.find()
                    .sort({ createdAt: -1 })
                    .skip(offset / 4)
                    .limit(Math.ceil(limit / 4))
                    .select('username createdAt isActive')
                    .lean()
            ]);
            
            // Format activity feed
            const activities = [
                ...characters.map(item => ({
                    type: 'character',
                    action: 'created',
                    item: { name: item.name, id: item._id },
                    author: item.authorName,
                    timestamp: item.createdAt,
                    isPublic: item.isPublic
                })),
                ...notes.map(item => ({
                    type: 'note',
                    action: 'created',
                    item: { name: item.title, id: item._id },
                    author: item.authorName,
                    timestamp: item.createdAt,
                    isPublic: item.isPublic
                })),
                ...scenarios.map(item => ({
                    type: 'scenario',
                    action: 'created',
                    item: { name: item.name, id: item._id },
                    author: item.authorName,
                    timestamp: item.createdAt,
                    isPublic: item.isPublic
                })),
                ...users.map(item => ({
                    type: 'user',
                    action: 'registered',
                    item: { name: item.username, id: item._id },
                    author: null,
                    timestamp: item.createdAt,
                    isPublic: item.isActive
                }))
            ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);
            
            res.json({
                activities,
                pagination: {
                    limit,
                    offset,
                    total: activities.length
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// System health check
router.get('/health',
    adminAuth,
    async (req, res, next) => {
        try {
            const dbState = mongoose.connection.readyState;
            const dbStates = {
                0: 'disconnected',
                1: 'connected',
                2: 'connecting',
                3: 'disconnecting'
            };
            
            // Check MongoDB connection
            const mongoStats = await mongoose.connection.db.admin().ping();
            
            // Get system stats
            const systemStats = {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch
            };
            
            res.json({
                status: 'healthy',
                database: {
                    state: dbStates[dbState],
                    ping: mongoStats.ok === 1 ? 'ok' : 'error'
                },
                system: systemStats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// SSE endpoint for real-time admin updates
router.get('/events',
    adminAuth,
    (req, res) => {
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': process.env.ADMIN_ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3002',
            'Access-Control-Allow-Credentials': 'true'
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({
            type: 'connection:established',
            data: { 
                message: 'Connected to admin events',
                timestamp: new Date().toISOString()
            }
        })}\n\n`);

        // Function to send events to client
        const sendEvent = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        // Set up event listeners
        const events = [
            'user:registered',
            'user:updated', 
            'resource:created',
            'resource:updated',
            'resource:deleted',
            'resource:downloaded',
            'stats:updated',
            'system:alert'
        ];

        events.forEach(eventName => {
            adminEvents.on(eventName, sendEvent);
        });

        // Send periodic heartbeat
        const heartbeat = setInterval(() => {
            res.write(`data: ${JSON.stringify({
                type: 'heartbeat',
                data: { timestamp: new Date().toISOString() }
            })}\n\n`);
        }, 30000); // Every 30 seconds

        // Handle client disconnect
        req.on('close', () => {
            console.log('Admin SSE client disconnected');
            clearInterval(heartbeat);
            
            // Remove event listeners
            events.forEach(eventName => {
                adminEvents.removeListener(eventName, sendEvent);
            });
        });
    }
);

export default router;