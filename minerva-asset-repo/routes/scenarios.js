import express from 'express';
import Scenario from '../models/Scenario.js';
import User from '../models/User.js';
import { 
    optionalAuth, 
    requireAuth, 
    checkResourceOwnership 
} from '../middleware/auth.js';
import { 
    validate, 
    buildSearchQuery, 
    parseTags 
} from '../middleware/validation.js';
import { 
    scenarioSchema, 
    scenarioUpdateSchema, 
    scenarioQuerySchema,
    idParamSchema 
} from '../schemas/validation.js';

const router = express.Router();

// GET /api/scenarios - Browse all public scenarios (no auth required)
router.get('/', 
    validate(scenarioQuerySchema, 'query'),
    parseTags,
    buildSearchQuery(Scenario),
    async (req, res, next) => {
        try {
            const { limit, offset } = req.query;
            const query = req.searchQuery;
            const sort = req.sortQuery;
            
            // Special handling for message count filtering
            if (req.query.messageCount) {
                const messageCount = req.query.messageCount;
                if (messageCount === 'short') {
                    // Use $size operator to count array elements
                    query.$expr = { $lte: [{ $size: '$messages' }, 50] };
                } else if (messageCount === 'medium') {
                    query.$expr = { 
                        $and: [
                            { $gte: [{ $size: '$messages' }, 51] },
                            { $lte: [{ $size: '$messages' }, 100] }
                        ]
                    };
                } else if (messageCount === 'long') {
                    query.$expr = { $gte: [{ $size: '$messages' }, 101] };
                }
            }
            
            // Special handling for character count filtering
            if (req.query.characterCount) {
                const characterCount = req.query.characterCount;
                if (characterCount === '1') {
                    query.$expr = { $eq: [{ $size: '$characters' }, 1] };
                } else if (characterCount === '2') {
                    query.$expr = { $eq: [{ $size: '$characters' }, 2] };
                } else if (characterCount === '3-4') {
                    query.$expr = {
                        $and: [
                            { $gte: [{ $size: '$characters' }, 3] },
                            { $lte: [{ $size: '$characters' }, 4] }
                        ]
                    };
                } else if (characterCount === '5+') {
                    query.$expr = { $gte: [{ $size: '$characters' }, 5] };
                }
            }
            
            // Execute query with pagination
            const [scenarios, total] = await Promise.all([
                Scenario.find(query)
                    .sort(sort)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v -messages.metadata') // Exclude message metadata for list view
                    .lean(),
                Scenario.countDocuments(query)
            ]);
            
            // Add computed fields
            const scenariosWithCounts = scenarios.map(scenario => ({
                ...scenario,
                messageCount: scenario.messages?.length || 0,
                characterCount: scenario.characters?.length || 0
            }));
            
            res.json({
                scenarios: scenariosWithCounts,
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

// GET /api/scenarios/:id - Get specific scenario (no auth required)
router.get('/:id',
    validate(idParamSchema, 'params'),
    optionalAuth,
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const isOwner = req.user?.id === id;
            
            // Build query - owners can see their private scenarios
            const query = { _id: id };
            if (!isOwner) {
                query.isPublic = true;
            }
            
            const scenario = await Scenario.findOne(query)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            if (!scenario) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Scenario not found'
                });
            }
            
            // Increment view count (but not for owner)
            if (!isOwner) {
                scenario.stats.views += 1;
                await scenario.save();
            }
            
            // Add computed fields
            const scenarioWithCounts = {
                ...scenario.toObject(),
                messageCount: scenario.messages.length,
                characterCount: scenario.characters.length
            };
            
            res.json({ scenario: scenarioWithCounts });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/scenarios - Create new scenario (auth required)
router.post('/',
    requireAuth,
    validate(scenarioSchema),
    async (req, res, next) => {
        try {
            const scenarioData = {
                ...req.body,
                author: req.user._id,
                authorName: req.user.username
            };
            
            const scenario = new Scenario(scenarioData);
            await scenario.save();
            
            // Update user stats
            req.user.stats.scenariosUploaded += 1;
            await req.user.save();
            
            const populatedScenario = await Scenario.findById(scenario._id)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            const scenarioWithCounts = {
                ...populatedScenario.toObject(),
                messageCount: populatedScenario.messages.length,
                characterCount: populatedScenario.characters.length
            };
            
            res.status(201).json({
                message: 'Scenario created successfully',
                scenario: scenarioWithCounts
            });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/scenarios/:id - Update scenario (auth required, owner only)
router.put('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Scenario),
    validate(scenarioUpdateSchema),
    async (req, res, next) => {
        try {
            const updates = req.body;
            
            // Don't allow changing author
            delete updates.author;
            delete updates.authorName;
            
            // Increment version
            updates.version = req.resource.version + 1;
            updates.updatedAt = new Date();
            
            const scenario = await Scenario.findByIdAndUpdate(
                req.params.id,
                updates,
                { new: true, runValidators: true }
            )
            .populate('author', 'username profile.avatar')
            .select('-__v');
            
            const scenarioWithCounts = {
                ...scenario.toObject(),
                messageCount: scenario.messages.length,
                characterCount: scenario.characters.length
            };
            
            res.json({
                message: 'Scenario updated successfully',
                scenario: scenarioWithCounts
            });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/scenarios/:id - Delete scenario (auth required, owner only)
router.delete('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Scenario),
    async (req, res, next) => {
        try {
            await Scenario.findByIdAndDelete(req.params.id);
            
            // Update user stats
            req.user.stats.scenariosUploaded = Math.max(0, req.user.stats.scenariosUploaded - 1);
            await req.user.save();
            
            res.json({
                message: 'Scenario deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/scenarios/:id/download - Track download (no auth required)
router.post('/:id/download',
    validate(idParamSchema, 'params'),
    async (req, res, next) => {
        try {
            const scenario = await Scenario.findOne({
                _id: req.params.id,
                isPublic: true
            });
            
            if (!scenario) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Scenario not found'
                });
            }
            
            // Increment download count
            await scenario.incrementDownloads();
            
            // Update author's total downloads
            await User.findByIdAndUpdate(
                scenario.author,
                { $inc: { 'stats.totalDownloads': 1 } }
            );
            
            res.json({
                message: 'Download tracked successfully',
                downloads: scenario.stats.downloads + 1
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/scenarios/user/:userId - Get user's public scenarios
router.get('/user/:userId',
    validate(idParamSchema, 'params'),
    validate(scenarioQuerySchema, 'query'),
    parseTags,
    async (req, res, next) => {
        try {
            const { userId } = req.params;
            const { limit, offset } = req.query;
            
            // Verify user exists
            const user = await User.findById(userId).select('username');
            if (!user) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'User not found'
                });
            }
            
            const query = {
                author: userId,
                isPublic: true,
                ...req.searchQuery
            };
            delete query.isPublic; // Already set above
            query.isPublic = true; // Ensure we only show public scenarios
            
            const [scenarios, total] = await Promise.all([
                Scenario.find(query)
                    .sort(req.sortQuery)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v -messages.metadata')
                    .lean(),
                Scenario.countDocuments(query)
            ]);
            
            // Add computed fields
            const scenariosWithCounts = scenarios.map(scenario => ({
                ...scenario,
                messageCount: scenario.messages?.length || 0,
                characterCount: scenario.characters?.length || 0
            }));
            
            res.json({
                user: { username: user.username },
                scenarios: scenariosWithCounts,
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

// GET /api/scenarios/categories - Get all scenario categories (no auth required)
router.get('/categories',
    async (req, res, next) => {
        try {
            const categories = await Scenario.distinct('category', { 
                isPublic: true, 
                category: { $exists: true, $ne: null, $ne: '' } 
            });
            
            res.json({
                categories: categories.sort()
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;