import express from 'express';
import Note from '../models/Note.js';
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
    noteSchema, 
    noteUpdateSchema, 
    noteQuerySchema,
    idParamSchema 
} from '../schemas/validation.js';

const router = express.Router();

// GET /api/notes - Browse all public notes (no auth required)
router.get('/', 
    validate(noteQuerySchema, 'query'),
    parseTags,
    buildSearchQuery(Note),
    async (req, res, next) => {
        try {
            const { limit, offset } = req.query;
            const query = req.searchQuery;
            const sort = req.sortQuery;
            
            // Execute query with pagination
            const [notes, total] = await Promise.all([
                Note.find(query)
                    .sort(sort)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v')
                    .lean(),
                Note.countDocuments(query)
            ]);
            
            res.json({
                notes,
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

// GET /api/notes/:id - Get specific note (no auth required)
router.get('/:id',
    validate(idParamSchema, 'params'),
    optionalAuth,
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const isOwner = req.user?.id === id;
            
            // Build query - owners can see their private notes
            const query = { _id: id };
            if (!isOwner) {
                query.isPublic = true;
            }
            
            const note = await Note.findOne(query)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            if (!note) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Note not found'
                });
            }
            
            // Increment view count (but not for owner)
            if (!isOwner) {
                note.stats.views += 1;
                await note.save();
            }
            
            res.json({ note });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/notes - Create new note (auth required)
router.post('/',
    requireAuth,
    validate(noteSchema),
    async (req, res, next) => {
        try {
            const noteData = {
                ...req.body,
                author: req.user._id,
                authorName: req.user.username
            };
            
            const note = new Note(noteData);
            await note.save();
            
            // Update user stats
            req.user.stats.notesUploaded += 1;
            await req.user.save();
            
            const populatedNote = await Note.findById(note._id)
                .populate('author', 'username profile.avatar')
                .select('-__v');
            
            res.status(201).json({
                message: 'Note created successfully',
                note: populatedNote
            });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/notes/:id - Update note (auth required, owner only)
router.put('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Note),
    validate(noteUpdateSchema),
    async (req, res, next) => {
        try {
            const updates = req.body;
            
            // Don't allow changing author
            delete updates.author;
            delete updates.authorName;
            
            // Increment version
            updates.version = req.resource.version + 1;
            updates.updatedAt = new Date();
            
            const note = await Note.findByIdAndUpdate(
                req.params.id,
                updates,
                { new: true, runValidators: true }
            )
            .populate('author', 'username profile.avatar')
            .select('-__v');
            
            res.json({
                message: 'Note updated successfully',
                note
            });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/notes/:id - Delete note (auth required, owner only)
router.delete('/:id',
    validate(idParamSchema, 'params'),
    requireAuth,
    checkResourceOwnership(Note),
    async (req, res, next) => {
        try {
            await Note.findByIdAndDelete(req.params.id);
            
            // Update user stats
            req.user.stats.notesUploaded = Math.max(0, req.user.stats.notesUploaded - 1);
            await req.user.save();
            
            res.json({
                message: 'Note deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/notes/:id/download - Track download (no auth required)
router.post('/:id/download',
    validate(idParamSchema, 'params'),
    async (req, res, next) => {
        try {
            const note = await Note.findOne({
                _id: req.params.id,
                isPublic: true
            });
            
            if (!note) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Note not found'
                });
            }
            
            // Increment download count
            await note.incrementDownloads();
            
            // Update author's total downloads
            await User.findByIdAndUpdate(
                note.author,
                { $inc: { 'stats.totalDownloads': 1 } }
            );
            
            res.json({
                message: 'Download tracked successfully',
                downloads: note.stats.downloads + 1
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/notes/user/:userId - Get user's public notes
router.get('/user/:userId',
    validate(idParamSchema, 'params'),
    validate(noteQuerySchema, 'query'),
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
            query.isPublic = true; // Ensure we only show public notes
            
            const [notes, total] = await Promise.all([
                Note.find(query)
                    .sort(req.sortQuery)
                    .skip(offset)
                    .limit(limit)
                    .select('-__v')
                    .lean(),
                Note.countDocuments(query)
            ]);
            
            res.json({
                user: { username: user.username },
                notes,
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

// GET /api/notes/categories - Get all note categories (no auth required)
router.get('/categories',
    async (req, res, next) => {
        try {
            const categories = await Note.distinct('category', { 
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