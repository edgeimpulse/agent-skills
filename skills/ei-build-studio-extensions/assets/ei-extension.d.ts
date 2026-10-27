// Types for ei-extension.js. Keep this file next to the module.

export declare const DEFAULT_STUDIO_HOST: 'https://studio.edgeimpulse.com';
export declare const DEFAULT_INGESTION_HOST: 'https://ingestion.edgeimpulse.com';
export declare const POSTMESSAGE_PLACEHOLDER: '__POSTMESSAGE__';

export type ExtensionScope = 'project' | 'impulse' | 'dsp_block' | 'learn_block';
export type ScopeParam = 'impulseId' | 'dspId' | 'learnId';
export declare const SCOPE_PARAMS: Readonly<Record<ExtensionScope, readonly ScopeParam[]>>;

export type IngestionCategory = 'training' | 'validation' | 'testing' | 'post-processing' | 'split';
export declare const INGESTION_CATEGORIES: readonly IngestionCategory[];

export declare const SHARED_STATE_KEY_PATTERN: RegExp;
export declare const SHARED_STATE_MAX_BYTES: number;

export declare class UntrustedHostError extends Error {}
export declare class StudioHandshakeError extends Error {}
export declare class ApiError extends Error {
    constructor(message: string, status: number, service?: string);
    status: number;
    service: string;
}
export declare class SharedStateConflictError extends Error {
    constructor(key: string, detail?: string);
    key: string;
    detail?: string;
}
export declare class SharedStateUnavailableError extends Error {}

export declare function describeError(err: unknown): string;

/** `{ key: version }` for every shared state key on the project. */
export type SharedStateIndex = Record<string, number>;

export interface StudioContext {
    /** True when Studio loaded the page with `apiKey=__POSTMESSAGE__`. */
    keyViaPostMessage: boolean;
    projectId?: number;
    impulseId?: number;
    dspId?: number;
    learnId?: number;
    /** Raw value from the URL; validate before use (resolveHosts does). */
    studioHost?: string;
    ingestionHost?: string;
    sharedStateIndex: SharedStateIndex | null;
}

export declare function parseSharedStateIndex(raw: string | null | undefined): SharedStateIndex | null;
export declare function readStudioContext(search?: string): StudioContext;
export declare function missingScopeParams(context: StudioContext, scope: ExtensionScope): ScopeParam[];
export declare function isEmbedded(): boolean;

export interface TrustOptions {
    /** Exact extra origins allowed to receive the key, such as a self-hosted Studio. */
    trustedOrigins?: string[];
}

export interface HostOverrides {
    studioHost?: string;
    ingestionHost?: string;
}

export interface Hosts {
    /** Validated origin, no trailing slash. */
    studioHost: string;
    ingestionHost: string;
}

export declare function assertTrustedHost(url: string, label?: string, options?: TrustOptions): string;
export declare function resolveHosts(
    context?: Partial<StudioContext>, overrides?: HostOverrides, options?: TrustOptions): Hosts;

export interface Connection extends Hosts {
    apiKey: string;
    context: StudioContext;
    source: 'studio' | 'manual';
}

export declare function requestApiKeyFromStudio(
    studioHost: string, options?: { timeoutMs?: number }): Promise<string>;
export declare function connectInStudio(options?: {
    context?: StudioContext;
    trustedOrigins?: string[];
    timeoutMs?: number;
}): Promise<Connection | null>;
export declare function connectStandalone(apiKey: string, options?: {
    context?: StudioContext;
    overrides?: HostOverrides;
    trustedOrigins?: string[];
}): Connection;

export declare function startHeightReporter(
    studioHost: string, options?: { element?: Element }): () => void;

export declare function apiFetch(conn: Connection, path: `/api/${string}`, init?: RequestInit): Promise<Response>;
export declare function apiFetchJson<T = any>(
    conn: Connection, path: `/api/${string}`, init?: RequestInit): Promise<T>;

export type ProjectApiKeyRole = 'admin' | 'readonly' | 'ingestiononly' | 'ingestion_deployment';
export interface ApiKeyInfo {
    apiKeyId: number;
    projectId: number;
    role: ProjectApiKeyRole;
    /** Set for the short-lived keys Studio issues to extensions. */
    expires?: Date;
}
export declare function getApiKeyInfo(conn: Connection): Promise<ApiKeyInfo>;
export declare function resolveProjectId(conn: Connection): Promise<number>;

export declare function fetchObjectUrl(conn: Connection, url: string): Promise<string>;

export declare function uploadToIngestion(conn: Connection, options: {
    files: Blob | Blob[];
    category?: IngestionCategory;
    label?: string;
    headers?: HeadersInit;
}): Promise<any>;

export interface CustomDataFile {
    path: string;
    mimeType: string;
    size: number;
}
export declare function listLearnBlockCustomData(
    conn: Connection, projectId: number, learnId: number): Promise<CustomDataFile[]>;
export declare function readLearnBlockCustomData(
    conn: Connection, projectId: number, learnId: number, path: string): Promise<Response>;

export declare function isValidSharedStateKey(key: unknown): key is string;
export declare function sha256Hex(text: string): Promise<string>;

export interface StoredState {
    version: number;
    blob: Blob;
}

export type ConflictChoice = 'overwrite' | 'theirs';

export declare class SharedStateClient {
    constructor(conn: Connection, projectId: number, options?: { index?: SharedStateIndex | null });
    readonly conn: Connection;
    readonly projectId: number;
    index: SharedStateIndex | null;

    loadIndex(): Promise<SharedStateIndex>;
    version(key: string): number;
    read(key: string): Promise<StoredState | null>;
    readJson<T = unknown>(key: string, fallback?: T | null): Promise<T | null>;
    write(key: string, data: Blob | string, options?: { filename?: string; contentType?: string }): Promise<number>;
    writeJson(key: string, value: unknown): Promise<number>;
    writeResolving(key: string, data: Blob | string, options?: {
        onConflict?: (err: SharedStateConflictError) => ConflictChoice | Promise<ConflictChoice>;
        maxAttempts?: number;
        filename?: string;
        contentType?: string;
    }): Promise<{ outcome: 'saved' | 'kept-theirs'; version: number }>;
    delete(key: string): Promise<void>;
    watch(onChange: (changedKeys: string[]) => void | Promise<void>, options?: {
        intervalMs?: number;
        onError?: (err: unknown) => void;
    }): () => void;
}
