import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 2,
        maxlength: 50,
        index: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    refreshTokens: [{
        token: String,
        expiresAt: Date
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    role: {
        type: String,
        enum: ['user', 'moderator', 'admin'],
        default: 'user'
    },
    profile: {
        bio: { type: String, maxlength: 500 },
        avatar: String,
        website: String
    },
    stats: {
        charactersUploaded: { type: Number, default: 0 },
        notesUploaded: { type: Number, default: 0 },
        scenariosUploaded: { type: Number, default: 0 },
        totalDownloads: { type: Number, default: 0 }
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function(doc, ret) {
            delete ret.password;
            delete ret.refreshTokens;
            return ret;
        }
    }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Method to clean expired refresh tokens
userSchema.methods.cleanExpiredTokens = function() {
    this.refreshTokens = this.refreshTokens.filter(tokenObj => 
        tokenObj.expiresAt > new Date()
    );
    return this.save();
};

// Compound indexes for performance
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ username: 1, isActive: 1 });

export default mongoose.model('User', userSchema);