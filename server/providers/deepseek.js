import { BaseProvider as BaseProvider } from "./base";

export class DeepSeekProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    static getProviderSchema() {
        return [
            ...super.getProviderSchema(),
        ];
    }

    static getGenerationParametersSchema() {
        return [
            { name: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
            { name: 'top_p', label: 'Top P', type: 'range', min: 0, max: 1, step: 0.05, defaultValue: 0.95 },
            { name: 'max_tokens', label: 'Max Tokens', type: 'number', min: 1, step: 1, defaultValue: 2048 },
            { name: 'stop', label: 'Stop Sequences', type: 'text', placeholder: 'e.g., "Human:, AI:"' },
        ];
    }
}