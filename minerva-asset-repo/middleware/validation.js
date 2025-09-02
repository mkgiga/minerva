import { z } from 'zod';

// Generic validation middleware factory
export const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        try {
            let dataToValidate;
            
            switch (source) {
                case 'body':
                    dataToValidate = req.body;
                    break;
                case 'query':
                    dataToValidate = req.query;
                    break;
                case 'params':
                    dataToValidate = req.params;
                    break;
                default:
                    return res.status(500).json({
                        error: 'Internal Server Error',
                        message: 'Invalid validation source'
                    });
            }

            const validatedData = schema.parse(dataToValidate);
            
            // Replace the original data with validated/transformed data
            switch (source) {
                case 'body':
                    req.body = validatedData;
                    break;
                case 'query':
                    req.query = validatedData;
                    break;
                case 'params':
                    req.params = validatedData;
                    break;
            }
            
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const formattedErrors = error.errors.map(err => ({
                    field: err.path.join('.'),
                    message: err.message,
                    code: err.code
                }));
                
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Request data is invalid',
                    details: formattedErrors
                });
            }
            
            console.error('Validation middleware error:', error);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Validation failed'
            });
        }
    };
};

// Middleware to sanitize and validate file uploads (for future use)
export const validateFileUpload = (options = {}) => {
    const {
        maxSize = 5 * 1024 * 1024, // 5MB default
        allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'],
        required = false
    } = options;

    return (req, res, next) => {
        if (!req.file && !required) {
            return next();
        }

        if (!req.file && required) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'File upload is required'
            });
        }

        if (req.file.size > maxSize) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `File size too large. Maximum allowed size is ${Math.round(maxSize / 1024 / 1024)}MB`
            });
        }

        if (!allowedMimeTypes.includes(req.file.mimetype)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`
            });
        }

        next();
    };
};

// Middleware to parse and validate tags from comma-separated string
export const parseTags = (req, res, next) => {
    if (req.query.tags) {
        req.query.tags = req.query.tags.split(',')
            .map(tag => tag.trim().toLowerCase())
            .filter(tag => tag.length > 0)
            .slice(0, 10); // Limit to 10 tags for query
    }
    next();
};

// Middleware to build MongoDB query from validated query parameters
export const buildSearchQuery = (Model) => {
    return (req, res, next) => {
        const query = { isPublic: true }; // Base query - only public resources for browsing
        
        // Text search
        if (req.query.search) {
            query.$text = { $search: req.query.search };
        }
        
        // Tag filtering
        if (req.query.tags && req.query.tags.length > 0) {
            query.tags = { $in: req.query.tags };
        }
        
        // Author filtering
        if (req.query.author) {
            query.authorName = new RegExp(req.query.author, 'i');
        }
        
        // Category filtering (for notes and scenarios)
        if (req.query.category) {
            query.category = req.query.category;
        }
        
        // Scenario-specific filters
        if (Model.modelName === 'Scenario') {
            if (req.query.characterCount) {
                const charCount = req.query.characterCount;
                if (charCount === '1') {
                    query['characters.0'] = { $exists: true };
                    query['characters.1'] = { $exists: false };
                } else if (charCount === '2') {
                    query['characters.1'] = { $exists: true };
                    query['characters.2'] = { $exists: false };
                } else if (charCount === '3-4') {
                    query['characters.2'] = { $exists: true };
                    query['characters.4'] = { $exists: false };
                } else if (charCount === '5+') {
                    query['characters.4'] = { $exists: true };
                }
            }
        }
        
        req.searchQuery = query;
        
        // Build sort object
        let sort = {};
        const sortParam = req.query.sort || '-createdAt';
        
        if (sortParam.startsWith('-')) {
            sort[sortParam.substring(1)] = -1;
        } else {
            sort[sortParam] = 1;
        }
        
        // Add text score sorting if text search is used
        if (query.$text) {
            sort.score = { $meta: 'textScore' };
        }
        
        req.sortQuery = sort;
        
        next();
    };
};