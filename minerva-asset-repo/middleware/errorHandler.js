// Global error handler middleware
export const errorHandler = (error, req, res, next) => {
    console.error('Error occurred:', {
        message: error.message,
        stack: error.stack,
        url: req.originalUrl,
        method: req.method,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    // Mongoose validation error
    if (error.name === 'ValidationError') {
        const validationErrors = Object.values(error.errors).map(err => ({
            field: err.path,
            message: err.message
        }));

        return res.status(400).json({
            error: 'Validation Error',
            message: 'Request data is invalid',
            details: validationErrors
        });
    }

    // Mongoose duplicate key error
    if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        const value = error.keyValue[field];
        
        return res.status(400).json({
            error: 'Duplicate Error',
            message: `${field} '${value}' already exists`
        });
    }

    // Mongoose cast error (invalid ObjectId)
    if (error.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid ID',
            message: 'The provided ID is not valid'
        });
    }

    // JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid token'
        });
    }

    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Token expired'
        });
    }

    // MongoDB connection errors
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        return res.status(500).json({
            error: 'Database Error',
            message: 'A database error occurred'
        });
    }

    // Default error
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: statusCode >= 500 ? 'Internal Server Error' : 'Error',
        message: process.env.NODE_ENV === 'production' && statusCode >= 500 
            ? 'Something went wrong on our end' 
            : message
    });
};