import { EventEmitter } from 'events';

class AdminEventEmitter extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100); // Allow many admin connections
    }

    // Emit user events
    userRegistered(user) {
        this.emit('user:registered', {
            type: 'user:registered',
            data: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                timestamp: new Date().toISOString()
            }
        });
    }

    userUpdated(user) {
        this.emit('user:updated', {
            type: 'user:updated',
            data: {
                id: user._id,
                username: user.username,
                role: user.role,
                isActive: user.isActive,
                timestamp: new Date().toISOString()
            }
        });
    }

    // Emit resource events
    resourceCreated(type, resource) {
        this.emit('resource:created', {
            type: 'resource:created',
            data: {
                resourceType: type,
                id: resource._id,
                name: resource.name || resource.title,
                author: resource.authorName,
                isPublic: resource.isPublic,
                timestamp: new Date().toISOString()
            }
        });
    }

    resourceUpdated(type, resource) {
        this.emit('resource:updated', {
            type: 'resource:updated',
            data: {
                resourceType: type,
                id: resource._id,
                name: resource.name || resource.title,
                author: resource.authorName,
                isPublic: resource.isPublic,
                timestamp: new Date().toISOString()
            }
        });
    }

    resourceDeleted(type, resourceId, authorName) {
        this.emit('resource:deleted', {
            type: 'resource:deleted',
            data: {
                resourceType: type,
                id: resourceId,
                author: authorName,
                timestamp: new Date().toISOString()
            }
        });
    }

    // Emit download events
    resourceDownloaded(type, resource) {
        this.emit('resource:downloaded', {
            type: 'resource:downloaded',
            data: {
                resourceType: type,
                id: resource._id,
                name: resource.name || resource.title,
                author: resource.authorName,
                downloads: resource.stats.downloads,
                timestamp: new Date().toISOString()
            }
        });
    }

    // Emit stats updates
    statsUpdated(stats) {
        this.emit('stats:updated', {
            type: 'stats:updated',
            data: {
                ...stats,
                timestamp: new Date().toISOString()
            }
        });
    }

    // System events
    systemAlert(level, message, details = {}) {
        this.emit('system:alert', {
            type: 'system:alert',
            data: {
                level, // 'info', 'warning', 'error'
                message,
                details,
                timestamp: new Date().toISOString()
            }
        });
    }
}

// Singleton instance
const adminEvents = new AdminEventEmitter();

export default adminEvents;