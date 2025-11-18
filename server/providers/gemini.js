import { BaseProvider } from './base.js';
import { FAST_MODEL_EQUIVALENTS } from '../model.js';

const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // for now, we use a fixed model ID
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:streamGenerateContent`;

const getGeminiApiUrl = (modelId) => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent`;
};

export class GoogleGeminiProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }
    
    static getProviderSchema() {
        // Gemini provider only requires an API key, as the URL is fixed.
        return [
            { name: 'apiKey', label: 'API Key', type: 'password', required: false, placeholder: '' },
        ];
    }
    
    static getGenerationParametersSchema() {
        return [
            { name: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.1, defaultValue: 0.9 },
            { name: 'topP', label: 'Top P', type: 'range', min: 0, max: 1, step: 0.05, defaultValue: 1 },
            { name: 'topK', label: 'Top K', type: 'number', min: 1, step: 1, defaultValue: 1 },
            { name: 'maxOutputTokens', label: 'Max Output Tokens', type: 'number', min: 1, step: 1, defaultValue: 65536 },
            // { name: 'stopSequences', label: 'Stop Sequences', type: 'text', placeholder: 'e.g., "Human:, AI:"' },
            // { name: 'urlContext', label: 'URL Context', type: 'checkbox', defaultValue: false, description: 'Gemini opens links included in the user prompt and uses the content to in the output.' },
        ];
    }

    // TODO: Use the gemini SDK instead of their REST API directly
    async *prompt(messages, options = { generationConfig: {}, systemInstruction: '', signal: null }, useFastModel = false) {
        const { apiKey } = this.config;
        const { systemInstruction, signal, ...generationConfig } = options;

        const body = {
            contents: this.prepareMessages(messages),
            ...(systemInstruction && { system_instruction: { parts: [{ text: systemInstruction }] } }),
            ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
            ...{
                safetySettings: [
                    {
                        category: 'HARM_CATEGORY_HARASSMENT',
                        threshold: 'BLOCK_NONE'
                    },
                    {
                        category: 'HARM_CATEGORY_HATE_SPEECH',
                        threshold: 'BLOCK_NONE'
                    },
                    {
                        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                        threshold: 'BLOCK_NONE'
                    },
                    {
                        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                        threshold: 'BLOCK_NONE'
                    },
                    {
                        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
                        threshold: 'BLOCK_NONE'
                    }
                ]
            }
        };
        
        try {
            // Use the streaming endpoint with SSE enabled
            const streamingUrl = `${getGeminiApiUrl(useFastModel ? FAST_MODEL_EQUIVALENTS[GEMINI_MODEL_ID] : GEMINI_MODEL_ID)}?key=${apiKey}&alt=sse`;
            
            const messageCount = body.contents?.length || 0;
            const sysInstructionSize = body.system_instruction?.parts?.[0]?.text?.length || 0;
            const modelId = useFastModel ? FAST_MODEL_EQUIVALENTS[GEMINI_MODEL_ID] : GEMINI_MODEL_ID;
            console.log(`[Gemini] Sending prompt - Messages: ${messageCount}, SysInstruction: ${sysInstructionSize} chars, Model: ${modelId}, Temp: ${body.generationConfig.temperature}, MaxTokens: ${body.generationConfig.maxOutputTokens}`);
            
            const response = await fetch(streamingUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });

            console.log('Gemini response status:', response.status);
            console.log('Gemini response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok || !response.body) {
                const errorBody = await response.json().catch(() => ({ message: response.statusText }));
                console.error('Gemini API Error:', errorBody);
                throw new Error(`Gemini API Error: ${errorBody.error?.message || response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let chunkCount = 0;
            let tokenCount = 0;

            console.log('[Gemini] Starting stream...');
            while(true) {
                const { value, done } = await reader.read();
                if (done) {
                    console.log(`[Gemini] Stream complete - Chunks: ${chunkCount}, Tokens: ${tokenCount}`);
                    break;
                }

                chunkCount++;
                const chunk = decoder.decode(value, { stream: true });

                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep any partial line in the buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonData = JSON.parse(line.substring(6));
                            const token = jsonData.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (token) {
                                tokenCount++;
                                yield token;
                            }
                        } catch (e) {
                            console.error('Error parsing Gemini SSE chunk:', e, line);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                // Re-throw so the server.js handler can catch it and know it was an abort
                throw error;
            }
            console.error('Gemini prompt error:', error);
            // Yield the error message as a token so it appears in the chat
            yield `**Error interacting with Gemini:**\n*${error.message}*`;
        }
    }

    async healthCheck() {
        const { apiKey } = this.config;
        try {
            // A simple health check is to send a minimal request to the non-streaming endpoint.
            const healthCheckUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`;
            const response = await fetch(healthCheckUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: "This is a test prompt. Only respond with \"Hello.\"" }]}]
                }),
            });

            if (!response.ok) {
                 const errorBody = await response.json().catch(() => ({}));
                 const message = errorBody.error?.message || `HTTP ${response.status}`;
                 return { ok: false, message: `Connection failed: ${message}` };
            }
            return { ok: true, message: 'Successfully connected to Gemini API.' };

        } catch (error) {
            return { ok: false, message: `Connection failed: ${error.message}` };
        }
    }

    prepareMessages(messages) {
        const geminiMessages = [];
        // Gemini API requires alternating user/model roles and uses 'model' instead of 'assistant'.
        let lastRole = null;
        for (const msg of messages) {
            // Skip empty messages
            if (!msg.content) continue;

            const currentRole = msg.role === 'assistant' ? 'model' : 'user';

            // Gemini API requires that the first message is from a 'user'
            if (geminiMessages.length === 0 && currentRole === 'model') {
                continue;
            }

            // Gemini API forbids two messages from the same role in a row.
            // Merge consecutive messages from the same role.
            if (currentRole === lastRole) {
                const lastMsg = geminiMessages.at(-1);
                if (lastMsg) {
                    lastMsg.parts[0].text += `\n\n${msg.content}`;
                }
            } else {
                geminiMessages.push({
                    role: currentRole,
                    parts: [{ text: msg.content }]
                });
                lastRole = currentRole;
            }
        }
        // Ensure the last message is from a user if the API requires it.
        // Some models might error if the conversation ends on a model turn.
        // For now, we assume the final user message handles this.

        return geminiMessages;
    }
}