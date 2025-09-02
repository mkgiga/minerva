import express from 'express';
import searchService from '../services/searchService.js';

const router = express.Router();

// Search across all resource types
router.get('/', async (req, res) => {
    try {
        const {
            q: query = '',
            type, // 'character', 'note', 'scenario', or undefined for all
            filters = '',
            sort = [],
            limit = 20,
            offset = 0
        } = req.query;

        // Parse sort parameter if it's a string
        let sortArray = sort;
        if (typeof sort === 'string' && sort) {
            sortArray = sort.split(',');
        }

        const results = await searchService.search(query, {
            type,
            filters,
            sort: sortArray,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            query,
            type: type || 'all',
            results: results,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: 'Search failed',
            message: error.message
        });
    }
});

// Search characters only  
router.get('/characters', async (req, res) => {
    try {
        const {
            q: query = '',
            filters = '',
            sort = ['downloads:desc'],
            limit = 20,
            offset = 0
        } = req.query;

        const results = await searchService.search(query, {
            type: 'character',
            filters,
            sort: Array.isArray(sort) ? sort : [sort],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            characters: results.hits || [],
            totalHits: results.totalHits || 0,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: results.totalHits > parseInt(offset) + parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Character search error:', error);
        res.status(500).json({
            success: false,
            error: 'Character search failed',
            message: error.message
        });
    }
});

// Search notes only
router.get('/notes', async (req, res) => {
    try {
        const {
            q: query = '',
            filters = '',
            sort = ['downloads:desc'],
            limit = 20,
            offset = 0
        } = req.query;

        const results = await searchService.search(query, {
            type: 'note',
            filters,
            sort: Array.isArray(sort) ? sort : [sort],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            notes: results.hits || [],
            totalHits: results.totalHits || 0,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: results.totalHits > parseInt(offset) + parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Note search error:', error);
        res.status(500).json({
            success: false,
            error: 'Note search failed',
            message: error.message
        });
    }
});

// Search scenarios only
router.get('/scenarios', async (req, res) => {
    try {
        const {
            q: query = '',
            filters = '',
            sort = ['downloads:desc'],
            limit = 20,
            offset = 0
        } = req.query;

        const results = await searchService.search(query, {
            type: 'scenario',
            filters,
            sort: Array.isArray(sort) ? sort : [sort],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            scenarios: results.hits || [],
            totalHits: results.totalHits || 0,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: results.totalHits > parseInt(offset) + parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Scenario search error:', error);
        res.status(500).json({
            success: false,
            error: 'Scenario search failed',
            message: error.message
        });
    }
});

export default router;