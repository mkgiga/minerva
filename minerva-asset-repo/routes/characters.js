import express from 'express';
import Character from '../models/Character.js';
import User from '../models/User.js';
import searchService from '../services/searchService.js';
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
    characterSchema, 
    characterUpdateSchema, 
    characterQuerySchema,
    idParamSchema 
} from '../schemas/validation.js';

const router = express.Router();

// GET /api/characters - Browse all public characters (no auth required)
router.get('/', 
    validate(characterQuerySchema, 'query'),
    parseTags,
    buildSearchQuery(Character),
    async (req, res, next) => {
        try {
            const { limit, offset } = req.query;
            const query = req.searchQuery;
            const sort = req.sortQuery;
            
            // Special handling for scenario message count filtering
            if (req.query.messageCount) {
                const messageCount = req.query.messageCount;
                if (messageCount === 'short') {
                    query.messageCount = { $lte: 50 };
                } else if (messageCount === 'medium') {
                    query.messageCount = { $gte: 51, $lte: 100 };
                } else if (messageCount === 'long') {
                    query.messageCount = { $gte: 101 };
                }
            }
            
            // Execute query with pagination
            const [characters, total] = await Promise.all([
                Character.find(query)
                    .sort(sort)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v')
                    .lean(),
                Character.countDocuments(query)
            ]);
            
            res.json({
                characters,
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

// GET /api/characters/:id - Get specific character (no auth required)
router.get('/:id',
    validate(idParamSchema, 'params'),
    optionalAuth,
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const isOwner = req.user?.id === id;
            
            // Build query - owners can see their private characters
            const query = { _id: id };
            if (!isOwner) {
                query.isPublic = true;
            }
            
            const character = await Character.findOne(query)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            if (!character) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Character not found'
                });
            }
            
            // Increment view count (but not for owner)
            if (!isOwner) {
                character.stats.views += 1;
                await character.save();
            }
            
            res.json({ character });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/characters - Create new character (auth required)
router.post('/',
    requireAuth,
    validate(characterSchema),
    async (req, res, next) => {
        try {
            const characterData = {
                ...req.body,
                author: req.user._id,
                authorName: req.user.username
            };
            
            const character = new Character(characterData);
            await character.save();
            
            // Add to search index
            await searchService.addDocument('character', character);
            
            // Update user stats
            req.user.stats.charactersUploaded += 1;
            await req.user.save();
            
            const populatedCharacter = await Character.findById(character._id)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            res.status(201).json({
                message: 'Character created successfully',
                character: populatedCharacter
            });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/characters/:id - Update character (auth required, owner only)
router.put('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Character),
    validate(characterUpdateSchema),
    async (req, res, next) => {
        try {
            const updates = req.body;
            
            // Don't allow changing author
            delete updates.author;
            delete updates.authorName;
            
            // Increment version
            updates.version = req.resource.version + 1;
            updates.updatedAt = new Date();
            
            const character = await Character.findByIdAndUpdate(
                req.params.id,
                updates,
                { new: true, runValidators: true }
            )
            .populate('author', 'username profile.avatar')
            .select('-__v');
            
            // Update search index
            await searchService.updateDocument('character', character);
            
            res.json({
                message: 'Character updated successfully',
                character
            });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/characters/:id - Delete character (auth required, owner only)
router.delete('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Character),
    async (req, res, next) => {
        try {
            await Character.findByIdAndDelete(req.params.id);
            
            // Remove from search index
            await searchService.removeDocument('character', req.params.id);
            
            // Update user stats
            req.user.stats.charactersUploaded = Math.max(0, req.user.stats.charactersUploaded - 1);
            await req.user.save();
            
            res.json({
                message: 'Character deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/characters/:id/download - Track download (no auth required)
router.post('/:id/download',
    validate(idParamSchema, 'params'),
    async (req, res, next) => {
        try {
            const character = await Character.findOne({
                _id: req.params.id,
                isPublic: true
            });
            
            if (!character) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Character not found'
                });
            }
            
            // Increment download count
            await character.incrementDownloads();
            
            // Update author's total downloads
            await User.findByIdAndUpdate(
                character.author,
                { $inc: { 'stats.totalDownloads': 1 } }
            );
            
            res.json({
                message: 'Download tracked successfully',
                downloads: character.stats.downloads + 1
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/characters/user/:userId - Get user's public characters
router.get('/user/:userId',
    validate(idParamSchema, 'params'),
    validate(characterQuerySchema, 'query'),
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
            query.isPublic = true; // Ensure we only show public characters
            
            const [characters, total] = await Promise.all([
                Character.find(query)
                    .sort(req.sortQuery)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v')
                    .lean(),
                Character.countDocuments(query)
            ]);
            
            res.json({
                user: { username: user.username },
                characters,
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

export default router;