"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnsueClient = void 0;
exports.createEnsueClient = createEnsueClient;
const axios_1 = __importDefault(require("axios"));
/**
 * Ensue Memory Network API Client (JSON-RPC 2.0 over SSE)
 *
 * All operations use POST to https://api.ensue-network.ai/
 * Responses are Server-Sent Events with JSON-RPC payloads.
 */
class EnsueClient {
    constructor(apiKey) {
        this.requestId = 0;
        if (!apiKey) {
            throw new Error('Ensue API key is required');
        }
        this.client = axios_1.default.create({
            baseURL: 'https://api.ensue-network.ai/',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
            responseType: 'text', // SSE returns text/event-stream
        });
    }
    /**
     * Send a JSON-RPC request and parse the SSE response
     */
    async rpc(method, args) {
        const id = ++this.requestId;
        const response = await this.client.post('/', {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: method,
                arguments: args,
            },
            id,
        });
        // Parse SSE response: "data: {json}\n\n"
        const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const lines = raw.split('\n').filter((l) => l.startsWith('data: '));
        if (lines.length === 0)
            return null;
        // Take the last data line (final result)
        const jsonStr = lines[lines.length - 1].replace(/^data: /, '');
        const parsed = JSON.parse(jsonStr);
        // Check for JSON-RPC error (top-level error field)
        if (parsed?.error) {
            throw new Error(parsed.error.message || 'Ensue API error');
        }
        // Check for application-level error
        if (parsed?.result?.isError) {
            throw new Error(parsed.result.content?.[0]?.text || 'Ensue API error');
        }
        return parsed;
    }
    /**
     * Extract structured content or text content from response
     */
    extractData(response) {
        if (!response?.result)
            return null;
        // Prefer structuredContent for typed data
        if (response.result.structuredContent !== undefined) {
            return response.result.structuredContent;
        }
        // Fallback to text content
        const textContent = response.result.content?.find((c) => c.type === 'text');
        if (textContent?.text) {
            try {
                return JSON.parse(textContent.text);
            }
            catch {
                return textContent.text;
            }
        }
        return null;
    }
    /**
     * Create a new memory entry
     */
    async createMemory(key, value, description) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        try {
            await this.rpc('create_memory', {
                items: [{
                        key_name: key,
                        value: valueStr,
                        description: description || `Memory at ${key}`,
                    }],
            });
        }
        catch (error) {
            this.handleError('createMemory', key, error);
        }
    }
    /**
     * Read a single memory value by key
     */
    async readMemory(key) {
        try {
            const response = await this.rpc('get_memory', { key_names: [key] });
            const data = this.extractData(response);
            if (!data)
                return null;
            // Response: { results: [{ key_name, value, ... }] } or array
            if (Array.isArray(data)) {
                return data[0]?.value || null;
            }
            if (data.results && Array.isArray(data.results)) {
                return data.results[0]?.value || null;
            }
            if (data.value !== undefined)
                return data.value;
            return null;
        }
        catch (error) {
            if (this.isNotFoundError(error))
                return null;
            this.handleError('readMemory', key, error);
            return null;
        }
    }
    /**
     * Read multiple memory values by keys
     */
    async readMultiple(keys) {
        const result = {};
        try {
            const response = await this.rpc('get_memory', { key_names: keys });
            const data = this.extractData(response);
            if (!data)
                return result;
            const items = Array.isArray(data) ? data : (data.results || []);
            for (const item of items) {
                if (item?.key_name && item?.value !== undefined) {
                    result[item.key_name] = item.value;
                }
            }
        }
        catch (error) {
            this.handleError('readMultiple', keys.join(', '), error);
        }
        return result;
    }
    /**
     * Update an existing memory value
     */
    async updateMemory(key, value) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        try {
            await this.rpc('update_memory', {
                key_name: key,
                value: valueStr,
            });
        }
        catch (error) {
            // If update fails (memory doesn't exist), try creating it
            const errMsg = error instanceof Error ? error.message : '';
            if (this.isNotFoundError(error) || errMsg.includes('not found') || errMsg.includes('does not exist')) {
                await this.createMemory(key, valueStr);
            }
            else {
                this.handleError('updateMemory', key, error);
            }
        }
    }
    /**
     * Delete memory entries
     */
    async deleteMemory(key) {
        try {
            await this.rpc('delete_memory', { key_names: [key] });
        }
        catch (error) {
            // Ignore not-found errors on delete
            if (!this.isNotFoundError(error)) {
                this.handleError('deleteMemory', key, error);
            }
        }
    }
    /**
     * List memory keys with optional prefix filter
     */
    async listKeys(prefix, limit = 100) {
        try {
            const args = { limit };
            if (prefix)
                args.prefix = `${prefix}%`;
            const response = await this.rpc('list_keys', args);
            const data = this.extractData(response);
            if (!data)
                return [];
            const keys = data.keys || data;
            if (Array.isArray(keys)) {
                return keys.map((item) => typeof item === 'string' ? item : item?.key_name).filter(Boolean);
            }
            return [];
        }
        catch (error) {
            this.handleError('listKeys', prefix || '', error);
            return [];
        }
    }
    /**
     * Search memories by query (semantic search)
     */
    async searchMemories(query, limit = 5) {
        try {
            const response = await this.rpc('search_memories', { query, limit });
            const data = this.extractData(response);
            return Array.isArray(data) ? data : (data?.results || []);
        }
        catch (error) {
            this.handleError('searchMemories', query, error);
            return [];
        }
    }
    /**
     * Clear all memories with a given prefix
     */
    async clearPrefix(prefix) {
        try {
            const keys = await this.listKeys(prefix);
            if (keys.length > 0) {
                await this.rpc('delete_memory', { key_names: keys });
                console.log(`Cleared ${keys.length} memories with prefix: ${prefix}`);
            }
        }
        catch (error) {
            this.handleError('clearPrefix', prefix, error);
        }
    }
    isNotFoundError(error) {
        if (axios_1.default.isAxiosError(error)) {
            return error.response?.status === 404;
        }
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            return msg.includes('not found') || msg.includes('does not exist');
        }
        return false;
    }
    handleError(operation, key, error) {
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            console.error(`Ensue ${operation} error for key "${key}":`, axiosError.response?.status, typeof axiosError.response?.data === 'string'
                ? axiosError.response.data.substring(0, 200)
                : axiosError.message);
        }
        else if (error instanceof Error) {
            console.error(`Ensue ${operation} error for key "${key}":`, error.message);
        }
        else {
            console.error(`Ensue ${operation} error for key "${key}":`, error);
        }
    }
}
exports.EnsueClient = EnsueClient;
/**
 * Create an Ensue client instance
 */
function createEnsueClient(apiKey) {
    const key = apiKey || process.env.ENSUE_API_KEY || process.env.ENSUE_TOKEN;
    if (!key) {
        throw new Error('Ensue API key not provided and ENSUE_API_KEY/ENSUE_TOKEN environment variable not set');
    }
    return new EnsueClient(key);
}
//# sourceMappingURL=ensue-client.js.map