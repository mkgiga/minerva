import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import searchService from './services/searchService.js';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.js';
import characterRoutes from './routes/characters.js';
import noteRoutes from './routes/notes.js';
import scenarioRoutes from './routes/scenarios.js';
import adminRoutes from './routes/admin.js';
import debugRoutes from './routes/debug.js';
import searchRoutes from './routes/search.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? (process.env.ALLOWED_ORIGINS?.split(',') || false)
        : true, // Allow all origins in development
    credentials: true
}));

// Rate limiting
app.use(rateLimitMiddleware);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/minerva-assets', {
    // Modern connection options
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(async () => {
    
    // Initialize search service
    console.log("🔍 Initializing Meilisearch...");
    await searchService.initialize();
    
    // Only perform initial sync if explicitly requested
    if (process.env.SYNC_ON_STARTUP === "true") {
        await searchService.fullSync();
    }
    console.log(' Connected to MongoDB');
})
.catch((error) => {
    console.error('L MongoDB connection error:', error);
    process.exit(1);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/search', searchRoutes);

// 404 handler for unmatched routes
app.use((req, res, next) => {
    res.status(404).json({ 
        error: 'Route not found',
        message: `Cannot ${req.method} ${req.originalUrl}`
    });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('= SIGTERM received. Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('= SIGINT received. Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`=� Minerva Asset Repository API running on port ${PORT}`);
    console.log(`< Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`= Health check: http://localhost:${PORT}/health`);
});

export default app;