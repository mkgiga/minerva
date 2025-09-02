import { z } from 'zod';

// Common schemas
const mongoIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

// User schemas
export const userRegisterSchema = z.object({
    email: z.string().email('Invalid email format').toLowerCase(),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    username: z.string().min(2, 'Username must be at least 2 characters').max(50, 'Username too long').regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores')
});

export const userLoginSchema = z.object({
    email: z.string().email('Invalid email format').toLowerCase(),
    password: z.string().min(1, 'Password is required')
});

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required')
});

// Character schemas
export const characterSchema = z.object({
    name: z.string().min(1, 'Character name is required').max(100, 'Character name too long'),
    description: z.string().max(5000, 'Description too long').optional(),
    personality: z.string().max(2000, 'Personality description too long').optional(),
    scenario: z.string().max(3000, 'Scenario description too long').optional(),
    firstMessage: z.string().max(1000, 'First message too long').optional(),
    exampleDialogue: z.string().max(2000, 'Example dialogue too long').optional(),
    avatar: z.string().url('Invalid avatar URL').optional(),
    tags: z.array(z.string().max(50, 'Tag too long')).max(20, 'Too many tags').default([]),
    isPublic: z.boolean().default(true),
    metadata: z.record(z.string(), z.any()).optional().default({})
});

export const characterUpdateSchema = characterSchema.partial();

export const characterQuerySchema = z.object({
    search: z.string().max(100, 'Search query too long').optional(),
    tags: z.string().optional(), // comma-separated tags
    author: z.string().max(50, 'Author filter too long').optional(),
    limit: z.coerce.number().min(1).max(50).default(20),
    offset: z.coerce.number().min(0).default(0),
    sort: z.enum(['createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'name', '-name', 'downloads', '-downloads']).default('-createdAt')
});

// Note schemas
export const noteSchema = z.object({
    title: z.string().min(1, 'Note title is required').max(200, 'Title too long'),
    content: z.string().min(1, 'Note content is required').max(10000, 'Content too long'),
    category: z.string().max(50, 'Category name too long').optional(),
    tags: z.array(z.string().max(50, 'Tag too long')).max(20, 'Too many tags').default([]),
    isPublic: z.boolean().default(true),
    metadata: z.record(z.string(), z.any()).optional().default({})
});

export const noteUpdateSchema = noteSchema.partial();

export const noteQuerySchema = z.object({
    search: z.string().max(100, 'Search query too long').optional(),
    category: z.string().max(50, 'Category filter too long').optional(),
    tags: z.string().optional(), // comma-separated tags
    author: z.string().max(50, 'Author filter too long').optional(),
    limit: z.coerce.number().min(1).max(50).default(20),
    offset: z.coerce.number().min(0).default(0),
    sort: z.enum(['createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'title', '-title', 'downloads', '-downloads']).default('-createdAt')
});

// Scenario schemas (exported chat conversations)
export const scenarioSchema = z.object({
    name: z.string().min(1, 'Scenario name is required').max(200, 'Name too long'),
    description: z.string().max(2000, 'Description too long').optional(),
    category: z.string().max(50, 'Category name too long').optional(),
    characters: z.array(z.string().max(100, 'Character name too long')).max(10, 'Too many characters').default([]),
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(5000, 'Message content too long'),
        timestamp: z.string().datetime().optional(),
        characterName: z.string().max(100, 'Character name too long').optional(),
        metadata: z.record(z.string(), z.any()).optional().default({})
    })).max(1000, 'Too many messages'),
    tags: z.array(z.string().max(50, 'Tag too long')).max(20, 'Too many tags').default([]),
    isPublic: z.boolean().default(true),
    metadata: z.record(z.string(), z.any()).optional().default({})
});

export const scenarioUpdateSchema = scenarioSchema.partial();

export const scenarioQuerySchema = z.object({
    search: z.string().max(100, 'Search query too long').optional(),
    category: z.string().max(50, 'Category filter too long').optional(),
    tags: z.string().optional(), // comma-separated tags
    author: z.string().max(50, 'Author filter too long').optional(),
    characterCount: z.enum(['1', '2', '3-4', '5+']).optional(),
    messageCount: z.enum(['short', 'medium', 'long']).optional(), // short: 1-50, medium: 51-100, long: 100+
    limit: z.coerce.number().min(1).max(50).default(20),
    offset: z.coerce.number().min(0).default(0),
    sort: z.enum(['createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'name', '-name', 'downloads', '-downloads']).default('-createdAt')
});

// Generic schemas
export const idParamSchema = z.object({
    id: mongoIdSchema
});

export const paginationSchema = z.object({
    limit: z.coerce.number().min(1).max(50).default(20),
    offset: z.coerce.number().min(0).default(0)
});