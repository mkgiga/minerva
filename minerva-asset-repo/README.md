# Minerva Asset Repository

A REST API service for sharing characters, notes, and scenarios (exported chat conversations) for the Minerva LLM GUI application.

## Features

- 🔐 **Authentication**: JWT-based auth with email/password
- 📚 **Public Repository**: Browse resources without authentication
- 🔍 **Search & Filter**: Full-text search with category/tag filtering
- 📊 **Analytics**: Download tracking and user statistics
- 🛡️ **Security**: Helmet, CORS, rate limiting, input validation
- 📝 **Validation**: Zod schema validation for all endpoints
- 🗄️ **Database**: MongoDB with Mongoose ODM

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or remote)

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB URI and JWT secrets
   ```

3. **Start the server**
   ```bash
   npm run dev  # Development with auto-reload
   # or
   npm start    # Production
   ```

4. **Health check**
   ```bash
   curl http://localhost:3001/health
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout (invalidate refresh token)
- `GET /api/auth/profile` - Get current user profile
- `PATCH /api/auth/profile` - Update user profile

### Characters
- `GET /api/characters` - Browse public characters
- `GET /api/characters/:id` - Get character details
- `POST /api/characters` - Create character (auth required)
- `PUT /api/characters/:id` - Update character (owner only)
- `DELETE /api/characters/:id` - Delete character (owner only)
- `POST /api/characters/:id/download` - Track download
- `GET /api/characters/user/:userId` - Get user's public characters

### Notes
- `GET /api/notes` - Browse public notes
- `GET /api/notes/:id` - Get note details
- `POST /api/notes` - Create note (auth required)
- `PUT /api/notes/:id` - Update note (owner only)
- `DELETE /api/notes/:id` - Delete note (owner only)
- `POST /api/notes/:id/download` - Track download
- `GET /api/notes/user/:userId` - Get user's public notes
- `GET /api/notes/categories` - Get all note categories

### Scenarios
- `GET /api/scenarios` - Browse public scenarios
- `GET /api/scenarios/:id` - Get scenario details
- `POST /api/scenarios` - Create scenario (auth required)
- `PUT /api/scenarios/:id` - Update scenario (owner only)
- `DELETE /api/scenarios/:id` - Delete scenario (owner only)
- `POST /api/scenarios/:id/download` - Track download
- `GET /api/scenarios/user/:userId` - Get user's public scenarios
- `GET /api/scenarios/categories` - Get all scenario categories

## Query Parameters

All browse endpoints support these parameters:

- `search` - Full-text search
- `tags` - Comma-separated tags
- `author` - Filter by author username
- `category` - Filter by category (notes/scenarios only)
- `limit` - Results per page (default: 20, max: 50)
- `offset` - Pagination offset (default: 0)
- `sort` - Sort field with optional `-` prefix for descending

### Scenario-specific filters:
- `characterCount` - Filter by number of characters (`1`, `2`, `3-4`, `5+`)
- `messageCount` - Filter by conversation length (`short`, `medium`, `long`)

## Data Models

### Character
```javascript
{
  name: string,
  description?: string,
  personality?: string,
  scenario?: string,
  firstMessage?: string,
  exampleDialogue?: string,
  avatar?: string (URL),
  tags: string[],
  isPublic: boolean,
  metadata: object
}
```

### Note
```javascript
{
  title: string,
  content: string,
  category?: string,
  tags: string[],
  isPublic: boolean,
  metadata: object
}
```

### Scenario (Exported Chat)
```javascript
{
  name: string,
  description?: string,
  category?: string,
  characters: string[],
  messages: [{
    role: 'user' | 'assistant' | 'system',
    content: string,
    timestamp?: Date,
    characterName?: string,
    metadata?: object
  }],
  tags: string[],
  isPublic: boolean,
  metadata: object
}
```

## Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Input Validation**: Zod schema validation on all inputs
- **Authentication**: JWT with refresh token rotation
- **CORS**: Configurable cross-origin resource sharing
- **Helmet**: Security headers (CSP, XSS protection, etc.)
- **Password Hashing**: bcrypt with salt rounds

## Development

The API is designed to work seamlessly with the main Minerva application while being browsable by unauthenticated users. Authentication is only required for creating, updating, or deleting resources.

### Environment Variables

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/minerva-assets

# JWT
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Server
PORT=3001
NODE_ENV=development

# CORS (production only)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
```

## License

This project is part of the Minerva LLM GUI application.