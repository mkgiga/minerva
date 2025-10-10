// Simple rate limiting middleware
const clients = new Map();

// Clean up old entries every hour
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [ip, data] of clients.entries()) {
        if (now - data.firstRequest > oneHour) {
            clients.delete(ip);
        }
    }
}, 60 * 60 * 1000);

export const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 100; // requests per window

    if (!clients.has(ip)) {
        clients.set(ip, {
            firstRequest: now,
            requests: 1,
            lastRequest: now
        });
        return next();
    }

    const clientData = clients.get(ip);
    
    // Reset window if it's been longer than windowMs
    if (now - clientData.firstRequest > windowMs) {
        clientData.firstRequest = now;
        clientData.requests = 1;
        clientData.lastRequest = now;
        return next();
    }

    // Check if limit exceeded
    if (clientData.requests >= maxRequests) {
        const timeRemaining = Math.ceil((windowMs - (now - clientData.firstRequest)) / 1000);
        
        res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': 0,
            'X-RateLimit-Reset': new Date(Date.now() + timeRemaining * 1000).toISOString(),
            'Retry-After': timeRemaining
        });
        
        return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Try again in ${timeRemaining} seconds.`
        });
    }

    // Update client data
    clientData.requests++;
    clientData.lastRequest = now;

    // Set rate limit headers
    res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - clientData.requests),
        'X-RateLimit-Reset': new Date(clientData.firstRequest + windowMs).toISOString()
    });

    next();
};