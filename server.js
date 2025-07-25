import express from 'express';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import multer from 'multer';
import { glob } from 'glob';
import { OpenAIV1Adapter } from './server/providers/v1.js';
import { GoogleGeminiAdapter } from './server/providers/gemini.js';
import yaml from 'yaml';
import cors from 'cors';
import { CURRENT_REV, runMigrations, migrateData } from './server/migrations.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverConfig = yaml.parse(readFileSync('config.yaml', 'utf8'));

const HOST = serverConfig.server.host;
const PORT = serverConfig.server.port || 8077;
const STATIC_DIR = serverConfig.data.static_dir || 'client';
const DATA_DIR = serverConfig.data.data_dir || 'data';
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const REUSABLE_STRINGS_DIR = path.join(DATA_DIR, 'reusable_strings');
const GENERATION_CONFIGS_DIR = path.join(DATA_DIR, 'generation_configs');
const CONNECTION_CONFIGS_DIR = path.join(DATA_DIR, 'connection_configs');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const SCENARIOS_DIR = path.join(DATA_DIR, 'scenarios');
const SETTINGS_FILE_PATH = path.join(DATA_DIR, 'settings.json');

// CORS
const corsEnabled = serverConfig.server.cors?.enabled || false;
const corsAllowOrigins = corsEnabled ? serverConfig.server.cors?.allow_origins : [`http://${HOST}:${PORT}`, 'http://localhost:3000'];
const corsAllowMethods = serverConfig.server.cors?.allow_methods || ['GET', 'POST', 'PUT', 'DELETE'];
const corsAllowHeaders = serverConfig.server.cors?.allow_headers || ['Content-Type', 'Authorization'];
const corsCredentials = serverConfig.server.cors?.credentials || true;
const corsOptions = {
    origin: corsAllowOrigins,
    methods: corsAllowMethods,
    allowedHeaders: corsAllowHeaders,
    credentials: corsCredentials,
};

const app = express();
app.use(cors(corsOptions));
const server = createServer(app);

// Keeping track of SSE clients for real-time updates
const sseClients = new Set();

function broadcastEvent(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.res.write(payload);
    }
}

/** Maps provider id to their respective adapter class. */
const ADAPTERS = {
    v1: OpenAIV1Adapter,
    gemini: GoogleGeminiAdapter,
};

// Helper to escape XML special characters to prevent XSS
// `&` -> `&`,
// `<` -> `<`,
// `>` -> `>`,
// `'` -> `'`,
// `"` -> `"`
function escapeXML(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
            case '<': return '<';
            case '>': return '>';
            case '&': return '&';
            case "'": return "'";
            case '"': return '"';
            default: return c;
        }
    });
}

const createCharacterStorage = (subfolder = '') => {
    return multer.diskStorage({
        destination: async (req, file, cb) => {
            const destDir = path.join(CHARACTERS_DIR, req.params.id, subfolder);
            await fs.mkdir(destDir, { recursive: true });

            if (subfolder === '') { // It's an avatar
                try {
                    const oldAvatars = await glob(path.join(destDir, 'avatar.*').replace(/\\/g, '/'));
                    for (const oldAvatar of oldAvatars) await fs.unlink(oldAvatar);
                } catch (err) { console.error("Error removing old avatar:", err); }
            }
            cb(null, destDir);
        },
        filename: (req, file, cb) => {
            const extension = path.extname(file.originalname);
            // Avatars have a fixed name, gallery images get a UUID
            const finalFilename = subfolder === '' ? `avatar${extension}` : `${uuidv4()}${extension}`;
            cb(null, finalFilename);
        }
    });
};

const avatarUpload = multer({ storage: createCharacterStorage('') });
const galleryUpload = multer({ storage: createCharacterStorage('images') });

// Application state, loaded from filesystem
const state = {
    connectionConfigs: [],
    characters: [],
    reusableStrings: [],
    generationConfigs: [],
    chats: [],
    scenarios: [],
    settings: {},
};

async function main() {
    console.log('Starting Minerva server...');
    
    // Create data directories early so migrations can access them.
    await fs.mkdir(CHARACTERS_DIR, { recursive: true });
    await fs.mkdir(REUSABLE_STRINGS_DIR, { recursive: true });
    await fs.mkdir(GENERATION_CONFIGS_DIR, { recursive: true });
    await fs.mkdir(CONNECTION_CONFIGS_DIR, { recursive: true });
    await fs.mkdir(CHATS_DIR, { recursive: true });
    await fs.mkdir(SCENARIOS_DIR, { recursive: true });
    
    // Run migrations before loading any data.
    await runMigrations({ CHARACTERS_DIR, REUSABLE_STRINGS_DIR, GENERATION_CONFIGS_DIR, CONNECTION_CONFIGS_DIR, CHATS_DIR, SCENARIOS_DIR });

    await initializeData();
    initHttp();
    start();
    console.log('Server started successfully.');
}

async function initializeData() {
    console.log('Initializing data from filesystem...');
    try {
        state.settings = await loadSettings();
        state.characters = await loadCharacters();
        state.chats = (await loadJsonFilesFromDir(CHATS_DIR, Chat)).map(chatData => new Chat(chatData));
        state.scenarios = await loadJsonFilesFromDir(SCENARIOS_DIR, Scenario);
        
        // Load user-created strings and prepend the system-defined ones.
        const userReusableStrings = await loadJsonFilesFromDir(REUSABLE_STRINGS_DIR, ReusableString);
        state.reusableStrings = [CHAT_HISTORY_STRING, SCENARIO_STRING, ...userReusableStrings];

        state.generationConfigs = await loadJsonFilesFromDir(GENERATION_CONFIGS_DIR, GenerationConfig);
        state.connectionConfigs = await loadJsonFilesFromDir(CONNECTION_CONFIGS_DIR, ConnectionConfig);

        console.log('Data loaded successfully.');
        console.log(`- ${state.characters.length} characters`);
        console.log(`- ${state.chats.length} chats`);
        console.log(`- ${state.scenarios.length} scenarios`);
        console.log(`- ${state.connectionConfigs.length} connection configs`);
        console.log(`- ${state.reusableStrings.length} reusable strings (including system)`);
        console.log(`- ${state.generationConfigs.length} generation configs`);
        console.log(`- Active Connection ID: ${state.settings.activeConnectionConfigId || 'None'}`);
        console.log(`- Active Gen. Config ID: ${state.settings.activeGenerationConfigId || 'None'}`);
        console.log(`- User Persona ID: ${state.settings.userPersonaCharacterId || 'None'}`);

    } catch (error) {
        console.error('Failed to initialize data:', error);
        process.exit(1);
    }
}

async function loadSettings() {
    try {
        const settingsJson = await fs.readFile(SETTINGS_FILE_PATH, 'utf-8');
        const loadedSettings = JSON.parse(settingsJson);
        const defaultSettings = { 
            activeConnectionConfigId: null, 
            userPersonaCharacterId: null,
            activeGenerationConfigId: null,
            chat: {
                renderer: 'raw' // Default renderer
            },
            chatModes: {}
        };
        
        // Deep merge for nested objects like 'chat' and 'chatModes'
        const mergedSettings = { ...defaultSettings, ...loadedSettings };
        if (loadedSettings.chat) {
            mergedSettings.chat = { ...defaultSettings.chat, ...loadedSettings.chat };
        }
        if (loadedSettings.chatModes) {
            mergedSettings.chatModes = { ...defaultSettings.chatModes, ...loadedSettings.chatModes };
        }

        return mergedSettings;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('settings.json not found, creating default.');
            const defaultSettings = { 
                activeConnectionConfigId: null, 
                userPersonaCharacterId: null,
                activeGenerationConfigId: null,
                chat: {
                    renderer: 'raw'
                },
                chatModes: {}
            };
            await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(defaultSettings, null, 2));
            return defaultSettings;
        }
        throw error;
    }
}

