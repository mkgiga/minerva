/**
 * SceneBlockParser - Safe parser for Scene Block array format.
 *
 * Parses function-call-style scene blocks without using eval().
 * Designed to handle AI-generated content that may be malformed.
 *
 * Example input:
 * [
 *   text("You push open the door."),
 *   speech("john", "Hello there!", { expression: "happy" }),
 *   pause(1.5)
 * ]
 */

export class SceneBlockParser {
    static BLOCK_TYPES = [
        'text', 'speech', 'pause', 'image', 'webview',
        'noop_continue', 'unformatted', 'prompt'
    ];

    constructor() {
        this.reset();
    }

    reset() {
        this.errors = [];
    }

    /**
     * Parse complete scene content
     * @param {string} content - The full response content
     * @returns {{ blocks: Array, errors: Array }}
     */
    parse(content) {
        this.reset();

        if (!content || typeof content !== 'string') {
            return { blocks: [], errors: ['No content to parse'] };
        }

        const cleaned = this.#cleanContent(content);

        // Check if content looks like our format (starts with [ after cleaning)
        if (!cleaned.trim().startsWith('[')) {
            return { blocks: [], errors: ['Content does not start with array bracket'] };
        }

        const blocks = this.#parseBlocks(cleaned);
        return { blocks, errors: this.errors };
    }

    /**
     * Check if content appears to be in the new block format
     * @param {string} content
     * @returns {boolean}
     */
    static looksLikeBlockFormat(content) {
        if (!content) return false;
        const cleaned = content.trim()
            .replace(/^```(?:javascript|js)?\s*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
        return cleaned.startsWith('[') && /\b(text|speech|pause|image|webview|noop_continue|unformatted|prompt)\s*\(/.test(cleaned);
    }

    #cleanContent(content) {
        return content.trim()
            .replace(/^```(?:javascript|js)?\s*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
    }

    #parseBlocks(content) {
        const blocks = [];

        // Remove outer array brackets
        let inner = content.trim();
        if (inner.startsWith('[')) inner = inner.slice(1);
        if (inner.endsWith(']')) inner = inner.slice(0, -1);
        inner = inner.trim();

        if (!inner) return blocks;

        // Tokenize into function calls
        const functionCalls = this.#tokenizeFunctionCalls(inner);

        for (const call of functionCalls) {
            const block = this.#parseFunctionCall(call);
            if (block) {
                blocks.push(block);
            }
        }

        return blocks;
    }

    /**
     * Split content into individual function calls, respecting nested structures
     */
    #tokenizeFunctionCalls(content) {
        const calls = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = null;
        let escaped = false;
        let inTemplate = false;
        let templateDepth = 0;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const prevChar = i > 0 ? content[i - 1] : '';

            if (escaped) {
                current += char;
                escaped = false;
                continue;
            }

            if (char === '\\') {
                current += char;
                escaped = true;
                continue;
            }

            // Handle template literals
            if (char === '`' && !inString) {
                inTemplate = !inTemplate;
                current += char;
                continue;
            }

            if (inTemplate) {
                if (char === '$' && content[i + 1] === '{') {
                    templateDepth++;
                } else if (char === '}' && templateDepth > 0) {
                    templateDepth--;
                }
                current += char;
                continue;
            }

