import mongoose from 'mongoose';

const characterSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
        index: true
    },
    description: {
        type: String,
        maxlength: 5000,
        trim: true
    },
    personality: {
        type: String,
        maxlength: 2000,
        trim: true
    },
    scenario: {
        type: String,
        maxlength: 3000,
        trim: true
    },
    firstMessage: {
        type: String,
        maxlength: 1000,
        trim: true
    },
    exampleDialogue: {
        type: String,
        maxlength: 2000,
        trim: true
    },
    avatar: {
        type: String,
        validate: {
            validator: function(v) {
                if (!v) return true; // Optional field
                try {
                    new URL(v);
                    return true;
                } catch {
                    return false;
                }
            },
            message: 'Avatar must be a valid URL'
        }
    },
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

// Text search index
characterSchema.index({
    name: 'text',
    description: 'text',
    personality: 'text',
    scenario: 'text',
    tags: 'text',
    authorName: 'text'
});

// Compound indexes for common queries
characterSchema.index({ author: 1, isPublic: 1, createdAt: -1 });
characterSchema.index({ isPublic: 1, 'stats.downloads': -1 });
characterSchema.index({ isPublic: 1, createdAt: -1 });
characterSchema.index({ tags: 1, isPublic: 1 });

// Virtual for character URL
characterSchema.virtual('url').get(function() {
    return `/api/characters/${this._id}`;
});

// Method to increment download count
characterSchema.methods.incrementDownloads = function() {
    this.stats.downloads += 1;
    return this.save();
};

export default mongoose.model('Character', characterSchema);