async function loadCharacters() {
    const characterFolders = await fs.readdir(CHARACTERS_DIR, { withFileTypes: true });
    const characters = [];
    for (const dirent of characterFolders) {
        if (dirent.isDirectory()) {
            const charId = dirent.name;
            const charDirPath = path.join(CHARACTERS_DIR, charId);
            const charFilePath = path.join(charDirPath, 'character.json');
            try {
                const charData = JSON.parse(await fs.readFile(charFilePath, 'utf-8'));
                charData.id = charId;

                // Load avatar
                const avatarFiles = await glob(path.join(charDirPath, 'avatar.*').replace(/\\/g, '/'));
                if (avatarFiles.length > 0) {
                    charData.avatarUrl = `/${path.relative(process.cwd(), avatarFiles[0]).replace(/\\/g, '/')}?t=${Date.now()}`;
                } else {
                    charData.avatarUrl = null;
                }
                
                // Load gallery and build full URLs
                if (charData.gallery && Array.isArray(charData.gallery)) {
                    charData.gallery = charData.gallery.map(item => ({
                        ...item,
                        url: `/data/characters/${charId}/images/${item.src}?t=${Date.now()}`
                    }));
                } else {
                    charData.gallery = [];
                }

                characters.push(new Character(charData));
            } catch (err) {
                 if (err.code !== 'ENOENT') console.error(`Error loading character ${charId}:`, err);
            }
        }
    }
    return characters;
}

