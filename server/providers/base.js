/**
 * Abstract base class for all LLM connection adapters.
 * Defines the required interface for prompting and health checks.
 * @todo: Refactor to use generation parameter schemas for specific models. This means each model offered by a provider must be known in advance and be manually updated in the code whenever a new model is added, changed, or removed from the provider's API.
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
     * Returns a list of all available models for this provider.
     * This method must be overridden by concrete adapter implementations.
     * @returns {Promise<Array<Object>>} A promise that resolves to an array of model objects.
     */
    async getModels() {
        throw new Error("Method 'getModels()' must be implemented.");
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

export class GenerationParameter {
    
    /** Name of the parameter, e.g., 'temperature' */
    name;

    /** Form control type for the parameter, e.g., 'range', 'number', 'text' */
    type;

    /** Human-readable label for the parameter, e.g., 'Temperature' */
    label;

    constructor(name, label, type, options = {}) {
        this.name = name; // e.g., 'temperature'
        this.label = label; // e.g., 'Temperature'
        this.type = type; // e.g., 'range', 'number', 'text'
        this.options = options; // Additional options like min, max, step, defaultValue
    }
}

/**
 * Sometimes, providers offer different models, which may only support a subset of the generation parameters.
 * @todo: Intregrate this with the provider classes instead of using a single global parameter schema for all of the provider's models.
 */
export class ModelSchema {
    
    /** Name of the model, i.e `gemini-pro-flash-2.5` */
    name;

    /**
     * 
     * @returns {Array<GenerationParameter>} An array of GenerationParameter objects defining the model's supported parameters.
     */
    getGenerationParametersSchema() {
        return [];
    }
}