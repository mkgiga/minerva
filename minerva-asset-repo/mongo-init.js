// MongoDB initialization script for development
db = db.getSiblingDB('minerva-assets');

// Create collections
db.createCollection('users');
db.createCollection('characters');
db.createCollection('notes');
db.createCollection('scenarios');

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1, isActive: 1 });

db.characters.createIndex({ isPublic: 1, createdAt: -1 });
db.characters.createIndex({ author: 1, isPublic: 1, createdAt: -1 });
db.characters.createIndex({ tags: 1, isPublic: 1 });
db.characters.createIndex({ 
    name: 'text', 
    description: 'text', 
    personality: 'text', 
    tags: 'text' 
});

db.notes.createIndex({ isPublic: 1, createdAt: -1 });
db.notes.createIndex({ author: 1, isPublic: 1, createdAt: -1 });
db.notes.createIndex({ category: 1, isPublic: 1 });
db.notes.createIndex({ tags: 1, isPublic: 1 });
db.notes.createIndex({
    title: 'text',
    content: 'text',
    category: 'text',
    tags: 'text'
});

db.scenarios.createIndex({ isPublic: 1, createdAt: -1 });
db.scenarios.createIndex({ author: 1, isPublic: 1, createdAt: -1 });
db.scenarios.createIndex({ category: 1, isPublic: 1 });
db.scenarios.createIndex({ tags: 1, isPublic: 1 });
db.scenarios.createIndex({
    name: 'text',
    description: 'text',
    category: 'text',
    characters: 'text',
    tags: 'text'
});

print('Database initialized successfully!');