async function loadJsonFilesFromDir(dir, ClassConstructor) {
    const items = [];
    try {
        const files = await fs.readdir(dir);
        for (const file of files) {
            if (path.extname(file) === '.json') {
                const filePath = path.join(dir, file);
                try {
                    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                    data.id = path.basename(file, '.json');
                    items.push(new ClassConstructor(data));
                } catch (err) { console.error(`Error loading file ${file}:`, err); }
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Error reading directory ${dir}:`, err);
    }
    return items;
}

function start() {
    server.listen(PORT, HOST, () => {
        const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        console.log();
        console.log(`╓`);
        console.log(`║   Minerva backend server is \x1b[32;1mrunning\x1b[0m!`);
        console.log(`║`);
        console.log(`║ HTTP Host: ${HOST}`);
        console.log(`║ HTTP Port: ${PORT}`);
        console.log(`║`);
        console.log(`║   You can visit the client at \x1b[34;1;4mhttp://${displayHost}:${PORT}\x1b[0m`);
        console.log(`╙`);
        console.log();
    });
}

// Helper function for macro resolution
function resolveMacros(text, context) {
    if (!text) return '';
    const { allCharacters = [], userPersonaCharacterId = null, chatCharacters = [], activeScenarios = [] } = context;

    // New complex macro handler: {{characters[name,description,...]}}
    text = text.replace(/{{\s*([a-zA-Z0-9_]+)\[(.*?)\]\s*}}/g, (match, resourceName, propsString) => {
        const props = propsString.split(',').map(p => p.trim().toLowerCase());
        
        if (resourceName.toLowerCase() === 'characters') {
            // Get the list of characters participating in the chat
            let charactersToRender = [...chatCharacters];
            
            const includePlayer = props.includes('player');

            if (includePlayer && userPersonaCharacterId) {
                const playerCharacter = allCharacters.find(c => c.id === userPersonaCharacterId);
                // Add player character if found and not already in the list
                if (playerCharacter && !charactersToRender.some(c => c.id === playerCharacter.id)) {
                    charactersToRender.push(playerCharacter);
                }
            }

            if (!charactersToRender || charactersToRender.length === 0) return '';
            
            return charactersToRender.map(c => {
                const isPlayer = includePlayer && c.id === userPersonaCharacterId;
                const playerAttr = isPlayer ? ' is-player="true"' : '';
                
                const characterLines = [];
                if (props.includes('name') && c.name) {
                    characterLines.push(`    <name>\n        ${escapeXML(c.name)}\n    </name>`);
                }
                if (props.includes('description') && c.description) {
                    characterLines.push(`    <description>\n        ${escapeXML(c.description)}\n    </description>`);
                }
                if (props.includes('images') && c.gallery && c.gallery.length > 0) {
                    const imageLines = c.gallery.map(img => {
                        return `        <image>\n            <filename>${escapeXML(img.src)}</filename>\n            <alt>${escapeXML(img.alt || '')}</alt>\n        </image>`;
                    });
                    if (imageLines.length > 0) {
                        characterLines.push(`    <images>\n${imageLines.join('\n')}\n    </images>`);
                    }
                }
                if (props.includes('scenario')) {
                    const characterScenarioXmlString = activeScenarios.map(s => {
                        const overrideText = s.characterOverrides?.[c.id];
                        if (!overrideText?.trim()) return null;
                        const describesAttr = s.describes ? ` describes="${escapeXML(s.describes)}"` : '';
                        return `    <scenario${describesAttr}>\n        <override>${escapeXML(overrideText)}</override>\n    </scenario>`;
                    }).filter(Boolean).join('\n');

                    if (characterScenarioXmlString) {
                        characterLines.push(characterScenarioXmlString);
                    }
                }
                
                if (characterLines.length > 0) {
                    return `<character id="${escapeXML(c.id)}"${playerAttr}>\n${characterLines.join('\n')}\n</character>`;
                }
                return '';
            }).filter(Boolean).join('\n\n');
        }
        
        return match; // Return original if resourceName is not 'characters'
    });

    const playerCharacter = userPersonaCharacterId
        ? allCharacters.find(c => c.id === userPersonaCharacterId)
        : null;

    const macros = {
        characters: () => {
            if (!chatCharacters || chatCharacters.length === 0) return '';
            
            return chatCharacters.map(c => {
                // Include character ID to help the LLM use it.
                return `${c.name} (ID: ${c.id})\n${c.description}`;
            }).join('\n\n\n\n');
        },
        scenarios: () => {
            if (!activeScenarios || activeScenarios.length === 0) return '';
            
            return activeScenarios.map(s => {
                if (!s.description?.trim()) return null;
                const describesAttr = s.describes ? ` describes="${escapeXML(s.describes)}"` : '';
                return `<scenario${describesAttr}>${escapeXML(s.description)}</scenario>`;
            }).filter(Boolean).join('\n\n');
        },
        player: () => {
            if (!playerCharacter) return '';
            return `${playerCharacter.name}\n${playerCharacter.description}`;
        },
        time: () => new Date().toLocaleTimeString(),
        date: () => new Date().toLocaleDateString(),
        random: () => Math.random().toString()
    };

    const re = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;
    return text.replace(re, (match, macroName) => {
        const lowerMacroName = macroName.toLowerCase();

        // Handle simple macros first (e.g., {{player}}, {{time}})
        if (macros[lowerMacroName]) {
            return macros[lowerMacroName]();
        }

        // Handle dot-notation macros (e.g., {{player.name}})
        const parts = lowerMacroName.split('.');
        if (parts.length === 2) {
            const [objectName, propertyName] = parts;
            if (objectName === 'player' && playerCharacter) {
                if (propertyName === 'name') return playerCharacter.name || '';
                if (propertyName === 'description') return playerCharacter.description || '';
            } else {
                // Handle {{character_id.property}}
                const targetCharacter = allCharacters.find(c => c.id === objectName);
                if (targetCharacter) {
                    switch (propertyName) {
                        case 'name': return targetCharacter.name || '';
                        case 'description': return targetCharacter.description || '';
                        case 'images':
                            if (!targetCharacter.gallery || targetCharacter.gallery.length === 0) return '';
                            const imagesXml = targetCharacter.gallery.map(img => {
                                const fullUrl = `/data/characters/${targetCharacter.id}/images/${img.src}`;
                                return `<image src="${fullUrl}" alt="${escapeXML(img.alt || '')}" />`;
                            }).join('');
                            return `<images>${imagesXml}</images>`;
                    }
                }
            }
        }
        
        console.warn(`Macro {{${macroName}}} not found.`);
        return match;
    });
}


function initHttp() {
    app.use(express.json({ limit: '50mb' })); // Increased limit
    app.use(express.urlencoded({ limit: '50mb', extended: true })); // Increased limit
    app.use(express.static(STATIC_DIR));
    app.use('/data', express.static(path.join(process.cwd(), 'data')));
    app.get('/', (req, res) => res.sendFile('index.html', { root: 'client' }));

    // SSE Endpoint for real-time updates
    app.get('/api/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const clientId = uuidv4();
        const client = { id: clientId, res };
        sseClients.add(client);
        console.log(`SSE client connected: ${clientId}`);

        req.on('close', () => {
            sseClients.delete(client);
            console.log(`SSE client disconnected: ${clientId}`);
        });
    });

    // API Endpoints
    app.get('/api/settings', (req, res) => res.json(state.settings));
    app.post('/api/settings', async (req, res) => {
        try {
            // Deep merge new settings with existing ones.
            const newSettings = { ...state.settings, ...req.body };
            if (req.body.chat) {
                newSettings.chat = { ...state.settings.chat, ...req.body.chat };
            }
            if (req.body.chatModes) {
                newSettings.chatModes = { ...(state.settings.chatModes || {}) };
                for (const [mode, modeSettings] of Object.entries(req.body.chatModes)) {
                    newSettings.chatModes[mode] = { ...(state.settings.chatModes?.[mode] || {}), ...modeSettings };
                }
            }
            
            state.settings = newSettings;
            await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
            
            broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
            res.json(state.settings);
        } catch (error) {
            console.error('Error saving settings:', error);
            res.status(500).json({ message: 'Failed to save settings.' });
        }
    });
    app.post('/api/settings/persona', async (req, res) => {
        const { characterId } = req.body;
        // Allow setting to null or a valid character ID
        if (characterId && !state.characters.some(c => c.id === characterId)) {
            return res.status(404).json({ message: 'Character not found.' });
        }
        state.settings.userPersonaCharacterId = characterId;
        try {
            await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
            res.json(state.settings);
        } catch (error) {
            console.error('Error saving settings:', error);
            res.status(500).json({ message: 'Failed to save settings.' });
        }
    });
    
    // Characters API
    app.get('/api/characters', async (req, res) => {
        try {
            state.characters = await loadCharacters();
            res.json(state.characters);
        } catch (error) { res.status(500).json({ message: 'Failed to retrieve characters' }); }
    });
    app.post('/api/characters', async (req, res) => {
        try {
            // Check if this is an import by seeing if it has a name (newly created ones don't).
            const isImport = !!req.body.name;
            let charData = req.body;

            if (isImport) {
                charData = await migrateData(charData, 'character');
            }
            
            // The user can suggest an ID, but we ensure it's unique.
            let id = charData.id || uuidv4();
            if (state.characters.some(c => c.id === id)) {
                id = uuidv4(); // Fallback to UUID if suggested ID is taken.
            }
            charData.id = id;

            const newChar = new Character(charData);
            const charDir = path.join(CHARACTERS_DIR, newChar.id);
            await fs.mkdir(charDir, { recursive: true });
            await fs.writeFile(path.join(charDir, 'character.json'), JSON.stringify(newChar.toSaveObject(), null, 2));
            state.characters.push(newChar);
            broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'create', data: newChar });
            res.status(201).json(newChar);
        } catch (error) { res.status(500).json({ message: 'Failed to create character' }); }
    });
    app.post('/api/characters/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
        try {
            const { id } = req.params;
            if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found.' });
            character.avatarUrl = `/${path.relative(process.cwd(), req.file.path).replace(/\\/g, '/')}?t=${Date.now()}`;
            broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: character });
            res.json(character);
        } catch (error) { res.status(500).json({ message: 'Failed to upload avatar' }); }
    });

    // Gallery Endpoints
    app.post('/api/characters/:id/gallery', galleryUpload.single('image'), async (req, res) => {
        try {
            const { id } = req.params;
            const { alt = '' } = req.body;
            if (!req.file) return res.status(400).json({ message: 'No image file provided.' });
            
            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found' });

            const newGalleryItem = { src: req.file.filename, alt };
            character.gallery.push(newGalleryItem);

            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));
            
            // Re-load character to get the full URL for the new image in the broadcast
            const updatedCharacter = await loadSingleCharacter(id);
            if (updatedCharacter) {
                 broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                 res.status(201).json(updatedCharacter);
            } else {
                 res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            console.error('Error adding gallery image:', error);
            res.status(500).json({ message: 'Failed to add image to gallery.' });
        }
    });

    app.put('/api/characters/:id/gallery/:filename', async (req, res) => {
        try {
            const { id, filename } = req.params;
            const { alt } = req.body;

            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found.' });

            const galleryItem = character.gallery.find(item => item.src === filename);
            if (!galleryItem) return res.status(404).json({ message: 'Gallery image not found.' });

            galleryItem.alt = alt;
            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));
            
            const updatedCharacter = await loadSingleCharacter(id);
             if (updatedCharacter) {
                 broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                 res.json(updatedCharacter);
            } else {
                 res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Failed to update gallery item.' });
        }
    });

    app.delete('/api/characters/:id/gallery/:filename', async (req, res) => {
        try {
            const { id, filename } = req.params;
            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found.' });

            const imagePath = path.join(CHARACTERS_DIR, id, 'images', filename);
            await fs.unlink(imagePath).catch(err => console.warn(`Could not delete file ${imagePath}: ${err.message}`));

            character.gallery = character.gallery.filter(item => item.src !== filename);
            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));

            const updatedCharacter = await loadSingleCharacter(id);
             if (updatedCharacter) {
                 broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                 res.status(204).send();
            } else {
                 res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Failed to delete gallery item.' });
        }
    });

    app.put('/api/characters/:id', async (req, res) => {
        try {
            const originalId = req.params.id;
            const updates = req.body;
            const newId = updates.id ? updates.id.trim() : originalId;

            let character = state.characters.find(c => c.id === originalId);
            if (!character) return res.status(404).json({ message: 'Character not found' });
            
            // Handle ID change
            if (newId && newId !== originalId) {
                // 1. Check for conflict
                const newPath = path.join(CHARACTERS_DIR, newId);
                try {
                    await fs.access(newPath);
                    // If access does not throw, the directory exists.
                    return res.status(409).json({ message: `Character ID "${newId}" already exists.` });
                } catch (e) {
                    if (e.code !== 'ENOENT') throw e; // Rethrow unexpected errors
                }

                // 2. Rename directory
                const oldPath = path.join(CHARACTERS_DIR, originalId);
                await fs.rename(oldPath, newPath);

                // 3. Update all references
                await updateCharacterIdReferences(originalId, newId);
                
                // 4. Update the character object and save it
                character.id = newId;
                Object.assign(character, updates);
                await fs.writeFile(path.join(newPath, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));
                
                // 5. Reload the character to get correct URLs and broadcast
                const reloadedCharacter = await loadSingleCharacter(newId);
                const oldCharacterData = { id: originalId };
                
                // Update state
                state.characters = state.characters.filter(c => c.id !== originalId);
                state.characters.push(reloadedCharacter);
                
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'delete', data: oldCharacterData });
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'create', data: reloadedCharacter });
                return res.json(reloadedCharacter);
            }

            // Standard update without ID change
            Object.assign(character, updates);
            await fs.writeFile(path.join(CHARACTERS_DIR, originalId, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));
            
            const reloadedCharacter = await loadSingleCharacter(originalId);
            const charIndex = state.characters.findIndex(c => c.id === originalId);
            if (charIndex !== -1) state.characters[charIndex] = reloadedCharacter;

            broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: reloadedCharacter });
            res.json(reloadedCharacter);

        } catch (error) { 
            console.error('Error updating character:', error);
            res.status(500).json({ message: 'Failed to update character' }); 
        }
    });
    app.delete('/api/characters/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!state.characters.some(c => c.id === id)) return res.status(404).json({ message: 'Character not found' });
            await fs.rm(path.join(CHARACTERS_DIR, id), { recursive: true, force: true });
            state.characters = state.characters.filter(c => c.id !== id);
            broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'delete', data: { id } });
            // If the deleted character was the user persona, unset it
            if (state.settings.userPersonaCharacterId === id) {
                state.settings.userPersonaCharacterId = null;
                await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
                broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
            }
            res.status(204).send();
        } catch (error) { res.status(500).json({ message: 'Failed to delete character' }); }
    });

    // Scenarios API
    app.get('/api/scenarios', (req, res) => res.json(state.scenarios));
    app.post('/api/scenarios', async (req, res) => {
        try {
            const scenario = new Scenario(req.body);
            await fs.writeFile(path.join(SCENARIOS_DIR, `${scenario.id}.json`), JSON.stringify(scenario, null, 2));
            state.scenarios.push(scenario);
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'create', data: scenario });
            res.status(201).json(scenario);
        } catch (e) { res.status(500).json({ message: 'Failed to create scenario.' }); }
    });
    app.put('/api/scenarios/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const index = state.scenarios.findIndex(s => s.id === id);
            if (index === -1) return res.status(404).json({ message: 'Scenario not found.' });
            const updatedScenario = new Scenario({ ...req.body, id });
            await fs.writeFile(path.join(SCENARIOS_DIR, `${id}.json`), JSON.stringify(updatedScenario, null, 2));
            state.scenarios[index] = updatedScenario;
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'update', data: updatedScenario });
            res.json(updatedScenario);
        } catch (e) { res.status(500).json({ message: 'Failed to update scenario.' }); }
    });
    app.delete('/api/scenarios/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!state.scenarios.some(s => s.id === id)) return res.status(404).json({ message: 'Scenario not found.' });
            
            await fs.unlink(path.join(SCENARIOS_DIR, `${id}.json`));
            state.scenarios = state.scenarios.filter(s => s.id !== id);
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'delete', data: { id } });

            // Also remove this scenario from any chats that use it
            const allChats = await loadJsonFilesFromDir(CHATS_DIR, Chat);
            for (const chat of allChats) {
                const initialLength = chat.scenarios.length;
                chat.scenarios = chat.scenarios.filter(s => (typeof s === 'string' ? s : s.id) !== id);

                if (chat.scenarios.length < initialLength) {
                    await fs.writeFile(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));
                    broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: chat });
                }
            }
            res.status(204).send();
        } catch (e) { res.status(500).json({ message: 'Failed to delete scenario.' }); }
    });

    // Chats API
    app.get('/api/chats', async (req, res) => {
        const chats = await loadJsonFilesFromDir(CHATS_DIR, Chat);
        // Ensure new Chat objects are instantiated to apply defaults like systemInstruction
        res.json(chats.map(c => new Chat(c)).sort((a,b) => new Date(b.lastModifiedAt) - new Date(a.lastModifiedAt)).map(c => c.getSummary()));
    });
    app.post('/api/chats', async (req, res) => {
        const newChat = new Chat(req.body);
        // The user persona is NOT automatically added as a participant anymore.
        // It's defined at prompt-time via macros.
        await fs.writeFile(path.join(CHATS_DIR, `${newChat.id}.json`), JSON.stringify(newChat, null, 2));
        state.chats.push(newChat);
        broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'create', data: newChat.getSummary() });
        res.status(201).json(newChat);
    });
    app.get('/api/chats/:id', async (req, res) => {
        try {
            const chatPath = path.join(CHATS_DIR, `${req.params.id}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);
            res.json(chat);
        } catch (e) { 
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            console.error(`Error processing chat ${req.params.id}:`, e);
            res.status(500).json({ message: 'Failed to retrieve chat' });
        }
    });
    app.put('/api/chats/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const chatPath = path.join(CHATS_DIR, `${id}.json`);
            const existingChatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const updatedChat = new Chat({ ...existingChatData, ...req.body, id });
            updatedChat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(updatedChat, null, 2));
            const index = state.chats.findIndex(c => c.id === id);
            if (index !== -1) state.chats[index] = updatedChat;
            else state.chats.push(updatedChat);

            // Broadcast changes for both the detailed chat and the summary list
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: updatedChat.getSummary() });
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: updatedChat });
            
            res.json(updatedChat);
        } catch (e) { 
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            res.status(500).json({ message: 'Failed to update chat' });
        }
    });
    app.delete('/api/chats/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const chatPath = path.join(CHATS_DIR, `${id}.json`);
            const chatToDelete = new Chat(JSON.parse(await fs.readFile(chatPath, 'utf-8')));

            // If this chat has a parent, remove it from the parent's childChatIds
            if (chatToDelete.parentId) {
                const parentChatPath = path.join(CHATS_DIR, `${chatToDelete.parentId}.json`);
                try {
                    const parentChatData = JSON.parse(await fs.readFile(parentChatPath, 'utf-8'));
                    const parentChat = new Chat(parentChatData);
                    parentChat.childChatIds = parentChat.childChatIds.filter(childId => childId !== id);
                    parentChat.lastModifiedAt = new Date().toISOString();
                    await fs.writeFile(parentChatPath, JSON.stringify(parentChat, null, 2));
                    broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: parentChat.getSummary() });
                } catch (e) {
                    if (e.code !== 'ENOENT') console.error(`Error updating parent chat ${chatToDelete.parentId} after child deletion:`, e);
                }
            }
            
            // If this chat has children, clear their parentId (they become root-level or orphaned for now)
            for (const childId of chatToDelete.childChatIds) {
                const childChatPath = path.join(CHATS_DIR, `${childId}.json`);
                try {
                    const childChatData = JSON.parse(await fs.readFile(childChatPath, 'utf-8'));
                    const childChat = new Chat(childChatData);
                    childChat.parentId = null; // Orphan the child
                    childChat.lastModifiedAt = new Date().toISOString();
                    await fs.writeFile(childChatPath, JSON.stringify(childChat, null, 2));
                    broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: childChat.getSummary() });
                } catch (e) {
                    if (e.code !== 'ENOENT') console.error(`Error updating child chat ${childId} after parent deletion:`, e);
                }
            }


            await fs.unlink(chatPath);
            state.chats = state.chats.filter(c => c.id !== id);
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'delete', data: { id } });
            res.status(204).send();
        } catch (e) { res.status(404).json({ message: 'Chat not found' }); }
    });
    app.post('/api/chats/:id/branch', async (req, res) => {
        const { id: originalChatId } = req.params;
        const { messageId } = req.body;

        try {
            const originalChatPath = path.join(CHATS_DIR, `${originalChatId}.json`);
            const originalChatData = JSON.parse(await fs.readFile(originalChatPath, 'utf-8'));
            const originalChat = new Chat(originalChatData);

            if (!messageId) {
                return res.status(400).json({ message: 'A messageId is required to branch from.' });
            }

            const branchIndex = originalChat.messages.findIndex(m => m.id === messageId);
            if (branchIndex === -1) {
                return res.status(404).json({ message: 'Branch point message not found in chat.' });
            }

            // Create the new branched chat
            const newChat = new Chat({
                name: `[Branch from "${originalChat.name}"]`, // More descriptive name
                participants: originalChat.participants,
                scenarios: originalChat.scenarios, // Copy scenarios to branch
                parentId: originalChat.id, // Set parent ID
                systemInstruction: originalChat.systemInstruction,
                messages: originalChat.messages.slice(0, branchIndex + 1)
            });
            await fs.writeFile(path.join(CHATS_DIR, `${newChat.id}.json`), JSON.stringify(newChat, null, 2));
            state.chats.push(newChat);

            // Update the original chat to record the new branch as its child
            originalChat.childChatIds.push(newChat.id);
            originalChat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(path.join(CHATS_DIR, `${originalChat.id}.json`), JSON.stringify(originalChat, null, 2));
            
            // Broadcast updates for both the new chat and the updated original chat
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'create', data: newChat.getSummary() });
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: originalChat.getSummary() });
            
            res.status(201).json(newChat);

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Original chat not found.' });
            console.error(`Error branching chat ${originalChatId}:`, e);
            res.status(500).json({ message: 'Failed to create chat branch.' });
        }
    });

    // New endpoint to promote an embedded resource to the global library
    app.post('/api/chats/:id/promote-to-library', async (req, res) => {
        const { id: chatId } = req.params;
        const { resourceType, resourceId } = req.body;

        if (!resourceType || !resourceId) {
            return res.status(400).json({ message: 'resourceType and resourceId are required.' });
        }
        if (resourceType !== 'character' && resourceType !== 'scenario') {
            return res.status(400).json({ message: 'Invalid resourceType.' });
        }

        try {
            const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);
            
            let newGlobalResource;
            let found = false;

            if (resourceType === 'character') {
                const charIndex = chat.participants.findIndex(p => typeof p === 'object' && p.id === resourceId);
                if (charIndex === -1) return res.status(404).json({ message: 'Embedded character not found in chat.' });
                
                const embeddedCharData = chat.participants[charIndex];
                const newChar = new Character(embeddedCharData); // This assigns a new permanent ID
                
                const charDir = path.join(CHARACTERS_DIR, newChar.id);
                await fs.mkdir(charDir, { recursive: true });
                await fs.writeFile(path.join(charDir, 'character.json'), JSON.stringify(newChar.toSaveObject(), null, 2));
                
                state.characters.push(newChar);
                chat.participants[charIndex] = newChar.id; // Replace object with ID
                newGlobalResource = newChar;
                found = true;
            } else if (resourceType === 'scenario') {
                const scenarioIndex = chat.scenarios.findIndex(s => typeof s === 'object' && s.id === resourceId);
                if (scenarioIndex === -1) return res.status(404).json({ message: 'Embedded scenario not found in chat.' });

                const embeddedScenarioData = chat.scenarios[scenarioIndex];
                const newScenario = new Scenario(embeddedScenarioData); // Assigns new permanent ID

                await fs.writeFile(path.join(SCENARIOS_DIR, `${newScenario.id}.json`), JSON.stringify(newScenario, null, 2));

                state.scenarios.push(newScenario);
                chat.scenarios[scenarioIndex] = newScenario.id; // Replace object with ID
                newGlobalResource = newScenario;
                found = true;
            }

            if (found) {
                // Save the updated chat file
                chat.lastModifiedAt = new Date().toISOString();
                await fs.writeFile(chatPath, JSON.stringify(chat, null, 2));

                // Broadcast events
                broadcastEvent('resourceChange', { resourceType, eventType: 'create', data: newGlobalResource });
                broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: chat });
                
                res.json(chat);
            }

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found.' });
            console.error('Error promoting resource:', e);
            res.status(500).json({ message: 'Failed to promote resource to library.' });
        }
    });

    // Adapters API
    app.get('/api/adapters/schemas', (req, res) => {
        const schemas = {};
        for (const [id, adapterClass] of Object.entries(ADAPTERS)) {
            if (typeof adapterClass.getAdapterSchema === 'function') {
                schemas[id] = adapterClass.getAdapterSchema();
            }
        }
        res.json(schemas);
    });

    app.get('/api/adapters/generation-schemas', (req, res) => {
        const schemas = {};
        for (const [id, adapterClass] of Object.entries(ADAPTERS)) {
            if (typeof adapterClass.getGenerationParametersSchema === 'function') {
                schemas[id] = adapterClass.getGenerationParametersSchema();
            }
        }
        res.json(schemas);
    });

    // Connection Config API
    app.get('/api/connection-configs', (req, res) => res.json(state.connectionConfigs));
    app.post('/api/connection-configs', async (req, res) => {
        const config = new ConnectionConfig(req.body);
        await fs.writeFile(path.join(CONNECTION_CONFIGS_DIR, `${config.id}.json`), JSON.stringify(config.toJSON(), null, 2));
        state.connectionConfigs.push(config);
        broadcastEvent('resourceChange', { resourceType: 'connection_config', eventType: 'create', data: config });
        res.status(201).json(config);
    });
    app.put('/api/connection-configs/:id', async (req, res) => {
        const { id } = req.params;
        const index = state.connectionConfigs.findIndex(c => c.id === id);
        if (index === -1) return res.status(404).json({ message: 'Config not found.' });
        const updatedConfig = new ConnectionConfig({ ...req.body, id });
        await fs.writeFile(path.join(CONNECTION_CONFIGS_DIR, `${id}.json`), JSON.stringify(updatedConfig.toJSON(), null, 2));
        state.connectionConfigs[index] = updatedConfig;
        broadcastEvent('resourceChange', { resourceType: 'connection_config', eventType: 'update', data: updatedConfig });
        res.json(updatedConfig);
    });
    app.delete('/api/connection-configs/:id', async (req, res) => {
        const { id } = req.params;
        if (!state.connectionConfigs.some(c => c.id === id)) return res.status(404).json({ message: 'Config not found.' });
        await fs.unlink(path.join(CONNECTION_CONFIGS_DIR, `${id}.json`));
        state.connectionConfigs = state.connectionConfigs.filter(c => c.id !== id);
        broadcastEvent('resourceChange', { resourceType: 'connection_config', eventType: 'delete', data: { id } });
        if (state.settings.activeConnectionConfigId === id) {
            state.settings.activeConnectionConfigId = null;
            await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
        }
        res.status(204).send();
    });
    app.post('/api/connection-configs/:id/activate', async (req, res) => {
        const { id } = req.params;
        if (id === 'null') {
             state.settings.activeConnectionConfigId = null;
        } else {
             if (!state.connectionConfigs.some(c => c.id === id)) return res.status(404).json({ message: 'Config not found.' });
             state.settings.activeConnectionConfigId = id;
        }
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
        broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
        res.json(state.settings);
    });
    app.post('/api/connection-configs/test', async (req, res) => {
        try {
            const config = new ConnectionConfig(req.body);
            const AdapterClass = ADAPTERS[config.adapter];
            if (!AdapterClass) {
                return res.status(400).json({ ok: false, message: `Unsupported adapter type: '${config.adapter}'` });
            }
            const adapterInstance = new AdapterClass(config);
            const result = await adapterInstance.healthCheck();
            res.json(result);
        } catch (error) {
            res.status(500).json({ ok: false, message: error.message });
        }
    });

    // Generation Configs API
    app.get('/api/generation-configs', (req, res) => res.json(state.generationConfigs));
    app.post('/api/generation-configs', async (req, res) => {
        const config = new GenerationConfig(req.body);
        await fs.writeFile(path.join(GENERATION_CONFIGS_DIR, `${config.id}.json`), JSON.stringify(config, null, 2));
        state.generationConfigs.push(config);
        broadcastEvent('resourceChange', { resourceType: 'generation_config', eventType: 'create', data: config });
        res.status(201).json(config);
    });
    app.put('/api/generation-configs/:id', async (req, res) => {
        const { id } = req.params;
        const index = state.generationConfigs.findIndex(c => c.id === id);
        if (index === -1) return res.status(404).json({ message: 'Generation config not found.' });
        const updatedConfig = new GenerationConfig({ ...req.body, id });
        await fs.writeFile(path.join(GENERATION_CONFIGS_DIR, `${id}.json`), JSON.stringify(updatedConfig, null, 2));
        state.generationConfigs[index] = updatedConfig;
        broadcastEvent('resourceChange', { resourceType: 'generation_config', eventType: 'update', data: updatedConfig });
        res.json(updatedConfig);
    });
    app.delete('/api/generation-configs/:id', async (req, res) => {
        const { id } = req.params;
        if (!state.generationConfigs.some(c => c.id === id)) return res.status(404).json({ message: 'Config not found.' });
        await fs.unlink(path.join(GENERATION_CONFIGS_DIR, `${id}.json`));
        state.generationConfigs = state.generationConfigs.filter(c => c.id !== id);
        broadcastEvent('resourceChange', { resourceType: 'generation_config', eventType: 'delete', data: { id } });
        if (state.settings.activeGenerationConfigId === id) {
            state.settings.activeGenerationConfigId = null;
            await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
        }
        res.status(204).send();
    });
    app.post('/api/generation-configs/:id/activate', async (req, res) => {
        const { id } = req.params;
        if (id === 'null') {
            state.settings.activeGenerationConfigId = null;
        } else {
            if (!state.generationConfigs.some(c => c.id === id)) {
                return res.status(404).json({ message: 'Generation config not found.' });
            }
            state.settings.activeGenerationConfigId = id;
        }
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
        broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
        res.json(state.settings);
    });

    // Reusable Strings API
    app.get('/api/reusable-strings', (req, res) => res.json(state.reusableStrings));
    app.post('/api/reusable-strings', async (req, res) => {
        const newString = new ReusableString(req.body);
        await fs.writeFile(path.join(REUSABLE_STRINGS_DIR, `${newString.id}.json`), JSON.stringify(newString, null, 2));
        state.reusableStrings.push(newString);
        broadcastEvent('resourceChange', { resourceType: 'reusable_string', eventType: 'create', data: newString });
        res.status(201).json(newString);
    });
    app.put('/api/reusable-strings/:id', async (req, res) => {
        const { id } = req.params;
        if (id === CHAT_HISTORY_STRING.id || id === SCENARIO_STRING.id) {
            return res.status(403).json({ message: 'System strings are not editable.' });
        }
        const index = state.reusableStrings.findIndex(s => s.id === id);
        if (index === -1) return res.status(404).json({ message: 'String not found.' });
        const updatedString = new ReusableString({ ...req.body, id });
        await fs.writeFile(path.join(REUSABLE_STRINGS_DIR, `${id}.json`), JSON.stringify(updatedString, null, 2));
        state.reusableStrings[index] = updatedString;
        broadcastEvent('resourceChange', { resourceType: 'reusable_string', eventType: 'update', data: updatedString });
        res.json(updatedString);
    });
    app.delete('/api/reusable-strings/:id', async (req, res) => {
        const { id } = req.params;
        if (id === CHAT_HISTORY_STRING.id || id === SCENARIO_STRING.id) {
            return res.status(403).json({ message: 'System strings cannot be deleted.' });
        }
        if (!state.reusableStrings.some(s => s.id === id)) return res.status(404).json({ message: 'String not found.' });
        await fs.unlink(path.join(REUSABLE_STRINGS_DIR, `${id}.json`));
        state.reusableStrings = state.reusableStrings.filter(s => s.id !== id);
        broadcastEvent('resourceChange', { resourceType: 'reusable_string', eventType: 'delete', data: { id } });

        // Also remove this string from any generation configs that use it
        for (const config of state.generationConfigs) {
            const initialLength = config.promptStrings.length;
            config.promptStrings = config.promptStrings.filter(ps => ps.stringId !== id);
            if (config.promptStrings.length < initialLength) {
                // If we removed something, save the config and broadcast the change
                await fs.writeFile(path.join(GENERATION_CONFIGS_DIR, `${config.id}.json`), JSON.stringify(config, null, 2));
                broadcastEvent('resourceChange', { resourceType: 'generation_config', eventType: 'update', data: config });
            }
        }
        res.status(204).send();
    });
    
    // Prompting API
    function sendSse(res, event, data) {
        
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    async function getResolvedChatContext(chat) {
        const resolvedChars = [];
        for (const p of chat.participants) {
            if (typeof p === 'string') {
                const char = state.characters.find(c => c.id === p);
                if (char) resolvedChars.push(char);
            } else if (typeof p === 'object' && p.id && p.name) {
                resolvedChars.push(new Character(p));
            }
        }

        const resolvedScenarios = [];
        for (const s of chat.scenarios) {
            if (typeof s === 'string') {
                const scenario = state.scenarios.find(sc => sc.id === s);
                if (scenario) resolvedScenarios.push(scenario);
            } else if (typeof s === 'object' && s.id && s.name) {
                resolvedScenarios.push(new Scenario(s));
            }
        }
        return { characters: resolvedChars, scenarios: resolvedScenarios };
    }

    async function processPrompt(chatId, userMessageContent = null, isRegen = false, messageIdToRegen = null, historyOverride = null, signal = null) {
        // 1. Get Active Connection and Adapter
        const { activeConnectionConfigId, userPersonaCharacterId, activeGenerationConfigId } = state.settings;
        if (!activeConnectionConfigId) throw new Error('No active connection configuration set.');
        
        const config = state.connectionConfigs.find(c => c.id === activeConnectionConfigId);
        if (!config) throw new Error(`Active connection config (ID: ${activeConnectionConfigId}) not found.`);
        
        const AdapterClass = ADAPTERS[config.adapter];
        if (!AdapterClass) throw new Error(`Unsupported adapter type: ${config.adapter}`);
        const adapter = new AdapterClass(config);

        // 2. Prepare Prompt Data
        const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
        const chat = new Chat(JSON.parse(await fs.readFile(chatPath, 'utf-8')));

        const { characters: chatCharacters, scenarios: activeScenarios } = await getResolvedChatContext(chat);

        // Use the history override if provided, otherwise use the chat's actual messages.
        let historyForPrompt = historyOverride ? [...historyOverride] : [...chat.messages];
        let userMessageToAppend = null;
        
        if (isRegen) {
            const regenIndex = historyForPrompt.findIndex(m => m.id === messageIdToRegen);
            if (regenIndex === -1) throw new Error('Message to regenerate not found.');
            if (historyForPrompt[regenIndex].role !== 'assistant') throw new Error('Can only regenerate an assistant message.');
            historyForPrompt = historyForPrompt.slice(0, regenIndex);
        } else if (userMessageContent !== null) {
            userMessageToAppend = { 
                role: 'user', 
                content: userMessageContent,
                characterId: userPersonaCharacterId // Add the author ID
            };
        }
        
        const macroContext = { 
            allCharacters: state.characters, 
            userPersonaCharacterId, 
            chatCharacters,
            activeScenarios
        };

        // 3. Assemble Prompt from Generation Config
        let finalMessageList = [];
        let systemParts = [];
        let generationParameters = {};
        
        const genConfig = activeGenerationConfigId ? state.generationConfigs.find(c => c.id === activeGenerationConfigId) : null;

        if (chat.systemInstruction) {
            systemParts.push(resolveMacros(chat.systemInstruction, macroContext));
        }

        if (genConfig) {
            if (genConfig.parameters && genConfig.parameters[config.adapter]) {
                generationParameters = genConfig.parameters[config.adapter];
            }
            
            // NEW PROMPT ASSEMBLY LOGIC

            // 1. Build a flat list of all message parts, including chat history where the placeholder is.
            let fullPromptSequence = [];
            const hasHistoryPlaceholder = genConfig.promptStrings.some(ps => ps.stringId === CHAT_HISTORY_STRING.id);

            for (const ps of genConfig.promptStrings) {
                if (ps.stringId === CHAT_HISTORY_STRING.id) {
                    fullPromptSequence.push(...historyForPrompt);
                    if (userMessageToAppend) {
                        fullPromptSequence.push(userMessageToAppend);
                    }
                } else if (ps.stringId === SCENARIO_STRING.id) {
                    if (activeScenarios.length > 0) {
                        const scenarioContent = activeScenarios.map(s => {
                            if (!s.description?.trim()) return null;
                            const describesAttr = s.describes ? ` describes="${escapeXML(s.describes)}"` : '';
                            return `<scenario${describesAttr}>${escapeXML(s.description)}</scenario>`;
                        }).filter(Boolean).join('\n\n');
                        if (scenarioContent) {
                            fullPromptSequence.push({ role: ps.role, content: scenarioContent });
                        }
                    }
                } else {
                    const reusableString = state.reusableStrings.find(s => s.id === ps.stringId);
                    if (reusableString) {
                        const resolvedContent = resolveMacros(reusableString.data, macroContext);
                        if (resolvedContent) {
                            fullPromptSequence.push({ role: ps.role, content: resolvedContent });
                        }
                    }
                }
            }
            
            // Fallback: If no history placeholder was in the sequence, append history and user message at the end.
            if (!hasHistoryPlaceholder) {
                fullPromptSequence.push(...historyForPrompt);
                if (userMessageToAppend) {
                    fullPromptSequence.push(userMessageToAppend);
                }
            }

            // 2. Separate system messages and prepare the main message list.
            for (const msg of fullPromptSequence) {
                if (msg.role === 'system') {
                    systemParts.push(msg.content);
                } else {
                    finalMessageList.push({ ...msg }); // Add non-system messages
                }
            }
            
            // 3. Merge consecutive messages in the final list if the flag is set.
            if (genConfig.mergeConsecutiveStrings && finalMessageList.length > 1) {
                const mergedList = [];
                if (finalMessageList.length > 0) {
                    let currentGroup = { ...finalMessageList[0] };
    
                    for (let i = 1; i < finalMessageList.length; i++) {
                        const nextMsg = finalMessageList[i];
                        if (nextMsg.role === currentGroup.role) {
                            currentGroup.content += '\n\n' + nextMsg.content;
                        } else {
                            mergedList.push(currentGroup);
                            currentGroup = { ...nextMsg };
                        }
                    }
                    mergedList.push(currentGroup); // Add the last group
                    finalMessageList = mergedList;
                }
            }

        } else {
             // Default behavior if no generation config is active
             finalMessageList.push(...historyForPrompt);
             if (userMessageToAppend) {
                finalMessageList.push(userMessageToAppend);
            }
        }

        const resolvedSystemInstruction = systemParts.join('\n\n');
        // save final prompt message to temp file for debugging
        const TEMP_DIR = path.join(__dirname, 'temp');
        await fs.mkdir(TEMP_DIR, { recursive: true });
        const tempPromptPath = path.join(TEMP_DIR, `prompt-${chatId}-${Date.now()}.json`);
        await fs.writeFile(tempPromptPath, JSON.stringify({system: resolvedSystemInstruction, messages: finalMessageList}, null, 2));
        console.log('Final prompt messages:', resolvedSystemInstruction, finalMessageList);

        // 5. Stream response from adapter
        const stream = adapter.prompt(finalMessageList, {
            systemInstruction: resolvedSystemInstruction,
            signal,
            ...generationParameters,
        });

        return { stream, chat, userMessageToAppend, historyForPrompt, isRegen, messageIdToRegen };
    }

    app.post('/api/chats/:id/regenerate', async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const abortController = new AbortController();

        
        try {
            const { id: chatId } = req.params;
            const { messageId, history } = req.body;
            if (!messageId) throw new Error('messageId for regeneration is required.');

            const { stream, chat } = await processPrompt(chatId, null, true, messageId, history, abortController.signal);

            let newContent = '';
            for await (const token of stream) {
                newContent += token;
                sendSse(res, 'token', { token });
            }

            const regenIndex = chat.messages.findIndex(m => m.id === messageId);
            if (regenIndex === -1) {
                throw new Error(`Message with ID "${messageId}" not found in chat "${chat.id}" for regeneration.`);
            }
            
            // Update the existing message object instead of replacing it.
            // This preserves the message ID, simplifying client-side logic.
            const messageToUpdate = chat.messages[regenIndex];
            messageToUpdate.content = newContent;
            messageToUpdate.timestamp = new Date().toISOString();

            chat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: chat });
            sendSse(res, 'done', { messageId: messageToUpdate.id });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`Regeneration for chat ${req.params.id} was aborted by the client.`);
            } else {
                console.error('Error during regeneration:', error);
                sendSse(res, 'error', { message: error.message });
            }
        } finally {
            res.end();
        }
    });

    app.post('/api/chats/:id/resend', async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const abortController = new AbortController();

        try {
            const { id: chatId } = req.params;
            const { history } = req.body;
            const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
            const existingChat = new Chat(JSON.parse(await fs.readFile(chatPath, 'utf-8')));

            if (!history && (existingChat.messages.length === 0 || existingChat.messages.at(-1).role !== 'user')) {
                throw new Error('Cannot resend: the last message is not from the user.');
            }
            
            // This is equivalent to a normal prompt but without a *new* user message.
            const { stream, chat } = await processPrompt(chatId, null, false, null, history, abortController.signal);

            const assistantMessage = { role: 'assistant', content: '', id: uuidv4(), timestamp: new Date().toISOString() };
            for await (const token of stream) {
                assistantMessage.content += token;
                sendSse(res, 'token', { token });
            }

            chat.messages.push(assistantMessage);
            chat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(chat, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: chat });
            sendSse(res, 'done', { messageId: assistantMessage.id });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`Resend for chat ${req.params.id} was aborted by the client.`);
            } else {
                console.error('Error during resend:', error);
                sendSse(res, 'error', { message: error.message });
            }
        } finally {
            res.end();
        }
    });

    app.post('/api/chats/:id/prompt', async (req, res) => {
        console.log(`[${new Date().toISOString()}] Processing prompt for chat ${req.params.id}`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const abortController = new AbortController();

        try {
            const { id: chatId } = req.params;
            const { message, history } = req.body;

            const { stream, chat, userMessageToAppend } = await processPrompt(chatId, message, false, null, history, abortController.signal);

            const assistantMessage = { role: 'assistant', content: '', id: uuidv4(), timestamp: new Date().toISOString() };
            for await (const token of stream) {
                assistantMessage.content += token;
                sendSse(res, 'token', { token });
            }
            
            if (userMessageToAppend) chat.addMessage(userMessageToAppend);
            chat.addMessage(assistantMessage);
            chat.lastModifiedAt = new Date().toISOString();

            if (chat.name.startsWith('[Branch from') && userMessageToAppend?.content) {
                const newName = `"${userMessageToAppend.content.substring(0, 30).trim()}..."`;
                chat.name = newName;
            }

            await fs.writeFile(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: chat });
            sendSse(res, 'done', { messageId: chat.messages.at(-1).id });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`Prompt for chat ${req.params.id} was aborted by the client.`);
            } else {
                console.error('Error during prompt:', error);
                sendSse(res, 'error', { message: error.message });
            }
        } finally {
            res.end();
        }
    });
}

// Helper Functions for Data Handling
async function loadSingleCharacter(id) {
    const charDirPath = path.join(CHARACTERS_DIR, id);
    try {
        const charData = JSON.parse(await fs.readFile(path.join(charDirPath, 'character.json'), 'utf-8'));
        charData.id = id;
        const avatarFiles = await glob(path.join(charDirPath, 'avatar.*').replace(/\\/g, '/'));
        if (avatarFiles.length > 0) {
            charData.avatarUrl = `/${path.relative(process.cwd(), avatarFiles[0]).replace(/\\/g, '/')}?t=${Date.now()}`;
        }
        if (charData.gallery && Array.isArray(charData.gallery)) {
            charData.gallery = charData.gallery.map(item => ({
                ...item,
                url: `/data/characters/${id}/images/${item.src}?t=${Date.now()}`
            }));
        }
        return new Character(charData);
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`Failed to load single character ${id}:`, e);
        return null;
    }
}

async function updateCharacterIdReferences(oldId, newId) {
    // 1. Update settings
    if (state.settings.userPersonaCharacterId === oldId) {
        state.settings.userPersonaCharacterId = newId;
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(state.settings, null, 2));
        broadcastEvent('resourceChange', { resourceType: 'setting', eventType: 'update', data: state.settings });
    }

    // 2. Update chats
    const chatFiles = await glob(path.join(CHATS_DIR, '*.json').replace(/\\/g, '/'));
    for (const chatFile of chatFiles) {
        try {
            const chatData = JSON.parse(await fs.readFile(chatFile, 'utf-8'));
            let chatModified = false;
            // Update participants that are references
            chatData.participants = chatData.participants.map(p => {
                if (typeof p === 'string' && p === oldId) {
                    chatModified = true;
                    return newId;
                }
                return p;
            });
            if (chatModified) {
                await fs.writeFile(chatFile, JSON.stringify(chatData, null, 2));
                const chatInState = state.chats.find(c => c.id === chatData.id);
                if (chatInState) chatInState.participants = chatData.participants;
            }
        } catch (e) {
            console.error(`Failed to update character ID in chat file ${chatFile}:`, e);
        }
    }
    
    // 3. Update scenarios
    const scenarioFiles = await glob(path.join(SCENARIOS_DIR, '*.json').replace(/\\/g, '/'));
    for (const scenarioFile of scenarioFiles) {
        try {
            const scenarioData = JSON.parse(await fs.readFile(scenarioFile, 'utf-8'));
            if (scenarioData.characterOverrides && scenarioData.characterOverrides[oldId]) {
                scenarioData.characterOverrides[newId] = scenarioData.characterOverrides[oldId];
                delete scenarioData.characterOverrides[oldId];
                await fs.writeFile(scenarioFile, JSON.stringify(scenarioData, null, 2));
                const scenarioInState = state.scenarios.find(s => s.id === scenarioData.id);
                if (scenarioInState) scenarioInState.characterOverrides = scenarioData.characterOverrides;
            }
        } catch (e) {
            console.error(`Failed to update character ID in scenario file ${scenarioFile}:`, e);
        }
    }
}

// Data Models
class Character {
    id = uuidv4();
    name = '';
    description = '';
    avatarUrl = null;
    gallery = [];
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Character',
            description: '',
            avatarUrl: null,
            gallery: [],
            _rev: CURRENT_REV
        }, data);
    }
    
    /**
     * Creates a plain object suitable for saving to a character.json file.
     * This omits runtime data like `id` (which is derived from the folder name)
     * and full `avatarUrl`.
     * @returns {object}
     */
    toSaveObject() {
        return {
            _rev: this._rev,
            name: this.name,
            description: this.description,
            // Strip the full URLs from gallery items before saving to JSON
            gallery: this.gallery.map(({ url, ...rest }) => rest),
        };
    }
}

class Chat {
    id = uuidv4();
    name = 'New Chat';
    messages = [];
    participants = []; // Array of string (ID) or object (embedded character)
    scenarios = []; // Array of string (ID) or object (embedded scenario)
    parentId = null;
    childChatIds = [];
    createdAt = new Date().toISOString();
    lastModifiedAt = new Date().toISOString();
    systemInstruction = '';
    _rev = CURRENT_REV;

    constructor(data = {}) {
        const now = new Date().toISOString();
        const defaults = {
            id: uuidv4(),
            name: 'New Chat',
            messages: [],
            participants: [],
            scenarios: [],
            parentId: null,
            childChatIds: [],
            createdAt: now,
            lastModifiedAt: now,
            systemInstruction: '',
            _rev: CURRENT_REV,
        };
        Object.assign(this, defaults, data);
    }

    addMessage(msg) { this.messages.push({ id: uuidv4(), timestamp: new Date().toISOString(), ...msg }); }
    
    getSummary() {
        const lastMessage = this.messages.at(-1);
        let snippet = '';

        if (lastMessage) {
            // Take the first line of the content, up to 100 chars.
            snippet = lastMessage.content.split('\n')[0].substring(0, 100);

            // Provide a more descriptive snippet for special adventure mode choices.
            if (lastMessage.content.startsWith('<choice>')) {
                snippet = `Player chose: ${lastMessage.content.slice(8, -9)}`;
            }
        }
        
        return { 
            id: this.id, 
            name: this.name, 
            avatarUrl: 'assets/images/default_avatar.svg', 
            createdAt: this.createdAt, 
            lastModifiedAt: this.lastModifiedAt,
            parentId: this.parentId, 
            childChatIds: this.childChatIds,
            lastMessageSnippet: snippet,
        }; 
    }
}

class ConnectionConfig {
    id = uuidv4();
    name = 'New Config';
    adapter = 'v1'; // 'v1' or 'gemini'
    url = '';
    apiKey = '';
    _rev = CURRENT_REV;

    constructor(data = {}) { 
        Object.assign(this, { 
            id: uuidv4(), 
            name: 'New Config', 
            adapter: 'v1', 
            url: '', 
            apiKey: '',
            _rev: CURRENT_REV,
        }, data); 
    }
    toJSON() { return { id: this.id, name: this.name, adapter: this.adapter, url: this.url, apiKey: this.apiKey, _rev: this._rev }; }
}

class ReusableString {
    id = uuidv4();
    name = 'Untitled String';
    data = '';
    _rev = CURRENT_REV;

    constructor({ id = uuidv4(), name = 'Untitled String', data = '', _rev = CURRENT_REV }) {
        this.id = id;
        this.name = name;
        this.data = data;
        this._rev = _rev;
    }
}

// System-Defined Constants
const CHAT_HISTORY_STRING = new ReusableString({
    id: 'system-chat-history',
    name: 'Chat History',
    data: '[This will be replaced by the chat conversation history]',
    _rev: 1, // System strings should be pinned to a revision
});

const SCENARIO_STRING = new ReusableString({
    id: 'system-scenario',
    name: 'Scenario',
    data: '[This will be replaced by the active scenarios content]',
    _rev: 1,
});

class Scenario {
    id = uuidv4();
    name = 'New Scenario';
    describes = '';
    description = ''; // General scenario text
    characterOverrides = {}; // { [characterId]: "character-specific text" }
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Scenario',
            describes: '',
            description: '',
            characterOverrides: {},
            _rev: CURRENT_REV
        }, data);
    }
}

class GenerationConfig {
    id = uuidv4();
    name = 'New Generation Config';
    promptStrings = []; // Array of { stringId: string, role: string }
    parameters = {}; // e.g. { v1: { temperature: 0.7 }, gemini: { temperature: 0.8 } }
    mergeConsecutiveStrings = false;
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Generation Config',
            promptStrings: [],
            parameters: {},
            mergeConsecutiveStrings: false,
            _rev: CURRENT_REV,
        }, data);
    }
}


main();