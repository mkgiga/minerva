/**
 * Abstract base class for all LLM connection adapters.
 * Defines the required interface for prompting and health checks.
 */
export class BaseAdapter {
    constructor(config) {
        if (this.constructor === BaseAdapter) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        // Config includes name, id, url, apiKey, adapter type
        this.config = config;
    }

    /**
     * Returns a schema defining the configuration fields for this adapter.
     * This schema is used by the frontend to dynamically generate configuration forms.
     * @returns {Array<object>} An array of field definition objects.
     */
    static getAdapterSchema() {
        return [
            { name: 'url', label: 'API URL', type: 'text', required: true, placeholder: 'e.g., http://localhost:1234/v1' },
            { name: 'apiKey', label: 'API Key', type: 'password', required: false, placeholder: 'sk-...' },
        ];
    }

    /**
     * Returns a schema for the generation parameters supported by this adapter.
     * @returns {Array<object>} An array of parameter definition objects for building forms.
     */
    static getGenerationParametersSchema() {
        return [];
    }

    /**
     * Sends a prompt to the LLM and streams the response.
     * @param {Array<Object>} messages - The full, ordered list of messages for the prompt.
     * @param {Object} [options={}] - Additional options for the prompt.
     * @param {string} [options.systemInstruction] - An optional system-level instruction/pre-prompt.
     * @param {number} [options.temperature] - Controls the randomness of the output.
     * @returns {AsyncGenerator<string>} An async generator that yields response tokens.
     */
    async *prompt(messages, options = {}) {
        throw new Error("Method 'prompt()' must be implemented.");
    }

    /**
     * Checks if the connection settings (URL, API Key) are valid.
     * @returns {Promise<{ok: boolean, message: string, data?: any}>}
     */
    async healthCheck() {
        throw new Error("Method 'healthCheck()' must be implemented.");
    }

    /**
     * Prepares the message history for the specific API provider's format.
     * Providers might have different role names or content structures,
     * and may require merging consecutive messages of the same role.
     * This method must be overridden by concrete adapter implementations.
     * @param {Array<Object>} messages - The standard message array [{ role: 'user'|'assistant', content: '...' }].
     * @returns {Array<Object>} The provider-specific message array compatible with their API.
     */
    prepareMessages(messages) {
        throw new Error("Method 'prepareMessages()' must be implemented by concrete adapters.");
    }
}