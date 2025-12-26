import { BaseProvider } from './base.js';

/**
 * Provider for OpenAI-compatible APIs (v1/chat/completions).
 * Works with OpenAI, local inference servers (Ollama, LM Studio, llama-server), 
 * and other proxies that follow the OpenAI format.
 */
export class OpenAIV1Provider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    /**
     * Defines configuration fields for the 'Connection' setup.
     * These map to the persistent ConnectionConfig properties.
     */
    static getProviderSchema() {
        return [
            { 
                name: 'url', 
                label: 'Base URL', 
                type: 'text', 
                required: true, 
                placeholder: 'http://localhost:1234/v1', 
                defaultValue: 'http://localhost:1234/v1',
                description: 'The API endpoint base URL. Usually ends in /v1'
            },
            { 
                name: 'apiKey', 
                label: 'API Key', 
                type: 'password', 
                required: false, 
                placeholder: 'sk-... or leave empty for local',
                description: 'Required for OpenAI. Often ignored by local servers.'
            },
        ];
    }
    
    /**
     * Defines dynamic parameters for the 'Generation' setup.
     * These are stored in GenerationConfig.
     */
    static getGenerationParametersSchema() {
        return [
            { 
                name: 'model', 
                label: 'Model ID', 
                type: 'text', 
                placeholder: 'e.g., gpt-3.5-turbo, local-model',
                description: 'Specific model identifier. Local servers often ignore this or accept any string.'
            },
            { 
                name: 'temperature', 
                label: 'Temperature', 
                type: 'range', 
                min: 0, 
                max: 2, 
                step: 0.1, 
                defaultValue: 0.7 
            },
            { 
                name: 'top_p', 
                label: 'Top P', 
                type: 'range', 
                min: 0, 
                max: 1, 
                step: 0.05, 
                defaultValue: 1.0 
            },
            { 
                name: 'max_tokens', 
                label: 'Max Tokens', 
                type: 'number', 
                min: -1, 
                step: 1, 
                defaultValue: -1,
                description: 'Maximum new tokens to generate. Set to -1 for unlimited (context window permitting).'
            },
            { 
                name: 'presence_penalty', 
                label: 'Presence Penalty', 
                type: 'range', 
                min: -2, 
                max: 2, 
                step: 0.1, 
                defaultValue: 0 
            },
            { 
                name: 'frequency_penalty', 
                label: 'Frequency Penalty', 
                type: 'range', 
                min: -2, 
                max: 2, 
                step: 0.1, 
                defaultValue: 0 
            },
            { 
                name: 'stop', 
                label: 'Stop Sequences', 
                type: 'text', 
                placeholder: 'comma separated, e.g. "User:,Assistant:"' 
            },
        ];
    }
    
    async *prompt(messages, options = {}) {
        const { url, apiKey } = this.config;
        const { systemInstruction, stream = true, signal, ...genParams } = options;

        // 1. Prepare messages
        const apiMessages = this.prepareMessages(messages);
        
        // Inject system instruction if present
        const finalMessages = [];
        if (systemInstruction) {
            finalMessages.push({ role: 'system', content: systemInstruction });
        }
        finalMessages.push(...apiMessages);

        // 2. Prepare Body
        // Process 'stop' sequence string into array
        if (genParams.stop && typeof genParams.stop === 'string') {
            genParams.stop = genParams.stop.split(',').map(s => s.trim()).filter(s => s);
        }
        // Cleanup defaults
        if (parseInt(genParams.max_tokens) === -1) delete genParams.max_tokens;
        if (genParams.stop && genParams.stop.length === 0) delete genParams.stop;
        
        const body = {
            messages: finalMessages,
            stream,
            ...genParams
        };

        // Fallback model if not provided (required by strict OpenAI proxies)
        if (!body.model) body.model = 'gpt-3.5-turbo';

        // 3. Prepare URL
        let fetchUrl = url;
        if (!fetchUrl.endsWith('/chat/completions')) {
            fetchUrl = fetchUrl.replace(/\/$/, '') + '/chat/completions';
        }

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        console.log(`[OpenAIV1] Sending request to ${fetchUrl}`);

        // 4. Send Request
        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `HTTP ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) errorMsg = errorJson.error.message;
            } catch (e) { /* ignore JSON parse error */ }
            
            throw new Error(`OpenAI Provider Error: ${errorMsg}`);
        }
        
        // 5. Handle Non-Streaming Response
        if (!stream) {
            const data = await response.json();
            yield data.choices?.[0]?.message?.content || '';
            return;
        }

        // 6. Handle Streaming Response
        const decoder = new TextDecoder();
        
        // Native Node.js fetch returns an async iterable body
        if (response.body && response.body[Symbol.asyncIterator]) {
            let buffer = '';
            for await (const chunk of response.body) {
                const decodedChunk = decoder.decode(chunk, { stream: true });
                buffer += decodedChunk;
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep the last partial line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(trimmed.substring(6));
                            const token = data.choices?.[0]?.delta?.content;
                            if (token) yield token;
                        } catch (err) {
                            console.warn('[OpenAIV1] Error parsing stream chunk:', err);
                        }
                    }
                }
            }
        } else {
            // Fallback if environment doesn't support async iterator on body
            throw new Error('Streaming not supported in this Node environment.');
        }
    }

    async healthCheck() {
        const { url, apiKey } = this.config;
        let fetchUrl = url;
        
        // Try to construct a /models endpoint
        fetchUrl = fetchUrl.replace(/\/chat\/completions\/?$/, ''); 
        fetchUrl = fetchUrl.replace(/\/$/, '');
        const modelsUrl = fetchUrl + '/models';

        const headers = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        try {
            // Attempt to list models
            const response = await fetch(modelsUrl, { headers });
            
            if (response.ok) {
                const data = await response.json();
                const models = data.data || data; // OpenAI uses { data: [] }, some locals return [] directly
                const count = Array.isArray(models) ? models.length : 0;
                return { ok: true, message: `Connected successfully. Found ${count} models.` };
            }

            // If /models fails (404/405), try a basic chat completion as fallback check
            const chatUrl = fetchUrl + '/chat/completions';
            const testBody = {
                model: 'test',
                messages: [{ role: 'user', content: 'Test' }],
                max_tokens: 1
            };
            
            const chatRes = await fetch(chatUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(testBody)
            });

            if (chatRes.ok) {
                return { ok: true, message: 'Connected successfully (verified via chat request).' };
            }

            const errText = await response.text();
            return { ok: false, message: `Connection failed (HTTP ${response.status}). ${errText.substring(0, 100)}` };

        } catch (error) {
            return { ok: false, message: `Network error: ${error.message}` };
        }
    }

    /**
     * Prepares standard messages into OpenAI API compatible format.
     */
    prepareMessages(messages) {
        return messages.map(msg => ({ role: msg.role, content: msg.content }));
    }
}