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

    static getProviderSchema() {
        return [
            { name: 'url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:11434/v1' },
            { name: 'apiKey', label: 'API Key', type: 'password', required: false, placeholder: 'Optional for local servers' },
            { name: 'modelId', label: 'Model ID', type: 'text', required: true, placeholder: 'gpt-4o, llama3.2, etc.' },
        ];
    }

    static getGenerationParametersSchema() {
        return [
            { name: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
            { name: 'top_p', label: 'Top P', type: 'range', min: 0, max: 1, step: 0.05, defaultValue: 1 },
            { name: 'max_tokens', label: 'Max Tokens', type: 'number', min: 1, step: 1, defaultValue: 4096 },
            { name: 'frequency_penalty', label: 'Frequency Penalty', type: 'range', min: -2, max: 2, step: 0.1, defaultValue: 0 },
            { name: 'presence_penalty', label: 'Presence Penalty', type: 'range', min: -2, max: 2, step: 0.1, defaultValue: 0 },
            { name: 'stop', label: 'Stop Sequences', type: 'text', placeholder: 'Comma-separated, e.g.: Human:,Assistant:' },
        ];
    }

    prepareMessages(messages) {
        // OpenAI format is very close to the internal format
        // Just ensure we only pass role and content
        return messages
            .filter(msg => msg.content) // Skip empty messages
            .map(msg => ({
                role: msg.role, // 'user' or 'assistant'
                content: msg.content,
            }));
    }

    async *prompt(messages, options = {}) {
        const { url, apiKey, modelId } = this.config;
        const { systemInstruction, signal, stop, ...generationConfig } = options;

        // Build the messages array with system instruction first if provided
        const apiMessages = [];
        if (systemInstruction) {
            apiMessages.push({
                role: 'system',
                content: systemInstruction,
            });
        }
        apiMessages.push(...this.prepareMessages(messages));

        // Parse stop sequences from comma-separated string
        let stopSequences = undefined;
        if (stop && typeof stop === 'string' && stop.trim()) {
            stopSequences = stop.split(',').map(s => s.trim()).filter(s => s);
        }

        const body = {
            model: modelId,
            messages: apiMessages,
            stream: true,
            ...generationConfig,
            ...(stopSequences && stopSequences.length > 0 && { stop: stopSequences }),
        };

        // Ensure URL ends properly for the chat completions endpoint
        const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const chatUrl = `${baseUrl}/chat/completions`;

        try {
            const messageCount = apiMessages.length;
            const sysInstructionSize = systemInstruction?.length || 0;
            console.log(`[OpenAI v1] Sending prompt - Messages: ${messageCount}, SysInstruction: ${sysInstructionSize} chars, Model: ${modelId}, Temp: ${body.temperature}, MaxTokens: ${body.max_tokens}`);

            const headers = {
                'Content-Type': 'application/json',
            };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(chatUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal,
            });

            console.log('[OpenAI v1] Response status:', response.status);

            if (!response.ok || !response.body) {
                const errorBody = await response.json().catch(() => ({ message: response.statusText }));
                console.error('[OpenAI v1] API Error:', errorBody);
                throw new Error(`OpenAI v1 API Error: ${errorBody.error?.message || errorBody.message || response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let chunkCount = 0;
            let tokenCount = 0;

            console.log('[OpenAI v1] Starting stream...');
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    console.log(`[OpenAI v1] Stream complete - Chunks: ${chunkCount}, Tokens: ${tokenCount}`);
                    break;
                }

                chunkCount++;
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // Process complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    const trimmedLine = line.trim();

                    // Skip empty lines
                    if (!trimmedLine) continue;

                    // Check for stream end
                    if (trimmedLine === 'data: [DONE]') {
                        console.log('[OpenAI v1] Received [DONE] signal');
                        continue;
                    }

                    // Parse SSE data lines
                    if (trimmedLine.startsWith('data: ')) {
                        try {
                            const jsonStr = trimmedLine.substring(6);
                            const jsonData = JSON.parse(jsonStr);

                            // Extract token from delta content
                            const token = jsonData.choices?.[0]?.delta?.content;
                            if (token) {
                                tokenCount++;
                                yield token;
                            }
                        } catch (e) {
                            // Some providers send malformed JSON occasionally, skip those
                            console.error('[OpenAI v1] Error parsing SSE chunk:', e.message, trimmedLine);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                throw error;
            }
            console.error('[OpenAI v1] Prompt error:', error);
            yield `**Error interacting with OpenAI v1 API:**\n*${error.message}*`;
        }
    }

    async healthCheck() {
        const { url, apiKey, modelId } = this.config;
        const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;

        try {
            // First try the /models endpoint as it's lightweight
            const modelsUrl = `${baseUrl}/models`;
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const modelsResponse = await fetch(modelsUrl, { headers });

            if (modelsResponse.ok) {
                const modelsData = await modelsResponse.json();
                const modelCount = modelsData.data?.length || 0;
                return {
                    ok: true,
                    message: `Connected successfully. ${modelCount} model(s) available.`,
                    data: modelsData,
                };
            }

            // If /models fails, try a minimal chat completion
            const chatUrl = `${baseUrl}/chat/completions`;
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: modelId,
                    messages: [{ role: 'user', content: 'Hi' }],
                    max_tokens: 1,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const message = errorBody.error?.message || `HTTP ${response.status}`;
                return { ok: false, message: `Connection failed: ${message}` };
            }

            return { ok: true, message: 'Successfully connected to OpenAI v1 API.' };

        } catch (error) {
            return { ok: false, message: `Connection failed: ${error.message}` };
        }
    }

    async getModels() {
        const { url, apiKey } = this.config;
        const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const modelsUrl = `${baseUrl}/models`;

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(modelsUrl, { headers });

            if (!response.ok) {
                console.warn('[OpenAI v1] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            // OpenAI format returns { data: [{ id: 'model-id', ... }] }
            return data.data || [];

        } catch (error) {
            console.error('[OpenAI v1] Error fetching models:', error.message);
            return [];
        }
    }
}
