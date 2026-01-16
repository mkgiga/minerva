import express from 'express';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import multer from 'multer';
import { glob } from 'glob';
import { OpenAIV1Provider } from './server/providers/v1.js';
import { GoogleGeminiProvider } from './server/providers/gemini.js';
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
const SCENARIOS_DIR = path.join(DATA_DIR, 'scenarios');
const GENERATION_CONFIGS_DIR = path.join(DATA_DIR, 'generation_configs');
const CONNECTION_CONFIGS_DIR = path.join(DATA_DIR, 'connection_configs');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const NOTES_DIR = path.join(DATA_DIR, 'notes');
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

/** Maps provider id to their respective provider class. */
const PROVIDERS = {
    v1: OpenAIV1Provider,
    gemini: GoogleGeminiProvider,
};

// Helper to escape XML special characters to prevent XSS
function escapeXML(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
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

const createScenarioStorage = () => {
    return multer.diskStorage({
        destination: async (req, file, cb) => {
            const destDir = path.join(SCENARIOS_DIR, req.params.id);
            await fs.mkdir(destDir, { recursive: true });

            // req.body.type should be 'avatar' or 'banner'
            // IMPORTANT: Client must append 'type' to FormData BEFORE 'image' for this to work in diskStorage
            const type = req.body.type || 'avatar';

            try {
                // Remove old files of the same type (e.g. avatar.png, avatar.jpg)
                const oldFiles = await glob(path.join(destDir, `${type}.*`).replace(/\\/g, '/'));
                for (const old of oldFiles) await fs.unlink(old);
            } catch (err) { console.error(`Error removing old scenario ${type}:`, err); }

            cb(null, destDir);
        },
        filename: (req, file, cb) => {
            const extension = path.extname(file.originalname);
            const type = req.body.type || 'avatar';
            cb(null, `${type}${extension}`);
        }
    });
};

const avatarUpload = multer({ storage: createCharacterStorage('') });
const galleryUpload = multer({ storage: createCharacterStorage('images') });
const expressionUpload = multer({ storage: createCharacterStorage('expressions') });
const scenarioUpload = multer({ storage: createScenarioStorage() });

// Application state, loaded from filesystem
const state = {
    connectionConfigs: [],
    characters: [],
    scenarios: [],
    generationConfigs: [],
    chats: [],
    notes: [],
    settings: {},
};

async function main() {
    console.log('Starting Minerva server...');

    // Create data directories early so migrations can access them.
    await fs.mkdir(CHARACTERS_DIR, { recursive: true });
    await fs.mkdir(SCENARIOS_DIR, { recursive: true });
    await fs.mkdir(GENERATION_CONFIGS_DIR, { recursive: true });
    await fs.mkdir(CONNECTION_CONFIGS_DIR, { recursive: true });
    await fs.mkdir(CHATS_DIR, { recursive: true });
    await fs.mkdir(NOTES_DIR, { recursive: true });

    // Run migrations before loading any data.
    // await runMigrations({ CHARACTERS_DIR, GENERATION_CONFIGS_DIR, CONNECTION_CONFIGS_DIR, CHATS_DIR, SCENARIOS_DIR });

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
        state.scenarios = await loadScenarios();
        state.chats = (await loadJsonFilesFromDir(CHATS_DIR, Chat)).map(chatData => new Chat(chatData));
        state.notes = await loadJsonFilesFromDir(NOTES_DIR, Note);
        state.generationConfigs = await loadJsonFilesFromDir(GENERATION_CONFIGS_DIR, GenerationConfig);
        state.connectionConfigs = await loadJsonFilesFromDir(CONNECTION_CONFIGS_DIR, ConnectionConfig);

        console.log('Data loaded successfully.');
        console.log(`- ${state.characters.length} characters`);
        console.log(`- ${state.scenarios.length} scenarios`);
        console.log(`- ${state.chats.length} chats`);
        console.log(`- ${state.notes.length} notes`);
        console.log(`- ${state.connectionConfigs.length} connection configs`);
        console.log(`- ${state.generationConfigs.length} generation configs`);
        console.log(`- Active Connection ID: ${state.settings.activeConnectionConfigId || 'None'}`);
        console.log(`- Active Gen. Config ID: ${state.settings.activeGenerationConfigId || 'None'}`);
        console.log(`- User Persona ID: ${state.settings.userPersonaCharacterId || 'None'}`);

        // Check for legacy branches (have parentId but no branchPointMessageId)
        const legacyBranches = state.chats.filter(c => c.parentId && !c.branchPointMessageId);
        if (legacyBranches.length > 0) {
            console.log('');
            console.log('⚠️  WARNING: Found legacy branches without branchPointMessageId');
            console.log(`⚠️  ${legacyBranches.length} chat(s) will NOT inherit parent messages`);
            console.log('⚠️  These branches only have access to their own messages');
            console.log('⚠️  Consider re-creating these branches to restore full message history');
        }

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
                renderer: 'raw', // Default renderer
                curateResponse: false,
                curationConnectionConfigId: '', // Default: use main connection
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
                    renderer: 'raw',
                    curateResponse: false,
                    curationConnectionConfigId: '',
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

                // Load expressions and build full URLs
                if (charData.expressions && Array.isArray(charData.expressions)) {
                    charData.expressions = charData.expressions.map(item => ({
                        ...item,
                        url: `/data/characters/${charId}/expressions/${item.src}?t=${Date.now()}`
                    }));
                } else {
                    charData.expressions = [];
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

async function loadScenarios() {
    const scenarioFolders = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true });
    const scenarios = [];
    for (const dirent of scenarioFolders) {
        if (dirent.isDirectory()) {
            const id = dirent.name;
            const dirPath = path.join(SCENARIOS_DIR, id);
            const filePath = path.join(dirPath, 'scenario.json');
            try {
                const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                data.id = id;

                // Load avatar
                const avatarFiles = await glob(path.join(dirPath, 'avatar.*').replace(/\\/g, '/'));
                if (avatarFiles.length > 0) {
                    data.avatarUrl = `/${path.relative(process.cwd(), avatarFiles[0]).replace(/\\/g, '/')}?t=${Date.now()}`;
                } else {
                    data.avatarUrl = null;
                }

                // Load banner
                const bannerFiles = await glob(path.join(dirPath, 'banner.*').replace(/\\/g, '/'));
                if (bannerFiles.length > 0) {
                    data.bannerUrl = `/${path.relative(process.cwd(), bannerFiles[0]).replace(/\\/g, '/')}?t=${Date.now()}`;
                } else {
                    data.bannerUrl = null;
                }

                scenarios.push(new Scenario(data));
            } catch (err) {
                if (err.code !== 'ENOENT') console.error(`Error loading scenario ${id}:`, err);
            }
        }
    }
    return scenarios;
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
    const { allCharacters = [], userPersonaCharacterId = null, chatCharacters = [], activeNotes = [] } = context;

    // Helper to get description with appended note info
    const getAugmentedDescription = (char) => {
        let desc = char.description || '';
        if (activeNotes && activeNotes.length > 0) {
            for (const note of activeNotes) {
                if (note.characterOverrides && note.characterOverrides[char.id]) {
                    const specificInfo = note.characterOverrides[char.id];
                    if (specificInfo && specificInfo.trim()) {
                        desc += `\n\n${specificInfo}`;
                    }
                }
            }
        }
        return desc;
    };

    // New complex macro handler: {{characters[name,description,...]}}
    text = text.replace(/{{\s*([a-zA-Z0-9_]+)\[(.*?)\]\s*}}/g, (match, resourceName, propsString) => {
        const props = propsString.split(',').map(p => p.trim().toLowerCase());

        if (resourceName.toLowerCase() === 'characters') {
            // Get the list of characters participating in the chat
            let charactersToRender = [...chatCharacters];

            // Check for 'player' or 'focus' attribute requests
            const includePlayer = props.includes('player') || props.includes('focus');

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
                // Updated: use 'focus' instead of 'is-player' for the new syntax
                const focusAttr = isPlayer ? ' focus="true"' : '';

                const characterLines = [];
                if (props.includes('name') && c.name) {
                    characterLines.push(`    <name>\n        ${escapeXML(c.name)}\n    </name>`);
                }

                // Use augmented description
                if (props.includes('description')) {
                    const desc = getAugmentedDescription(c);
                    if (desc) {
                        characterLines.push(`    <description>\n        ${escapeXML(desc)}\n    </description>`);
                    }
                }

                if (props.includes('expressions') && c.expressions && c.expressions.length > 0) {
                    const expressionLines = c.expressions.map(expr => {
                        return `        <expression name="${escapeXML(expr.name)}">${escapeXML(expr.src)}</expression>`;
                    });
                    if (expressionLines.length > 0) {
                        characterLines.push(`    <expressions>\n${expressionLines.join('\n')}\n    </expressions>`);
                    }
                }
                if (props.includes('images') && c.gallery && c.gallery.length > 0) {
                    const imageLines = c.gallery.map(img => {
                        return `        <image>\n            <src>${escapeXML(img.src)}</src>\n            <alt>${escapeXML(img.alt || '')}</alt>\n        </image>`;
                    });
                    if (imageLines.length > 0) {
                        characterLines.push(`    <images>\n${imageLines.join('\n')}\n    </images>`);
                    }
                }
                if (props.includes('avatar') && c.avatarUrl) {
                    // Extract filename from URL for simple reference, or pass full relative path?
                    // Usually macro just needs filename if system knows path, or full path.
                    // For now, let's pass the basename if it's a local file.
                    const avatarFilename = path.basename(c.avatarUrl.split('?')[0]);
                    characterLines.push(`    <avatar>${escapeXML(avatarFilename)}</avatar>`);
                }

                // Removed legacy 'note' prop handling for character overrides since it's now part of description

                if (characterLines.length > 0) {
                    // Updated: use <entity> instead of <character>
                    return `<entity id="${escapeXML(c.id)}"${focusAttr}>\n${characterLines.join('\n')}\n</entity>`;
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
                const desc = getAugmentedDescription(c);
                return `${c.name} (ID: ${c.id})\n${desc}`;
            }).join('\n\n\n\n');
        },
        notes: () => {
            if (!activeNotes || activeNotes.length === 0) return '';

            return activeNotes.map(s => {
                if (!s.description?.trim()) return null;
                const describesAttr = s.describes ? ` type="${escapeXML(s.describes)}"` : '';
                return `<context${describesAttr}>${escapeXML(s.description)}</context>`;
            }).filter(Boolean).join('\n\n');
        },
        player: () => {
            if (!playerCharacter) return '';
            const desc = getAugmentedDescription(playerCharacter);
            return `${playerCharacter.name}\n${desc}`;
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

/**
 * If curation is enabled, collects the initial stream and passes it through a second
 * curation prompt. Otherwise, returns the initial stream.
 * @param {AsyncGenerator<string>} initialStream The first response stream from the provider.
 * @param {BaseProvider} defaultProvider The provider instance used for the main prompt.
 * @param {object} generationParameters The generation parameters used for the main prompt.
 * @param {AbortSignal} signal The AbortSignal to cancel the process.
 * @returns {AsyncGenerator<string>} The final stream to be sent to the client.
 */
async function getFinalStream(initialStream, defaultProvider, generationParameters, signal) {
    if (!state.settings.chat?.curateResponse) {
        return initialStream;
    }

    console.log('Curating response...');
    let initialResponseContent = '';
    for await (const token of initialStream) {
        initialResponseContent += token;
    }
    console.log('Initial response collected, length:', initialResponseContent.length);

    if (signal.aborted) {
        throw new Error('AbortError');
    }

    if (!initialResponseContent.trim()) {
        console.log('Initial response was empty, skipping curation.');
        async function* emptyStream() { /* Yields nothing */ }
        return emptyStream();
    }

    // Determine which provider to use for curation
    let curationProvider = defaultProvider;
    let curationGenParams = { ...generationParameters };
    const curationConfigId = state.settings.chat?.curationConnectionConfigId;

    if (curationConfigId) {
        const config = state.connectionConfigs.find(c => c.id === curationConfigId);
        if (config) {
            const ProviderClass = PROVIDERS[config.provider];
            if (ProviderClass) {
                // If providers are different (or simply to isolate instances), create new provider
                if (config.provider !== defaultProvider.config.provider || config.id !== defaultProvider.config.id) {
                    console.log(`Using separate provider for curation: ${config.name} (${config.provider})`);
                    curationProvider = new ProviderClass(config);

                    // Since we switched providers, we must update generation parameters
                    // because params for Gemini (e.g. topK) might break OpenAI provider and vice versa.
                    // We attempt to find matching parameters in the *active* generation config.
                    const { activeGenerationConfigId } = state.settings;
                    if (activeGenerationConfigId) {
                        const genConfig = state.generationConfigs.find(c => c.id === activeGenerationConfigId);
                        if (genConfig && genConfig.parameters && genConfig.parameters[config.provider]) {
                            curationGenParams = genConfig.parameters[config.provider];
                        } else {
                            curationGenParams = {}; // Default if no specific params found for this provider
                        }
                    } else {
                        curationGenParams = {};
                    }
                }
            } else {
                console.warn(`Unsupported curation provider type: ${config.provider}, falling back to default.`);
            }
        } else {
            console.warn(`Curation config ID ${curationConfigId} not found, falling back to default.`);
        }
    }

    const curationSystemPrompt = await fs.readFile(path.join(__dirname, 'server/utils/prompts/curate.md'), 'utf-8');
    const curationMessages = [{ role: 'user', content: initialResponseContent }];

    const finalStream = curationProvider.prompt(curationMessages, {
        systemInstruction: curationSystemPrompt,
        signal,
        ...curationGenParams,
    }, true);

    console.log('Curation prompt sent. Awaiting curated stream.');
    return finalStream;
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

    // NEW: Duplicate Character Endpoint
    app.post('/api/characters/:id/duplicate', async (req, res) => {
        try {
            const { id } = req.params;
            const originalChar = state.characters.find(c => c.id === id);
            if (!originalChar) return res.status(404).json({ message: 'Character not found' });

            const sourceDir = path.join(CHARACTERS_DIR, id);

            // Create new character object with modified name
            const newCharData = originalChar.toSaveObject();
            newCharData.name = `${originalChar.name} (Copy)`;
            const newChar = new Character(newCharData); // Generates new UUID

            const destDir = path.join(CHARACTERS_DIR, newChar.id);

            // Check if source directory exists
            try {
                await fs.access(sourceDir);
                // Copy directory (recursive) including assets
                // fs.cp is available in Node.js v16.7.0+
                await fs.cp(sourceDir, destDir, { recursive: true });
            } catch (err) {
                // If source dir doesn't exist, just create the new dir
                if (err.code === 'ENOENT') {
                    await fs.mkdir(destDir, { recursive: true });
                } else {
                    throw err;
                }
            }

            // Overwrite character.json with updated name and revision
            await fs.writeFile(path.join(destDir, 'character.json'), JSON.stringify(newChar.toSaveObject(), null, 2));

            // Reload single character to resolve asset URLs correctly
            const loadedChar = await loadSingleCharacter(newChar.id);

            if (loadedChar) {
                state.characters.push(loadedChar);
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'create', data: loadedChar });
                res.status(201).json(loadedChar);
            } else {
                throw new Error('Failed to load duplicated character');
            }

        } catch (error) {
            console.error('Failed to duplicate character:', error);
            res.status(500).json({ message: 'Failed to duplicate character' });
        }
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

    // Expression Endpoints
    app.post('/api/characters/:id/expressions', expressionUpload.single('image'), async (req, res) => {
        try {
            const { id } = req.params;
            const { name } = req.body;
            if (!req.file) return res.status(400).json({ message: 'No image file provided.' });
            if (!name) return res.status(400).json({ message: 'Expression name is required.' });

            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found' });

            const newExpressionItem = { src: req.file.filename, name };
            character.expressions.push(newExpressionItem);

            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));

            const updatedCharacter = await loadSingleCharacter(id);
            if (updatedCharacter) {
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                res.status(201).json(updatedCharacter);
            } else {
                res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            console.error('Error adding expression image:', error);
            res.status(500).json({ message: 'Failed to add expression.' });
        }
    });

    app.put('/api/characters/:id/expressions/:filename', async (req, res) => {
        try {
            const { id, filename } = req.params;
            const { name } = req.body;
            if (!name) return res.status(400).json({ message: 'Expression name is required.' });

            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found.' });

            const expressionItem = character.expressions.find(item => item.src === filename);
            if (!expressionItem) return res.status(404).json({ message: 'Expression not found.' });

            expressionItem.name = name;
            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));

            const updatedCharacter = await loadSingleCharacter(id);
            if (updatedCharacter) {
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                res.json(updatedCharacter);
            } else {
                res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Failed to update expression.' });
        }
    });

    app.delete('/api/characters/:id/expressions/:filename', async (req, res) => {
        try {
            const { id, filename } = req.params;
            const character = state.characters.find(c => c.id === id);
            if (!character) return res.status(404).json({ message: 'Character not found.' });

            const imagePath = path.join(CHARACTERS_DIR, id, 'expressions', filename);
            await fs.unlink(imagePath).catch(err => console.warn(`Could not delete file ${imagePath}: ${err.message}`));

            character.expressions = character.expressions.filter(item => item.src !== filename);
            await fs.writeFile(path.join(CHARACTERS_DIR, id, 'character.json'), JSON.stringify(character.toSaveObject(), null, 2));

            const updatedCharacter = await loadSingleCharacter(id);
            if (updatedCharacter) {
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
                broadcastEvent('resourceChange', { resourceType: 'character', eventType: 'update', data: updatedCharacter });
                res.status(204).send();
            } else {
                res.status(404).json({ message: 'Character not found after update.' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Failed to delete expression.' });
        }
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
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
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
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
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
                const charIndex = state.characters.findIndex(c => c.id === id);
                if (charIndex !== -1) state.characters[charIndex] = updatedCharacter;
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
    app.get('/api/scenarios', async (req, res) => {
        try {
            state.scenarios = await loadScenarios();
            res.json(state.scenarios);
        } catch (error) { res.status(500).json({ message: 'Failed to retrieve scenarios' }); }
    });

    app.post('/api/scenarios', async (req, res) => {
        try {
            const newScenario = new Scenario(req.body);
            const dir = path.join(SCENARIOS_DIR, newScenario.id);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, 'scenario.json'), JSON.stringify(newScenario, null, 2));
            state.scenarios.push(newScenario);
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'create', data: newScenario });
            res.status(201).json(newScenario);
        } catch (error) { res.status(500).json({ message: 'Failed to create scenario' }); }
    });

    app.put('/api/scenarios/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const scenario = state.scenarios.find(s => s.id === id);
            if (!scenario) return res.status(404).json({ message: 'Scenario not found' });

            Object.assign(scenario, req.body);
            await fs.writeFile(path.join(SCENARIOS_DIR, id, 'scenario.json'), JSON.stringify(scenario, null, 2));
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'update', data: scenario });
            res.json(scenario);
        } catch (error) { res.status(500).json({ message: 'Failed to update scenario' }); }
    });

    app.delete('/api/scenarios/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!state.scenarios.some(s => s.id === id)) return res.status(404).json({ message: 'Scenario not found' });
            await fs.rm(path.join(SCENARIOS_DIR, id), { recursive: true, force: true });
            state.scenarios = state.scenarios.filter(s => s.id !== id);
            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'delete', data: { id } });
            res.status(204).send();
        } catch (error) { res.status(500).json({ message: 'Failed to delete scenario' }); }
    });

    app.post('/api/scenarios/:id/image', scenarioUpload.single('image'), async (req, res) => {
        try {
            const { id } = req.params;
            const type = req.body.type || 'avatar'; // 'avatar' or 'banner'
            if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

            const scenario = state.scenarios.find(s => s.id === id);
            if (!scenario) return res.status(404).json({ message: 'Scenario not found.' });

            const url = `/${path.relative(process.cwd(), req.file.path).replace(/\\/g, '/')}?t=${Date.now()}`;
            if (type === 'banner') scenario.bannerUrl = url;
            else scenario.avatarUrl = url;

            broadcastEvent('resourceChange', { resourceType: 'scenario', eventType: 'update', data: scenario });
            res.json(scenario);
        } catch (error) {
            console.error('Error uploading scenario image:', error);
            res.status(500).json({ message: 'Failed to upload image' });
        }
    });

    // Notes API
    app.get('/api/notes', (req, res) => res.json(state.notes));
    app.post('/api/notes', async (req, res) => {
        try {
            const note = new Note(req.body);
            await fs.writeFile(path.join(NOTES_DIR, `${note.id}.json`), JSON.stringify(note, null, 2));
            state.notes.push(note);
            broadcastEvent('resourceChange', { resourceType: 'note', eventType: 'create', data: note });
            res.status(201).json(note);
        } catch (e) { res.status(500).json({ message: 'Failed to create note.' }); }
    });
    app.put('/api/notes/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const index = state.notes.findIndex(s => s.id === id);
            if (index === -1) return res.status(404).json({ message: 'Note not found.' });
            const updatedNote = new Note({ ...req.body, id });
            await fs.writeFile(path.join(NOTES_DIR, `${id}.json`), JSON.stringify(updatedNote, null, 2));
            state.notes[index] = updatedNote;
            broadcastEvent('resourceChange', { resourceType: 'note', eventType: 'update', data: updatedNote });
            res.json(updatedNote);
        } catch (e) { res.status(500).json({ message: 'Failed to update note.' }); }
    });
    app.delete('/api/notes/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!state.notes.some(s => s.id === id)) return res.status(404).json({ message: 'Note not found.' });

            await fs.unlink(path.join(NOTES_DIR, `${id}.json`));
            state.notes = state.notes.filter(s => s.id !== id);
            broadcastEvent('resourceChange', { resourceType: 'note', eventType: 'delete', data: { id } });

            // Also remove this note from any chats that use it
            const allChats = await loadJsonFilesFromDir(CHATS_DIR, Chat);
            for (const chat of allChats) {
                const initialLength = chat.notes.length;
                chat.notes = chat.notes.filter(s => (typeof s === 'string' ? s : s.id) !== id);

                if (chat.notes.length < initialLength) {
                    await fs.writeFile(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));

                    // Build full chat with parent messages for client
                    const fullChat = await buildFullChatForClient(chat);
                    broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });
                }
            }
            res.status(204).send();
        } catch (e) { res.status(500).json({ message: 'Failed to delete note.' }); }
    });

    /**
     * Recursively collects messages from the parent chain up to the branch point.
     * This allows branch chats to access their full history without duplicating messages on disk.
     *
     * @param {string} chatId - The ID of the chat to collect parent messages for
     * @param {string|null} branchPointMessageId - Stop collecting when we reach this message ID
     * @returns {Promise<Array>} Array of messages from parent chain, ordered chronologically
     */
    async function collectParentMessages(chatId, branchPointMessageId = null, depth = 0, visitedChatIds = new Set(), overridesChain = []) {
        const MAX_RECURSION_DEPTH = 100; // Prevent excessive recursion
        const MAX_TOTAL_MESSAGES = 10000; // Prevent collecting too many messages

        // Safeguard: Check recursion depth
        if (depth > MAX_RECURSION_DEPTH) {
            const msg = `Branch hierarchy too deep (${MAX_RECURSION_DEPTH} levels). This chat may have a corrupted parent chain.`;
            console.warn(msg);
            broadcastEvent('notification', {
                type: 'warn',
                header: 'Branch Chain Warning',
                message: msg
            });
            return [];
        }

        // Safeguard: Check for circular references
        if (visitedChatIds.has(chatId)) {
            const msg = `Circular parent reference detected in chat branches. Parent chain is corrupted.`;
            console.error(msg);
            broadcastEvent('notification', {
                type: 'bad',
                header: 'Data Corruption',
                message: msg
            });
            return [];
        }
        visitedChatIds.add(chatId);

        const chatPath = path.join(CHATS_DIR, `${chatId}.json`);

        try {
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);

            let messages = [];

            // Collect message overrides from this chat
            if (chat.messageOverrides && Object.keys(chat.messageOverrides).length > 0) {
                overridesChain.push({ depth, overrides: chat.messageOverrides });
            }

            // If this chat has a parent AND a branch point, recursively collect parent messages
            if (chat.parentId && chat.branchPointMessageId) {
                const parentMessages = await collectParentMessages(chat.parentId, chat.branchPointMessageId, depth + 1, visitedChatIds, overridesChain);
                // Mark all parent messages as inherited (runtime-only flag, not saved to disk)
                messages.push(...parentMessages.map(msg => ({ ...msg, _isInherited: true })));

                // Safeguard: Check total message count
                if (messages.length > MAX_TOTAL_MESSAGES) {
                    const msg = `Branch contains over ${MAX_TOTAL_MESSAGES} messages. History truncated to prevent memory issues.`;
                    console.warn(msg);
                    broadcastEvent('notification', {
                        type: 'warn',
                        header: 'Large Branch Detected',
                        message: msg
                    });
                    return messages.slice(-MAX_TOTAL_MESSAGES);
                }
            }

            // Then add this chat's own messages
            if (branchPointMessageId) {
                // Find the index of the branch point message
                const branchIndex = chat.messages.findIndex(m => m.id === branchPointMessageId);
                if (branchIndex !== -1) {
                    // Include messages up to and including the branch point
                    // Mark them as inherited since they're being collected for a child chat
                    messages.push(...chat.messages.slice(0, branchIndex + 1).map(msg => ({ ...msg, _isInherited: true })));
                } else {
                    // Branch point not found in this chat, include all messages
                    console.warn(`Branch point message ${branchPointMessageId} not found in chat ${chatId}, including all ${chat.messages.length} messages`);
                    messages.push(...chat.messages.map(msg => ({ ...msg, _isInherited: true })));
                }
            } else {
                // No branch point specified, include all messages
                messages.push(...chat.messages.map(msg => ({ ...msg, _isInherited: true })));
            }

            // Apply content overrides from the descendant chain
            // Sort by depth descending (oldest/highest depth first) so younger overrides overwrite older ones
            if (overridesChain.length > 0 && depth === 0) {
                // Only apply overrides at the top level (depth 0) to avoid applying multiple times
                overridesChain.sort((a, b) => b.depth - a.depth);

                for (const { overrides } of overridesChain) {
                    for (const msg of messages) {
                        if (overrides[msg.id]) {
                            msg.content = overrides[msg.id].content || overrides[msg.id];
                            msg._isOverridden = true; // Mark for potential UI feedback
                        }
                    }
                }
            }

            return messages;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`Parent chat ${chatId} not found, stopping parent chain walk`);
                return [];
            }
            throw error;
        }
    }

    /**
     * Builds a complete chat object for sending to clients via SSE.
     * For branches, this includes the full message history from parent chain.
     * This ensures clients always receive complete data, preventing UI corruption.
     * Parent messages are marked with _isInherited flag to prevent them from being saved to disk.
     *
     * @param {Chat} chat - The chat object to prepare
     * @returns {Promise<Object>} Chat object with full message history
     */
    async function buildFullChatForClient(chat) {
        if (chat.parentId && chat.branchPointMessageId) {
            // New-style branch - include parent messages
            const parentMessages = await collectParentMessages(chat.parentId, chat.branchPointMessageId);
            // parentMessages are already marked as _isInherited by collectParentMessages
            let allMessages = [...parentMessages, ...chat.messages];

            // Apply this chat's own overrides to the combined message list
            // This chat is the youngest descendant (depth -1 conceptually), so its overrides have highest priority
            if (chat.messageOverrides && Object.keys(chat.messageOverrides).length > 0) {
                for (const msg of allMessages) {
                    if (chat.messageOverrides[msg.id]) {
                        msg.content = chat.messageOverrides[msg.id].content || chat.messageOverrides[msg.id];
                        msg._isOverridden = true;
                    }
                }
            }

            // Apply this chat's deletions - filter out inherited messages this branch considers "deleted"
            // This is the branch's opinion of history - sibling branches are not affected
            if (chat.deletedMessageIds && chat.deletedMessageIds.length > 0) {
                const deletedSet = new Set(chat.deletedMessageIds);
                allMessages = allMessages.filter(msg => !deletedSet.has(msg.id));
            }

            return { ...chat, messages: allMessages };
        }

        // Check if this is a LEGACY BRANCH (has parentId but missing branchPointMessageId)
        // Root chats (no parentId) should NOT trigger this warning
        if (chat.parentId && !chat.branchPointMessageId) {
            broadcastEvent('notification', {
                type: 'info',
                header: 'Legacy Branch Detected',
                message: `Chat "${chat.name}" is a legacy branch without a defined branch point. ` +
                    `Message history from parent may be incomplete. Consider re-creating this branch.`
            });
        }

        // Root chat or legacy branch - return as-is
        return chat;
    }

    // Chats API
    app.get('/api/chats', async (req, res) => {
        const chats = await loadJsonFilesFromDir(CHATS_DIR, Chat);
        // Ensure new Chat objects are instantiated to apply defaults
        res.json(chats.map(c => new Chat(c)).sort((a, b) => new Date(b.lastModifiedAt) - new Date(a.lastModifiedAt)).map(c => c.getSummary()));
    });
    app.post('/api/chats', async (req, res) => {
        const { firstMessage, ...chatData } = req.body;
        const newChat = new Chat(chatData);

        // Handle scenario-based initialization
        if (firstMessage) {
            newChat.addMessage({ role: 'assistant', content: firstMessage });
        }

        await fs.writeFile(path.join(CHATS_DIR, `${newChat.id}.json`), JSON.stringify(newChat, null, 2));
        state.chats.push(newChat);
        broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'create', data: newChat.getSummary() });
        res.status(201).json(newChat);
    });
    app.get('/api/chats/:id', async (req, res) => {
        const INITIAL_MESSAGE_LIMIT = 50;
        try {
            const chatPath = path.join(CHATS_DIR, `${req.params.id}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);

            // Build full chat with parent messages and overrides applied
            const fullChat = await buildFullChatForClient(chat);
            const fullMessages = fullChat.messages;

            const messageCount = fullMessages.length;
            const hasMoreMessages = messageCount > INITIAL_MESSAGE_LIMIT;

            // Slice messages to return only the last page for the initial load
            const paginatedMessages = fullMessages.slice(-INITIAL_MESSAGE_LIMIT);

            // Return chat with paginated messages
            res.json({ ...fullChat, messages: paginatedMessages, messageCount, hasMoreMessages });

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            console.error(`Error processing chat ${req.params.id}:`, e);
            res.status(500).json({ message: 'Failed to retrieve chat' });
        }
    });



    app.get('/api/chats/:id/messages', async (req, res) => {
        const { id } = req.params;
        const limit = parseInt(req.query.limit, 10) || 50;
        const beforeMessageId = req.query.before;

        if (!beforeMessageId) {
            return res.status(400).json({ message: 'A "before" message ID is required.' });
        }

        try {
            const chatPath = path.join(CHATS_DIR, `${id}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);

            // Build full chat with parent messages and overrides applied
            const fullChat = await buildFullChatForClient(chat);
            const allMessages = fullChat.messages;

            const beforeIndex = allMessages.findIndex(m => m.id === beforeMessageId);

            if (beforeIndex === -1) {
                return res.status(404).json({ message: 'The "before" message ID was not found.' });
            }

            const startIndex = Math.max(0, beforeIndex - limit);
            const messages = allMessages.slice(startIndex, beforeIndex);
            const hasMoreMessages = startIndex > 0;

            res.json({ messages, hasMoreMessages });

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            res.status(500).json({ message: 'Failed to retrieve messages' });
        }
    });

    app.put('/api/chats/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const chatPath = path.join(CHATS_DIR, `${id}.json`);
            const existingChatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));

            // ALLOWLIST APPROACH: Only accept specific fields the client legitimately controls
            // Server is the source of truth - never trust arbitrary client data
            const ALLOWED_FIELDS = ['name', 'participants', 'notes', 'messageOverrides', 'deletedMessageIds'];

            const incomingData = {};
            for (const field of ALLOWED_FIELDS) {
                if (req.body[field] !== undefined) {
                    incomingData[field] = req.body[field];
                }
            }

            // Special handling for messageOverrides - MERGE with existing (don't replace)
            if (incomingData.messageOverrides) {
                incomingData.messageOverrides = {
                    ...(existingChatData.messageOverrides || {}),
                    ...incomingData.messageOverrides
                };
            }

            // Special handling for deletedMessageIds - MERGE with existing (no duplicates)
            // This is a branch's opinion of which inherited messages are "deleted" from its view
            if (incomingData.deletedMessageIds) {
                const existingDeleted = new Set(existingChatData.deletedMessageIds || []);
                for (const msgId of incomingData.deletedMessageIds) {
                    existingDeleted.add(msgId);
                }
                incomingData.deletedMessageIds = [...existingDeleted];
            }

            // PROTECTED FIELDS: These should NEVER come from client
            const protectedFields = {
                messages: existingChatData.messages,
                parentId: existingChatData.parentId,
                branchPointMessageId: existingChatData.branchPointMessageId,
                childChatIds: existingChatData.childChatIds || [],
            };

            const updatedChat = new Chat({ ...existingChatData, ...incomingData, ...protectedFields, id });
            updatedChat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(updatedChat, null, 2));
            const index = state.chats.findIndex(c => c.id === id);
            if (index !== -1) state.chats[index] = updatedChat;
            else state.chats.push(updatedChat);

            // Broadcast changes for both the detailed chat and the summary list
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: updatedChat.getSummary() });
            // Build full chat with parent messages for client
            const fullChat = await buildFullChatForClient(updatedChat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });

            res.json(updatedChat);
        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            console.error(`[Chat PUT] Error updating chat ${id}:`, e);
            res.status(500).json({ message: 'Failed to update chat' });
        }
    });
    // Helper function to recursively collect all descendant chat IDs for cascade delete
    async function collectDescendantIds(chatId, visited = new Set()) {
        if (visited.has(chatId)) return []; // Circular reference protection
        visited.add(chatId);

        const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
        try {
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const descendants = [chatId];
            for (const childId of chatData.childChatIds || []) {
                descendants.push(...await collectDescendantIds(childId, visited));
            }
            return descendants;
        } catch (e) {
            // If we can't read the chat, just return its ID (it might not exist)
            return [chatId];
        }
    }

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

            // CASCADE DELETE: Delete this chat and ALL descendants
            // This prevents orphaned branches that lose their message history
            const allIdsToDelete = await collectDescendantIds(id);
            console.log(`[Delete] Deleting chat ${id} and ${allIdsToDelete.length - 1} descendant(s)`);

            for (const idToDelete of allIdsToDelete) {
                try {
                    await fs.unlink(path.join(CHATS_DIR, `${idToDelete}.json`));
                } catch (e) {
                    if (e.code !== 'ENOENT') console.error(`Error deleting chat file ${idToDelete}:`, e);
                }
                state.chats = state.chats.filter(c => c.id !== idToDelete);
                broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'delete', data: { id: idToDelete } });
            }

            res.status(204).send();
        } catch (e) { res.status(404).json({ message: 'Chat not found' }); }
    });

    // DELETE a message that belongs to THIS chat (not inherited)
    // For inherited messages, use PUT with deletedMessageIds instead
    app.delete('/api/chats/:chatId/messages/:messageId', async (req, res) => {
        const { chatId, messageId } = req.params;
        try {
            const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));

            // Only delete if message exists in this chat's OWN messages (not inherited)
            const msgIndex = chatData.messages.findIndex(m => m.id === messageId);
            if (msgIndex === -1) {
                return res.status(404).json({
                    message: 'Message not found in this chat. If this is an inherited message, use deletedMessageIds instead.'
                });
            }

            chatData.messages.splice(msgIndex, 1);
            chatData.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(chatData, null, 2));

            // Update in-memory state
            const index = state.chats.findIndex(c => c.id === chatId);
            if (index !== -1) state.chats[index] = new Chat(chatData);

            // Broadcast the change
            const updatedChat = new Chat(chatData);
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: updatedChat.getSummary() });
            const fullChat = await buildFullChatForClient(updatedChat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });

            res.status(204).send();
        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            console.error(`Error deleting message ${messageId} from chat ${chatId}:`, e);
            res.status(500).json({ message: 'Failed to delete message' });
        }
    });

    // PATCH (update) a message that belongs to THIS chat (not inherited)
    // For inherited messages, use PUT with messageOverrides instead
    app.patch('/api/chats/:chatId/messages/:messageId', async (req, res) => {
        const { chatId, messageId } = req.params;
        const { content } = req.body;

        if (content === undefined) {
            return res.status(400).json({ message: 'Content is required' });
        }

        try {
            const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));

            // Only update if message exists in this chat's OWN messages (not inherited)
            const msg = chatData.messages.find(m => m.id === messageId);
            if (!msg) {
                return res.status(404).json({
                    message: 'Message not found in this chat. If this is an inherited message, use messageOverrides instead.'
                });
            }

            msg.content = content;
            chatData.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(chatData, null, 2));

            // Update in-memory state
            const index = state.chats.findIndex(c => c.id === chatId);
            if (index !== -1) state.chats[index] = new Chat(chatData);

            // Broadcast the change
            const updatedChat = new Chat(chatData);
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: updatedChat.getSummary() });
            const fullChat = await buildFullChatForClient(updatedChat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });

            res.json({ id: messageId, content });
        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found' });
            console.error(`Error updating message ${messageId} in chat ${chatId}:`, e);
            res.status(500).json({ message: 'Failed to update message' });
        }
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

            // Verify the branch point message exists
            // We need to collect the full history to find the message (it might be in a parent)
            let fullMessages = [];
            if (originalChat.parentId && originalChat.branchPointMessageId) {
                // New-style branch - collect parent messages
                const parentMessages = await collectParentMessages(originalChat.parentId, originalChat.branchPointMessageId);
                fullMessages = [...parentMessages, ...originalChat.messages];
            } else {
                // Root chat or legacy branch - use own messages directly
                fullMessages = originalChat.messages;
            }

            const branchIndex = fullMessages.findIndex(m => m.id === messageId);
            if (branchIndex === -1) {
                return res.status(404).json({ message: 'Branch point message not found in chat.' });
            }

            // Create the new branched chat with NO messages initially
            // Messages will be loaded from parent chain when needed
            const newChat = new Chat({
                name: `[Branch from "${originalChat.name}"]`, // More descriptive name
                participants: originalChat.participants,
                notes: originalChat.notes, // Copy notes to branch
                parentId: originalChat.id, // Set parent ID
                branchPointMessageId: messageId, // Store where this branch diverged
                messages: [] // Empty - messages will come from parent chain!
            });

            // Log branch creation for debugging
            console.log(`[Branch] Creating branch from chat "${originalChat.name}" (${originalChat.id}) at message ${messageId}`);
            console.log(`[Branch] New branch: id=${newChat.id}, parentId=${newChat.parentId}, branchPointMessageId=${newChat.branchPointMessageId}`);

            if (existsSync(path.join(CHATS_DIR, `${newChat.id}.json`))) {
                broadcastEvent('notification', {
                    type: 'bad',
                    header: 'Branch Creation Failed',
                    message: `Chat ID "${newChat.id}" already exists. Branch creation aborted.`
                });
                return res.status(409).json({ message: `Chat ID "${newChat.id}" already exists. Try again.` });

            }
            await fs.writeFile(path.join(CHATS_DIR, `${newChat.id}.json`), JSON.stringify(newChat, null, 2));
            state.chats.push(newChat);

            // Update the original chat to record the new branch as its child
            // Re-read the parent chat to avoid race condition (another request may have modified it)
            const freshParentData = JSON.parse(await fs.readFile(originalChatPath, 'utf-8'));
            const freshParentChat = new Chat(freshParentData);
            freshParentChat.childChatIds = freshParentChat.childChatIds || [];
            if (!freshParentChat.childChatIds.includes(newChat.id)) {
                freshParentChat.childChatIds.push(newChat.id);
            }
            freshParentChat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(originalChatPath, JSON.stringify(freshParentChat, null, 2));

            // Update in-memory state as well
            const stateChat = state.chats.find(c => c.id === originalChatId);
            if (stateChat) {
                stateChat.childChatIds = freshParentChat.childChatIds;
                stateChat.lastModifiedAt = freshParentChat.lastModifiedAt;
            }

            // Broadcast updates for both the new chat and the updated original chat
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'create', data: newChat.getSummary() });
            broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: freshParentChat.getSummary() });

            res.status(201).json(newChat);

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Original chat not found.' });
            console.error(`Error branching chat ${originalChatId}:`, e);
            res.status(500).json({ message: 'Failed to create chat branch.' });
        }
    });

    app.post('/api/chats/:id/rewind', async (req, res) => {
        const { id } = req.params;
        const { targetMessageId } = req.body;

        if (!targetMessageId) {
            return res.status(400).json({ message: 'targetMessageId is required.' });
        }

        try {
            const chatPath = path.join(CHATS_DIR, `${id}.json`);
            const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
            const chat = new Chat(chatData);

            // 1. Reconstruct full history to determine chronological order
            // We need to know exactly which messages come AFTER the target
            const fullChat = await buildFullChatForClient(chat);
            const allMessages = fullChat.messages;

            const targetIndex = allMessages.findIndex(m => m.id === targetMessageId);

            if (targetIndex === -1) {
                return res.status(404).json({ message: 'Target message not found in chat history.' });
            }

            // 2. Identify messages to delete (everything AFTER the target index)
            // We keep the target message, removing only what follows it.
            const messagesToDelete = allMessages.slice(targetIndex + 1);

            if (messagesToDelete.length === 0) {
                return res.json({ message: 'No messages to rewind (target is the latest message).' });
            }

            let modified = false;
            const existingDeletedSet = new Set(chat.deletedMessageIds || []);

            // 3. Process deletions based on ownership
            for (const msg of messagesToDelete) {
                if (msg._isInherited) {
                    // Inherited message: Add to deletedMessageIds list for this branch
                    if (!existingDeletedSet.has(msg.id)) {
                        existingDeletedSet.add(msg.id);
                        modified = true;
                    }
                } else {
                    // Owned message: Remove from the local messages array
                    const localIndex = chat.messages.findIndex(m => m.id === msg.id);
                    if (localIndex !== -1) {
                        chat.messages.splice(localIndex, 1);
                        modified = true;
                    }
                }
            }

            if (modified) {
                chat.deletedMessageIds = Array.from(existingDeletedSet);
                chat.lastModifiedAt = new Date().toISOString();

                await fs.writeFile(chatPath, JSON.stringify(chat, null, 2));

                // Update in-memory state
                const index = state.chats.findIndex(c => c.id === id);
                if (index !== -1) state.chats[index] = chat;

                // Broadcast updates
                broadcastEvent('resourceChange', { resourceType: 'chat', eventType: 'update', data: chat.getSummary() });

                // Re-build full chat for client (now truncated)
                const updatedFullChat = await buildFullChatForClient(chat);
                broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: updatedFullChat });
            }

            res.json({ success: true, rewoundCount: messagesToDelete.length });

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found.' });
            console.error(`Error rewinding chat ${id}:`, e);
            res.status(500).json({ message: 'Failed to rewind chat.' });
        }
    });

    // New endpoint to promote an embedded resource to the global library
    app.post('/api/chats/:id/promote-to-library', async (req, res) => {
        const { id: chatId } = req.params;
        const { resourceType, resourceId } = req.body;

        if (!resourceType || !resourceId) {
            return res.status(400).json({ message: 'resourceType and resourceId are required.' });
        }
        if (resourceType !== 'character' && resourceType !== 'note') {
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
            } else if (resourceType === 'note') {
                const noteIndex = chat.notes.findIndex(s => typeof s === 'object' && s.id === resourceId);
                if (noteIndex === -1) return res.status(404).json({ message: 'Embedded note not found in chat.' });

                const embeddedNoteData = chat.notes[noteIndex];
                const newNote = new Note(embeddedNoteData); // Assigns new permanent ID

                await fs.writeFile(path.join(NOTES_DIR, `${newNote.id}.json`), JSON.stringify(newNote, null, 2));

                state.notes.push(newNote);
                chat.notes[noteIndex] = newNote.id; // Replace object with ID
                newGlobalResource = newNote;
                found = true;
            }

            if (found) {
                // Save the updated chat file
                chat.lastModifiedAt = new Date().toISOString();
                await fs.writeFile(chatPath, JSON.stringify(chat, null, 2));

                // Broadcast events
                broadcastEvent('resourceChange', { resourceType, eventType: 'create', data: newGlobalResource });
                // Build full chat with parent messages for client
                const fullChat = await buildFullChatForClient(chat);
                broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });

                res.json(chat);
            }

        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Chat not found.' });
            console.error('Error promoting resource:', e);
            res.status(500).json({ message: 'Failed to promote resource to library.' });
        }
    });

    // Providers API
    app.get('/api/providers/schemas', (req, res) => {
        const schemas = {};
        for (const [id, providerClass] of Object.entries(PROVIDERS)) {
            if (typeof providerClass.getProviderSchema === 'function') {
                schemas[id] = providerClass.getProviderSchema();
            }
        }
        res.json(schemas);
    });

    app.get('/api/providers/generation-schemas', (req, res) => {
        const schemas = {};
        for (const [id, providerClass] of Object.entries(PROVIDERS)) {
            if (typeof providerClass.getGenerationParametersSchema === 'function') {
                schemas[id] = providerClass.getGenerationParametersSchema();
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
            const ProviderClass = PROVIDERS[config.provider];
            if (!ProviderClass) {
                return res.status(400).json({ ok: false, message: `Unsupported provider type: '${config.provider}'` });
            }
            const providerInstance = new ProviderClass(config);
            const result = await providerInstance.healthCheck();
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

        const resolvedNotes = [];
        for (const s of chat.notes) {
            if (typeof s === 'string') {
                const note = state.notes.find(sc => sc.id === s);
                if (note) resolvedNotes.push(note);
            } else if (typeof s === 'object' && s.id && s.name) {
                resolvedNotes.push(new Note(s));
            }
        }
        return { characters: resolvedChars, notes: resolvedNotes };
    }

    async function processPrompt(chatId, userMessageContent = null, isRegen = false, messageIdToRegen = null, historyOverride = null, signal = null) {
        // 1. Get Active Connection and Provider
        const { activeConnectionConfigId, userPersonaCharacterId, activeGenerationConfigId } = state.settings;
        if (!activeConnectionConfigId) throw new Error('No active connection configuration set.');

        const config = state.connectionConfigs.find(c => c.id === activeConnectionConfigId);
        if (!config) throw new Error(`Active connection config (ID: ${activeConnectionConfigId}) not found.`);

        const ProviderClass = PROVIDERS[config.provider];
        if (!ProviderClass) throw new Error(`Unsupported provider type: ${config.provider}`);
        const provider = new ProviderClass(config);

        // 2. Prepare Prompt Data
        const chatPath = path.join(CHATS_DIR, `${chatId}.json`);
        const chat = new Chat(JSON.parse(await fs.readFile(chatPath, 'utf-8')));

        const { characters: chatCharacters, notes: activeNotes } = await getResolvedChatContext(chat);

        // Build full message history including parent chain with overrides applied
        // Always use buildFullChatForClient to ensure message overrides are applied
        const fullChat = await buildFullChatForClient(chat);
        let historyForPrompt = fullChat.messages;
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
            activeNotes
        };

        // 3. Assemble Prompt from Generation Config
        let finalMessageList = [];
        let systemParts = [];
        let generationParameters = {};

        const genConfig = activeGenerationConfigId ? state.generationConfigs.find(c => c.id === activeGenerationConfigId) : null;

        if (genConfig) {
            if (genConfig.parameters && genConfig.parameters[config.provider]) {
                generationParameters = genConfig.parameters[config.provider];
            }

            // Add the generation config's system prompt to system parts
            if (genConfig.systemPrompt) {
                systemParts.push(resolveMacros(genConfig.systemPrompt, macroContext));
            }
        }

        // Always include chat history and user message in the final message list
        finalMessageList.push(...historyForPrompt);
        if (userMessageToAppend) {
            finalMessageList.push(userMessageToAppend);
        }

        const resolvedSystemInstruction = systemParts.join('\n\n');
        // save final prompt message to temp file for debugging
        const TEMP_DIR = path.join(__dirname, 'temp');
        await fs.mkdir(TEMP_DIR, { recursive: true });
        const tempPromptPath = path.join(TEMP_DIR, `prompt-${chatId}-${Date.now()}.json`);
        await fs.writeFile(tempPromptPath, JSON.stringify({ system: resolvedSystemInstruction, messages: finalMessageList }, null, 2));

        // 5. Stream response from provider
        console.log('About to call provider.prompt with:', {
            provider: config.provider,
            messageCount: finalMessageList.length,
            systemInstructionLength: resolvedSystemInstruction.length,
            generationParameters
        });

        const stream = provider.prompt(finalMessageList, {
            systemInstruction: resolvedSystemInstruction,
            signal,
            ...generationParameters,
        });

        console.log('Provider returned stream:', !!stream);
        return { stream, chat, userMessageToAppend, historyForPrompt, isRegen, messageIdToRegen, provider, generationParameters };
    }

    app.post('/api/chats/:id/regenerate', async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const abortController = new AbortController();


        try {
            const { id: chatId } = req.params;
            const { messageId, history } = req.body;
            if (!messageId) throw new Error('messageId for regeneration is required.');

            const { stream: initialStream, chat, provider, generationParameters } = await processPrompt(chatId, null, true, messageId, history, abortController.signal);
            const finalStream = await getFinalStream(initialStream, provider, generationParameters, abortController.signal);

            let newContent = '';
            let tokenCount = 0;
            console.log('Starting stream for regenerate...');
            for await (const token of finalStream) {
                tokenCount++;
                newContent += token;
                sendSse(res, 'token', { token });
            }
            console.log(`[Regenerate] Stream complete - Tokens: ${tokenCount}, Characters: ${newContent.length}`);

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

            // Build full chat with parent messages for client
            const fullChat = await buildFullChatForClient(chat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });
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
            const { stream: initialStream, chat, provider, generationParameters } = await processPrompt(chatId, null, false, null, history, abortController.signal);
            const finalStream = await getFinalStream(initialStream, provider, generationParameters, abortController.signal);

            const assistantMessage = { role: 'assistant', content: '', id: uuidv4(), timestamp: new Date().toISOString() };
            let tokenCount = 0;
            for await (const token of finalStream) {
                tokenCount++;
                assistantMessage.content += token;
                sendSse(res, 'token', { token });
            }

            console.log(`[Resend] Stream complete - Tokens: ${tokenCount}, Characters: ${assistantMessage.content.length}`);

            chat.messages.push(assistantMessage);
            chat.lastModifiedAt = new Date().toISOString();
            await fs.writeFile(chatPath, JSON.stringify(chat, null, 2));

            // Build full chat with parent messages for client
            const fullChat = await buildFullChatForClient(chat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });
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

            const { stream: initialStream, chat, userMessageToAppend, provider, generationParameters } = await processPrompt(chatId, message, false, null, history, abortController.signal);
            const finalStream = await getFinalStream(initialStream, provider, generationParameters, abortController.signal);

            const assistantMessage = { role: 'assistant', content: '', id: uuidv4(), timestamp: new Date().toISOString() };
            let tokenCount = 0;
            console.log('Starting stream for prompt...');
            for await (const token of finalStream) {
                tokenCount++;
                assistantMessage.content += token;
                sendSse(res, 'token', { token });
            }
            console.log(`[Prompt] Stream complete - Tokens: ${tokenCount}, Characters: ${assistantMessage.content.length}`);

            if (userMessageToAppend) chat.addMessage(userMessageToAppend);
            chat.addMessage(assistantMessage);
            chat.lastModifiedAt = new Date().toISOString();

            if (chat.name.startsWith('[Branch from') && userMessageToAppend?.content) {
                const newName = `"${userMessageToAppend.content.substring(0, 30).trim()}..."`;
                chat.name = newName;
            }

            await fs.writeFile(path.join(CHATS_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2));

            // Build full chat with parent messages for client
            const fullChat = await buildFullChatForClient(chat);
            broadcastEvent('resourceChange', { resourceType: 'chat_details', eventType: 'update', data: fullChat });
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

    // Simple completions endpoint for plugins/tools
    app.post('/api/completions', async (req, res) => {
        try {
            const { messages, stream = false, temperature, max_tokens } = req.body;

            // Get active connection config
            const { activeConnectionConfigId, activeGenerationConfigId } = state.settings;
            if (!activeConnectionConfigId) {
                return res.status(400).json({ message: 'No active connection configuration set.' });
            }

            const config = state.connectionConfigs.find(c => c.id === activeConnectionConfigId);
            if (!config) {
                return res.status(404).json({ message: `Active connection config not found.` });
            }

            const ProviderClass = PROVIDERS[config.provider];
            if (!ProviderClass) {
                return res.status(400).json({ message: `Unsupported provider: ${config.provider}` });
            }

            const provider = new ProviderClass(config);

            // Get generation config if exists
            let generationParams = {};
            if (activeGenerationConfigId) {
                const genConfig = state.generationConfigs.find(g => g.id === activeGenerationConfigId);
                if (genConfig && genConfig.params) {
                    generationParams = { ...genConfig.params };
                }
            }

            // Override with request params if provided
            if (temperature !== undefined) generationParams.temperature = temperature;

            // Handle max_tokens based on provider
            if (max_tokens !== undefined) {
                if (config.provider === 'gemini') {
                    generationParams.maxOutputTokens = max_tokens;
                } else {
                    generationParams.max_tokens = max_tokens;
                }
            }

            // For non-streaming response
            if (!stream) {
                // Extract system message if present
                let systemInstruction = '';
                let messageList = [...messages];

                if (messages.length > 0 && messages[0].role === 'system') {
                    systemInstruction = messages[0].content;
                    messageList = messages.slice(1);
                }

                const completion = provider.prompt(messageList, {
                    systemInstruction,
                    ...generationParams
                });

                let fullContent = '';
                for await (const token of completion) {
                    fullContent += token;
                }

                return res.json({
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: fullContent
                        }
                    }]
                });
            }

            // For streaming response (not implemented for plugins yet)
            res.status(501).json({ message: 'Streaming not implemented for completions endpoint' });

        } catch (error) {
            console.error('Error in completions endpoint:', error);
            res.status(500).json({ message: error.message });
        }
    });

    // Tool API: Generate Character
    app.post('/api/tools/generate-character', async (req, res) => {
        try {
            const { name, description } = req.body;

            // 1. Get Active Connection
            const { activeConnectionConfigId } = state.settings;
            if (!activeConnectionConfigId) return res.status(400).json({ message: 'No active connection configuration.' });

            const config = state.connectionConfigs.find(c => c.id === activeConnectionConfigId);
            if (!config) return res.status(404).json({ message: 'Active connection config not found.' });

            const ProviderClass = PROVIDERS[config.provider];
            if (!ProviderClass) return res.status(400).json({ message: `Unsupported provider: ${config.provider}` });
            const provider = new ProviderClass(config);

            // 2. Prepare Prompt
            const promptTemplate = await fs.readFile(path.join(__dirname, 'server/utils/prompts/generate_char.md'), 'utf-8');
            const systemInstruction = promptTemplate;

            // Use user description as the prompt, or a default instruction if empty
            const userContent = `
Name: ${name || '(No name provided)'}
Description: ${description || '(No description provided)'}
            `.trim();

            const messages = [{ role: 'user', content: userContent }];

            // 3. Call LLM
            let generationParameters = {};
            const { activeGenerationConfigId } = state.settings;
            if (activeGenerationConfigId) {
                const genConfig = state.generationConfigs.find(c => c.id === activeGenerationConfigId);
                if (genConfig && genConfig.parameters && genConfig.parameters[config.provider]) {
                    generationParameters = genConfig.parameters[config.provider];
                }
            }

            const stream = provider.prompt(messages, {
                systemInstruction,
                ...generationParameters,
            }, false, { websearchEnabled: true });

            let fullContent = '';
            for await (const token of stream) {
                fullContent += token;
            }

            // 4. Parse JSON
            let jsonString = fullContent.trim();
            // Remove markdown code blocks if present
            jsonString = jsonString.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

            let result;
            try {
                result = JSON.parse(jsonString);
            } catch (e) {
                console.warn('Failed to parse character generation JSON:', jsonString);
                broadcastEvent('notification', {
                    type: 'error',
                    header: 'Character Creation Failed',
                    message: 'Failed to parse the LLM\'s response as JSON. Please try again.',
                });
                // Fallback: attempt to assume the whole text is the description if JSON parsing failed
                result = { name: name, description: fullContent };
            }

            res.json(result);

        } catch (error) {
            console.error('Error generating character:', error);
            res.status(500).json({ message: error.message });
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
        if (charData.expressions && Array.isArray(charData.expressions)) {
            charData.expressions = charData.expressions.map(item => ({
                ...item,
                url: `/data/characters/${id}/expressions/${item.src}?t=${Date.now()}`
            }));
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

    // 3. Update notes
    const noteFiles = await glob(path.join(NOTES_DIR, '*.json').replace(/\\/g, '/'));
    for (const noteFile of noteFiles) {
        try {
            const noteData = JSON.parse(await fs.readFile(noteFile, 'utf-8'));
            if (noteData.characterOverrides && noteData.characterOverrides[oldId]) {
                noteData.characterOverrides[newId] = noteData.characterOverrides[oldId];
                delete noteData.characterOverrides[oldId];
                await fs.writeFile(noteFile, JSON.stringify(noteData, null, 2));
                const noteInState = state.notes.find(s => s.id === noteData.id);
                if (noteInState) noteInState.characterOverrides = noteData.characterOverrides;
            }
        } catch (e) {
            console.error(`Failed to update character ID in note file ${noteFile}:`, e);
        }
    }
}

// Data Models
class Character {
    id = uuidv4();
    name = '';
    description = '';
    avatarUrl = null;
    expressions = [];
    gallery = [];
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Character',
            description: '',
            avatarUrl: null,
            expressions: [],
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
            // Strip the full URLs from items before saving to JSON
            expressions: this.expressions.map(({ url, ...rest }) => rest),
            gallery: this.gallery.map(({ url, ...rest }) => rest),
        };
    }
}

class Chat {
    id = uuidv4();
    name = 'New Chat';
    messages = [];
    participants = []; // Array of string (ID) or object (embedded character)
    notes = []; // Array of string (ID) or object (embedded note)
    parentId = null;
    branchPointMessageId = null; // ID of the message where this branch diverged from parent
    childChatIds = [];
    messageOverrides = {}; // { messageId: { content: "...", depth: N } } - overrides for inherited messages
    deletedMessageIds = []; // IDs of inherited messages this branch considers "deleted" from its view
    createdAt = new Date().toISOString();
    lastModifiedAt = new Date().toISOString();
    _rev = CURRENT_REV;

    constructor(data = {}) {
        const now = new Date().toISOString();
        const defaults = {
            id: uuidv4(),
            name: 'New Chat',
            messages: [],
            participants: [],
            notes: [],
            parentId: null,
            branchPointMessageId: null,
            childChatIds: [],
            messageOverrides: {},
            deletedMessageIds: [],
            createdAt: now,
            lastModifiedAt: now,
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
    provider = 'v1'; // 'v1' or 'gemini'
    url = '';
    apiKey = '';
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Config',
            provider: 'v1',
            url: '',
            apiKey: '',
            _rev: CURRENT_REV,
        }, data);
    }
    toJSON() { return { id: this.id, name: this.name, provider: this.provider, url: this.url, apiKey: this.apiKey, _rev: this._rev }; }
}


class Note {
    id = uuidv4();
    name = 'New Note';
    describes = '';
    description = ''; // General note text
    characterOverrides = {}; // { [characterId]: "character-specific text" }
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Note',
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
    systemPrompt = ''; // Unified system prompt with macro support
    parameters = {}; // e.g. { v1: { temperature: 0.7 }, gemini: { temperature: 0.8 } }
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Generation Config',
            systemPrompt: '',
            parameters: {},
            _rev: CURRENT_REV,
        }, data);
    }
}

class Scenario {
    id = uuidv4();
    name = 'New Scenario';
    description = '';
    firstMessage = ''; // The initial message to start the chat with
    participants = []; // Array of character IDs
    notes = []; // Array of note IDs
    avatarUrl = null;
    bannerUrl = null;
    _rev = CURRENT_REV;

    constructor(data = {}) {
        Object.assign(this, {
            id: uuidv4(),
            name: 'New Scenario',
            description: '',
            firstMessage: '',
            participants: [],
            notes: [],
            avatarUrl: null,
            bannerUrl: null,
            _rev: CURRENT_REV
        }, data);
    }
}

main();