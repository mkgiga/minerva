import { BaseProvider } from './base.js';

// for example talking to a local inference server like ollama or lmstudio on 'http://localhost:1234/v1'
export class OpenAIV1Provider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    static getProviderSchema() {
        // This provider uses the default schema which includes url and apiKey.
        // We explicitly define it here for clarity, but `return super.getProviderSchema()` would also work.
        return [
            ...super.getProviderSchema(),
        ];
    }
    
    static getGenerationParametersSchema() {
        return [
            { name: 'baseUrl', label: 'API URL', type: 'text', required: true, placeholder: 'e.g., http://localhost:1234/v1' },
            { name: 'apiKey', label: 'API Key', type: 'password', required: false, placeholder: '' },
            { name: 'model', label: 'Model', type: 'text', placeholder: 'e.g., gpt-4' },
            { name: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
            { name: 'top_p', label: 'Top P', type: 'range', min: 0, max: 1, step: 0.05, defaultValue: 0.95 },
            { name: 'max_tokens', label: 'Max Tokens', type: 'number', min: 1, step: 1, defaultValue: 2048 },
            { name: 'stop', label: 'Stop Sequences', type: 'text', placeholder: 'e.g., "Human:, AI:"' },
        ];
    }
    
    async *prompt(messages, options = {}) {
        const { baseUrl, apiKey } = this.config;
        const { systemInstruction, stream = true, signal, ...genParams } = options;

        // Prepare messages for the API call
        const apiMessages = this.prepareMessages(messages);

        const bodyMessages = [];
        if (systemInstruction) {
            bodyMessages.push({ role: 'system', content: systemInstruction });
        }
        bodyMessages.push(...apiMessages);
        
        const body = {
            messages: bodyMessages,
            stream,
            ...genParams
        };

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`OpenAI API Error: ${errorBody.error?.message || response.statusText}`);
        }
        
        if (!stream || !response.body) {
            const data = await response.json();
            yield data.choices[0].message.content;
            return;
        }

        // Handle streaming response
        for await (const chunk of response.body) {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data.trim() === '[DONE]') {
                        return; // Stream finished
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const token = parsed.choices?.[0]?.delta?.content;
                        if (token) {
                            yield token;
                        }
                    } catch (error) {
                        console.error('Error parsing OpenAI stream chunk:', error);
                    }
                }
            }
        }
    }

    async healthCheck() {
        const { baseUrl, apiKey } = this.config;
        try {
            // A common endpoint for health checks is listing models
            const response = await fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const message = errorBody.error?.message || `HTTP ${response.status}`;
                return { ok: false, message: `Connection failed: ${message}` };
            }
            
            const data = await response.json();
            const modelCount = data.data?.length || 0;
            return { ok: true, message: `Successfully connected. Found ${modelCount} models.`, data: data.data };

        } catch (error) {
            return { ok: false, message: `Connection failed: ${error.message}` };
        }
    }

    /**
     * Prepares standard messages into OpenAI API compatible format.
     * OpenAI API handles consecutive roles fine, so we just return the messages.
     *
     * @param {Array<Object>} messages - The message history for the chat.
     * @returns {Array<Object>} The OpenAI-compatible message array.
     */
    prepareMessages(messages) {
        return messages.map(msg => ({ role: msg.role, content: msg.content }));
    }
}