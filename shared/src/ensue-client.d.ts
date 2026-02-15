/**
 * Ensue Memory Network API Client (JSON-RPC 2.0 over SSE)
 *
 * All operations use POST to https://api.ensue-network.ai/
 * Responses are Server-Sent Events with JSON-RPC payloads.
 */
export declare class EnsueClient {
    private client;
    private requestId;
    constructor(apiKey: string);
    /**
     * Send a JSON-RPC request and parse the SSE response
     */
    private rpc;
    /**
     * Extract structured content or text content from response
     */
    private extractData;
    /**
     * Create a new memory entry
     */
    createMemory(key: string, value: string | object, description?: string): Promise<void>;
    /**
     * Read a single memory value by key
     */
    readMemory(key: string): Promise<string | null>;
    /**
     * Read multiple memory values by keys
     */
    readMultiple(keys: string[]): Promise<Record<string, string>>;
    /**
     * Update an existing memory value
     */
    updateMemory(key: string, value: string | object): Promise<void>;
    /**
     * Delete memory entries
     */
    deleteMemory(key: string): Promise<void>;
    /**
     * List memory keys with optional prefix filter
     */
    listKeys(prefix?: string, limit?: number): Promise<string[]>;
    /**
     * Search memories by query (semantic search)
     */
    searchMemories(query: string, limit?: number): Promise<any[]>;
    /**
     * Clear all memories with a given prefix
     */
    clearPrefix(prefix: string): Promise<void>;
    private isNotFoundError;
    private handleError;
}
/**
 * Create an Ensue client instance
 */
export declare function createEnsueClient(apiKey?: string): EnsueClient;
//# sourceMappingURL=ensue-client.d.ts.map