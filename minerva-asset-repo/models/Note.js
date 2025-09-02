import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
        index: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 10000,
        trim: true
    },
    category: {
        type: String,
        maxlength: 50,
        trim: true,
        lowercase: true,
        index: true
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
noteSchema.index({
    title: 'text',
    content: 'text',
    category: 'text',
    tags: 'text',
    authorName: 'text'
});

// Compound indexes for common queries
noteSchema.index({ author: 1, isPublic: 1, createdAt: -1 });
noteSchema.index({ isPublic: 1, 'stats.downloads': -1 });
noteSchema.index({ isPublic: 1, createdAt: -1 });
noteSchema.index({ category: 1, isPublic: 1 });
noteSchema.index({ tags: 1, isPublic: 1 });

// Virtual for note URL
noteSchema.virtual('url').get(function() {
    return `/api/notes/${this._id}`;
});

// Method to increment download count
noteSchema.methods.incrementDownloads = function() {
    this.stats.downloads += 1;
    return this.save();
};

export default mongoose.model('Note', noteSchema);