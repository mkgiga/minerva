import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 5000,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    characterName: {
        type: String,
        maxlength: 100,
        trim: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { _id: false });

const scenarioSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
        index: true
    },
    description: {
        type: String,
        maxlength: 2000,
        trim: true
    },
    category: {
        type: String,
        maxlength: 50,
        trim: true,
        lowercase: true,
        index: true
    },
    characters: [{
        type: String,
        maxlength: 100,
        trim: true
    }],
    messages: [messageSchema],
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    authorName: {
        type: String,
        required: true,
        index: true
    },
    tags: [{
        type: String,
        maxlength: 50,
        trim: true,
        lowercase: true
    }],
    isPublic: {
        type: Boolean,
        default: true,
        index: true
    },
    stats: {
        downloads: { type: Number, default: 0 },
        favorites: { type: Number, default: 0 },
        views: { type: Number, default: 0 }
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    version: {
        type: Number,
        default: 1
    }
}, {
    timestamps: true
});

// Virtual for message count (useful for filtering)
scenarioSchema.virtual('messageCount').get(function() {
    return this.messages.length;
});

// Virtual for character count
scenarioSchema.virtual('characterCount').get(function() {
    return this.characters.length;
});

// Text search index
scenarioSchema.index({
    name: 'text',
    description: 'text',
    category: 'text',
    characters: 'text',
    tags: 'text',
    authorName: 'text'
});

// Compound indexes for common queries
scenarioSchema.index({ author: 1, isPublic: 1, createdAt: -1 });
scenarioSchema.index({ isPublic: 1, 'stats.downloads': -1 });
scenarioSchema.index({ isPublic: 1, createdAt: -1 });
scenarioSchema.index({ category: 1, isPublic: 1 });
scenarioSchema.index({ tags: 1, isPublic: 1 });

// Virtual for scenario URL
scenarioSchema.virtual('url').get(function() {
    return `/api/scenarios/${this._id}`;
});

// Method to increment download count
scenarioSchema.methods.incrementDownloads = function() {
    this.stats.downloads += 1;
    return this.save();
};

// Method to get message count categories
scenarioSchema.methods.getMessageCountCategory = function() {
    const count = this.messages.length;
    if (count <= 50) return 'short';
    if (count <= 100) return 'medium';
    return 'long';
};

// Method to get character count category
scenarioSchema.methods.getCharacterCountCategory = function() {
    const count = this.characters.length;
    if (count === 1) return '1';
    if (count === 2) return '2';
    if (count <= 4) return '3-4';
    return '5+';
};

export default mongoose.model('Scenario', scenarioSchema);