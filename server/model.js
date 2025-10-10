// because different models, even those from the same provider, can have different parameter schemas, it's important to define these schemas clearly.

/**
 * Represents a type of large language model that has its own set of parameters.
 * @abstract
 */
export class LLM {
    /**
     * The unique name of the LLM, usually the file name or the name listed by the provider (like 'gemini-pro-2.5')
     * @type {string}
     */
    name = '';

    /**
     * Large language models have their own set of parameters that influence their behavior and output. Common parameters include `temperature`, `max_tokens`, `top_p` (...)
     * This schema defines the expected parameters for the model so that controls can be rendered correctly in the UI.
     */
    paramSchema = {};
}