            // Handle regular strings
            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
                current += char;
                continue;
            }

            if (char === stringChar && inString) {
                inString = false;
                stringChar = null;
                current += char;
                continue;
            }

            if (inString) {
                current += char;
                continue;
            }

            // Track parentheses and brackets depth
            if (char === '(' || char === '[' || char === '{') {
                depth++;
                current += char;
                continue;
            }

            if (char === ')' || char === ']' || char === '}') {
                depth--;
                current += char;
                continue;
            }

            // Split on comma at depth 0
            if (char === ',' && depth === 0) {
                const trimmed = current.trim();
                if (trimmed) {
                    calls.push(trimmed);
                }
                current = '';
                continue;
            }

            current += char;
        }

        // Don't forget the last call
        const trimmed = current.trim();
        if (trimmed) {
            calls.push(trimmed);
        }

        return calls;
    }

    /**
     * Parse a single function call like: text("content", { icon: "book" })
     */
    #parseFunctionCall(call) {
        // Match function name and arguments
        const match = call.match(/^(\w+)\s*\(([\s\S]*)\)$/);
        if (!match) {
            this.errors.push(`Invalid function call syntax: ${call.slice(0, 50)}...`);
            return null;
        }

        const [, funcName, argsStr] = match;

        // Validate function name
        if (!SceneBlockParser.BLOCK_TYPES.includes(funcName)) {
            this.errors.push(`Unknown block type: ${funcName}`);
            return null;
        }

        // Parse arguments
        const args = this.#parseArguments(argsStr);

        // Build block object based on type
        return this.#buildBlock(funcName, args);
    }

    /**
     * Parse function arguments, handling strings, numbers, arrays, and objects
     */
    #parseArguments(argsStr) {
        const args = [];
        if (!argsStr.trim()) return args;

        const tokens = this.#tokenizeArguments(argsStr);

        for (const token of tokens) {
            const parsed = this.#parseValue(token);
            args.push(parsed);
        }

        return args;
    }

    /**
     * Tokenize arguments, splitting on commas while respecting nesting
     */
    #tokenizeArguments(argsStr) {
        const tokens = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = null;
        let escaped = false;
        let inTemplate = false;
        let templateDepth = 0;

        for (let i = 0; i < argsStr.length; i++) {
            const char = argsStr[i];

            if (escaped) {
                current += char;
                escaped = false;
                continue;
            }

            if (char === '\\') {
                current += char;
                escaped = true;
                continue;
            }

            // Handle template literals
            if (char === '`' && !inString) {
                inTemplate = !inTemplate;
                current += char;
                continue;
            }

            if (inTemplate) {
                if (char === '$' && argsStr[i + 1] === '{') {
                    templateDepth++;
                } else if (char === '}' && templateDepth > 0) {
                    templateDepth--;
                }
                current += char;
                continue;
            }

            // Handle regular strings
            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
                current += char;
                continue;
            }

            if (char === stringChar && inString) {
                inString = false;
                stringChar = null;
                current += char;
                continue;
            }

            if (inString) {
                current += char;
                continue;
            }

            // Track depth
            if (char === '(' || char === '[' || char === '{') {
                depth++;
                current += char;
                continue;
            }

            if (char === ')' || char === ']' || char === '}') {
                depth--;
                current += char;
                continue;
            }

            // Split on comma at depth 0
            if (char === ',' && depth === 0) {
                const trimmed = current.trim();
                if (trimmed) {
                    tokens.push(trimmed);
                }
                current = '';
                continue;
            }

            current += char;
        }

        const trimmed = current.trim();
        if (trimmed) {
            tokens.push(trimmed);
        }

        return tokens;
    }

    /**
     * Parse a single value (string, number, array, or object)
     */
    #parseValue(token) {
        const trimmed = token.trim();

        // Number
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return parseFloat(trimmed);
        }

        // Boolean
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;

        // Null/undefined
        if (trimmed === 'null') return null;
        if (trimmed === 'undefined') return undefined;

        // String (double quotes)
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return this.#parseString(trimmed.slice(1, -1), '"');
        }

        // String (single quotes)
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
            return this.#parseString(trimmed.slice(1, -1), "'");
        }

        // Template literal
        if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
            return this.#parseTemplateString(trimmed.slice(1, -1));
        }

        // Array
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            return this.#parseArray(trimmed);
        }

        // Object
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return this.#parseObject(trimmed);
        }

        // Unknown - return as-is (could be an identifier)
        return trimmed;
    }

    /**
     * Parse a string, handling escape sequences
     */
    #parseString(str, quote) {
        let result = '';
        let escaped = false;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (escaped) {
                switch (char) {
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case '\\': result += '\\'; break;
                    case '"': result += '"'; break;
                    case "'": result += "'"; break;
                    default: result += char;
                }
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            result += char;
        }

        return result;
    }

    /**
     * Parse template string (simplified - no interpolation)
     */
    #parseTemplateString(str) {
        // For now, treat template strings as regular strings
        // We don't support ${} interpolation for security
        return str;
    }

    /**
     * Parse an array literal
     */
    #parseArray(str) {
        const inner = str.slice(1, -1).trim();
        if (!inner) return [];

        const tokens = this.#tokenizeArguments(inner);
        return tokens.map(t => this.#parseValue(t));
    }

    /**
     * Parse an object literal safely (only string keys, limited value types)
     */
    #parseObject(str) {
        const inner = str.slice(1, -1).trim();
        if (!inner) return {};

        const obj = {};
        const pairs = this.#tokenizeArguments(inner);

        for (const pair of pairs) {
            const colonIndex = this.#findUnquotedColon(pair);
            if (colonIndex === -1) {
                this.errors.push(`Invalid object property: ${pair}`);
                continue;
            }

            let key = pair.slice(0, colonIndex).trim();
            const value = pair.slice(colonIndex + 1).trim();

            // Remove quotes from key if present
            if ((key.startsWith('"') && key.endsWith('"')) ||
                (key.startsWith("'") && key.endsWith("'"))) {
                key = key.slice(1, -1);
            }

            obj[key] = this.#parseValue(value);
        }

        return obj;
    }

    /**
     * Find the first colon that's not inside a string
     */
    #findUnquotedColon(str) {
        let inString = false;
        let stringChar = null;
        let escaped = false;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
                continue;
            }

            if (char === stringChar && inString) {
                inString = false;
                stringChar = null;
                continue;
            }

            if (char === ':' && !inString) {
                return i;
            }
        }

        return -1;
    }

    /**
     * Build a block object from parsed function name and arguments
     */
    #buildBlock(type, args) {
        switch (type) {
            case 'text':
                return this.#buildTextBlock(args);
            case 'unformatted':
                return this.#buildUnformattedBlock(args);
            case 'speech':
                return this.#buildSpeechBlock(args);
            case 'pause':
                return this.#buildPauseBlock(args);
            case 'image':
                return this.#buildImageBlock(args);
            case 'webview':
                return this.#buildWebviewBlock(args);
            case 'noop_continue':
                return { type: 'noop_continue' };
            case 'prompt':
                return this.#buildPromptBlock(args);
            default:
                return null;
        }
    }

    #buildTextBlock(args) {
        // text("content") or text("content", { icon: "book" })
        const block = { type: 'text', content: '' };

        if (args.length >= 1) {
            block.content = String(args[0] ?? '');
        }

        if (args.length >= 2 && typeof args[1] === 'object') {
            if (args[1].icon) block.icon = args[1].icon;
        }

        return block;
    }

    #buildUnformattedBlock(args) {
        // unformatted("content") or unformatted("content", { icon: "notes" })
        const block = { type: 'unformatted', content: '' };

        if (args.length >= 1) {
            block.content = String(args[0] ?? '');
        }

        if (args.length >= 2 && typeof args[1] === 'object') {
            if (args[1].icon) block.icon = args[1].icon;
        }

        return block;
    }

    #buildSpeechBlock(args) {
        // speech("charId", "dialogue")
        // speech("charId", "dialogue", { expression: "happy", tone: "yell" })
        // speech("dialogue", { name: "Custom Name" })
        const block = { type: 'speech', content: '' };

        if (args.length === 0) {
            return block;
        }

        if (args.length === 1) {
            // Just content
            block.content = String(args[0] ?? '');
        } else if (args.length === 2) {
            if (typeof args[1] === 'object') {
                // speech("content", { name: "..." }) format
                block.content = String(args[0] ?? '');
                const opts = args[1];
                if (opts.name) block.name = opts.name;
                if (opts.id) block.id = opts.id;
                if (opts.expression) block.expression = opts.expression;
                if (opts.tone) block.tone = opts.tone;
            } else {
                // speech("charId", "dialogue") format
                block.id = String(args[0] ?? '');
                block.content = String(args[1] ?? '');
            }
        } else if (args.length >= 3) {
            // speech("charId", "dialogue", { opts })
            block.id = String(args[0] ?? '');
            block.content = String(args[1] ?? '');
            if (typeof args[2] === 'object') {
                const opts = args[2];
                if (opts.name) block.name = opts.name;
                if (opts.expression) block.expression = opts.expression;
                if (opts.tone) block.tone = opts.tone;
            }
        }

        return block;
    }

    #buildPauseBlock(args) {
        // pause(1.5)
        const block = { type: 'pause', duration: 0 };

        if (args.length >= 1) {
            block.duration = parseFloat(args[0]) || 0;
        }

        return block;
    }

    #buildImageBlock(args) {
        // image({ src: "url", from: "charId", caption: "text" })
        // image("url") - simple form
        // image("url", { from: "charId", caption: "text" })
        const block = { type: 'image' };

        if (args.length === 0) {
            return block;
        }

        if (args.length === 1) {
            if (typeof args[0] === 'object') {
                const opts = args[0];
                if (opts.src) block.src = opts.src;
                if (opts.from) block.from = opts.from;
                if (opts.caption) block.caption = opts.caption;
                if (opts.icon) block.icon = opts.icon;
            } else {
                block.src = String(args[0]);
            }
        } else if (args.length >= 2) {
            block.src = String(args[0]);
            if (typeof args[1] === 'object') {
                const opts = args[1];
                if (opts.from) block.from = opts.from;
                if (opts.caption) block.caption = opts.caption;
                if (opts.icon) block.icon = opts.icon;
            }
        }

        return block;
    }

    #buildWebviewBlock(args) {
        // webview("<html>")
        // webview("<html>", { css: "...", script: "..." })
        const block = { type: 'webview', html: '' };

        if (args.length >= 1) {
            block.html = String(args[0] ?? '');
        }

        if (args.length >= 2 && typeof args[1] === 'object') {
            if (args[1].css) block.css = args[1].css;
            if (args[1].script) block.script = args[1].script;
        }

        return block;
    }

    #buildPromptBlock(args) {
        // prompt("info text", ["choice1", "choice2"])
        // prompt(["choice1", "choice2"])
        const block = { type: 'prompt', info: '', choices: [] };

        if (args.length === 0) {
            return block;
        }

        if (args.length === 1) {
            if (Array.isArray(args[0])) {
                block.choices = args[0].map(c => String(c));
            } else {
                block.info = String(args[0]);
            }
        } else if (args.length >= 2) {
            block.info = String(args[0] ?? '');
            if (Array.isArray(args[1])) {
                block.choices = args[1].map(c => String(c));
            }
        }

        return block;
    }
}
