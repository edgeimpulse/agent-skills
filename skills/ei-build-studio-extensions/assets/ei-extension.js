/**
 * ei-extension.js: framework-agnostic helpers for Edge Impulse Studio extensions.
 *
 * Zero dependencies, one ES module. Copy it into any browser app (plain HTML,
 * React, Vue, Svelte, Angular, a Pyodide host, ...) and import what you need.
 * Only startHeightReporter() touches the DOM. Types: ei-extension.d.ts.
 *
 *   readStudioContext()          the context Studio appends to your URL
 *   connectInStudio()            postMessage API-key handshake, hosts validated
 *   connectStandalone()          same connection shape from a pasted key
 *   assertTrustedHost()          allowlist for every host the key is sent to
 *   startHeightReporter()        let Studio size the iframe to your content
 *   apiFetch() / apiFetchJson()  raw Studio API calls with the key
 *   getApiKeyInfo()              project, role and expiry of the current key
 *   fetchObjectUrl()             authenticated Studio media for <img>/<audio>
 *   uploadToIngestion()          upload files through the Ingestion API
 *   listLearnBlockCustomData()   files a learn block wrote to /home/custom_data
 *   SharedStateClient            versioned per-project extension storage
 *
 * The API key is a credential: never persist it, log it, or put it in a URL.
 */

export const DEFAULT_STUDIO_HOST = 'https://studio.edgeimpulse.com';
export const DEFAULT_INGESTION_HOST = 'https://ingestion.edgeimpulse.com';
export const POSTMESSAGE_PLACEHOLDER = '__POSTMESSAGE__';

export const SCOPE_PARAMS = Object.freeze({
    project: [],
    impulse: ['impulseId'],
    dsp_block: ['impulseId', 'dspId'],
    learn_block: ['impulseId', 'learnId'],
});

export const INGESTION_CATEGORIES = Object.freeze(
    ['training', 'validation', 'testing', 'post-processing', 'split']);

export const SHARED_STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,78}[A-Za-z0-9]$/;
export const SHARED_STATE_MAX_BYTES = 100 * 1024 * 1024;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UntrustedHostError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UntrustedHostError';
    }
}

export class StudioHandshakeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StudioHandshakeError';
    }
}

export class ApiError extends Error {
    constructor(message, status, service = 'Studio API') {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.service = service;
    }
}

export class SharedStateConflictError extends Error {
    constructor(key, detail) {
        super(`Shared state "${key}" was changed by someone else`);
        this.name = 'SharedStateConflictError';
        this.key = key;
        this.detail = detail;
    }
}

export class SharedStateUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SharedStateUnavailableError';
    }
}

/**
 * A message fit for the UI. The edge-impulse-api bindings reject some
 * failures (such as the postMessage timeout) with a plain string.
 */
export function describeError(err) {
    if (typeof err === 'string') return err;
    if (err instanceof ApiError && err.status === 401) {
        return `${err.message}. The API key expired or was revoked: ` +
            'reload the page in Studio, or enter a new key.';
    }
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function toId(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Parses Studio's `sharedState` parameter, a JSON object of `{ key: version }`. */
export function parseSharedStateIndex(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const index = {};
        for (const [key, version] of Object.entries(parsed)) {
            if (typeof version === 'number' && Number.isFinite(version)) index[key] = version;
        }
        return index;
    } catch {
        return null;
    }
}

/**
 * Reads the context Studio appends to the extension URL. Call it once at
 * startup, before a client-side router rewrites the URL.
 */
export function readStudioContext(search = globalThis.location?.search ?? '') {
    const p = new URLSearchParams(search);
    return {
        keyViaPostMessage: p.get('apiKey') === POSTMESSAGE_PLACEHOLDER,
        projectId: toId(p.get('projectId')),
        impulseId: toId(p.get('impulseId')),
        dspId: toId(p.get('dspId')),
        learnId: toId(p.get('learnId')),
        studioHost: p.get('studioHost') || undefined,
        ingestionHost: p.get('ingestionHost') || undefined,
        sharedStateIndex: parseSharedStateIndex(p.get('sharedState')),
    };
}

/** Names of the IDs a scope needs that the context doesn't have. */
export function missingScopeParams(context, scope) {
    const required = SCOPE_PARAMS[scope];
    if (!required) throw new Error(`Unknown scope "${scope}"`);
    return required.filter((name) => context[name] === undefined);
}

/** True when the page runs inside a frame, such as Studio's extension iframe. */
export function isEmbedded() {
    return typeof window !== 'undefined' && window.parent !== window;
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

/**
 * Throws unless `url` is a host the API key may be sent to, and returns its
 * origin. Allowed: HTTPS on edgeimpulse.com or a subdomain, loopback while the
 * extension itself runs on loopback, or an exact origin in `trustedOrigins`.
 */
export function assertTrustedHost(url, label = 'Host', { trustedOrigins = [] } = {}) {
    let u;
    try {
        u = new URL(url);
    } catch {
        throw new UntrustedHostError(`${label} is not a valid URL`);
    }
    if (u.username || u.password) {
        throw new UntrustedHostError(`${label} must not contain credentials`);
    }

    const isEdgeImpulse = u.protocol === 'https:' &&
        (u.hostname === 'edgeimpulse.com' || u.hostname.endsWith('.edgeimpulse.com'));
    const here = globalThis.location?.hostname;
    const isLocalDev = LOOPBACK_HOSTNAMES.has(u.hostname) &&
        here !== undefined && LOOPBACK_HOSTNAMES.has(here);
    const trusted = trustedOrigins.map((o) => new URL(o).origin);

    if (!isEdgeImpulse && !isLocalDev && !trusted.includes(u.origin)) {
        throw new UntrustedHostError(`Refusing to send the API key to ${u.origin} (${label})`);
    }
    return u.origin;
}

/**
 * Picks and validates both hosts: URL parameter, then override (for example
 * from a connect form), then the public default.
 */
export function resolveHosts(context = {}, overrides = {}, options = {}) {
    return {
        studioHost: assertTrustedHost(
            context.studioHost || overrides.studioHost || DEFAULT_STUDIO_HOST, 'Studio host', options),
        ingestionHost: assertTrustedHost(
            context.ingestionHost || overrides.ingestionHost || DEFAULT_INGESTION_HOST, 'Ingestion host', options),
    };
}

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------

/**
 * Asks the embedding Studio page for the API key. Accepts only a reply from
 * the parent frame on the Studio origin. Validate `studioHost` first.
 */
export function requestApiKeyFromStudio(studioHost, { timeoutMs = 10_000 } = {}) {
    if (!isEmbedded()) {
        return Promise.reject(new StudioHandshakeError('Not running inside Studio'));
    }
    const studioOrigin = new URL(studioHost).origin;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            reject(new StudioHandshakeError(
                'Studio did not send an API key. Reload the page in Studio.'));
        }, timeoutMs);

        function onMessage(ev) {
            if (ev.source !== window.parent || ev.origin !== studioOrigin) return;
            const data = ev.data;
            if (!data || typeof data !== 'object' || data.type !== 'set_api_key' ||
                typeof data.apiKey !== 'string') {
                return;
            }
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            if (!data.apiKey.startsWith('ei_')) {
                reject(new StudioHandshakeError('Studio sent a malformed API key'));
                return;
            }
            resolve(data.apiKey);
        }

        window.addEventListener('message', onMessage);
        window.parent.postMessage({ type: 'REQUEST_API_KEY' }, studioOrigin);
    });
}

/**
 * Inside Studio: validates the hosts, runs the handshake and resolves to a
 * connection. Outside Studio, or without `apiKey=__POSTMESSAGE__`, resolves to
 * null so the caller can show a connect form.
 */
export async function connectInStudio({ context = readStudioContext(), trustedOrigins = [], timeoutMs } = {}) {
    if (!context.keyViaPostMessage || !isEmbedded()) return null;
    const hosts = resolveHosts(context, {}, { trustedOrigins });
    const apiKey = await requestApiKeyFromStudio(hosts.studioHost, { timeoutMs });
    return { apiKey, ...hosts, context, source: 'studio' };
}

/**
 * Builds a connection from a key someone pasted (standalone mode). Host
 * overrides are optional; blank means the public default.
 */
export function connectStandalone(apiKey, { context = readStudioContext(), overrides = {}, trustedOrigins = [] } = {}) {
    const key = String(apiKey ?? '').trim();
    if (!/^ei_[A-Za-z0-9]+$/.test(key)) {
        throw new Error('Enter a project API key that starts with ei_');
    }
    const clean = {
        studioHost: overrides.studioHost?.trim() || undefined,
        ingestionHost: overrides.ingestionHost?.trim() || undefined,
    };
    const hosts = resolveHosts(context, clean, { trustedOrigins });
    return { apiKey: key, ...hosts, context, source: 'manual' };
}

// ---------------------------------------------------------------------------
// Iframe height
// ---------------------------------------------------------------------------

/**
 * Posts IFRAME_HEIGHT to Studio whenever the content height changes, so the
 * frame grows with the page. Returns a function that stops reporting.
 */
export function startHeightReporter(studioHost, { element } = {}) {
    if (!isEmbedded()) return () => {};
    const studioOrigin = new URL(studioHost).origin;
    const target = element ?? document.body;
    let last = -1;

    const report = () => {
        const height = Math.ceil(target.scrollHeight);
        if (height === last) return;
        last = height;
        window.parent.postMessage({ type: 'IFRAME_HEIGHT', height }, studioOrigin);
    };

    report();
    window.addEventListener('load', report);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(target);
    return () => {
        window.removeEventListener('load', report);
        observer?.disconnect();
    };
}

// ---------------------------------------------------------------------------
// Studio API over fetch
// ---------------------------------------------------------------------------

async function errorFrom(res, service) {
    let message = `${service} returned ${res.status}`;
    try {
        const text = await res.text();
        try {
            const body = JSON.parse(text);
            if (body && typeof body.error === 'string') message = body.error;
        } catch {
            if (text) message = `${message}: ${text.slice(0, 300)}`;
        }
    } catch {
        // body unreadable; keep the status message
    }
    return new ApiError(message, res.status, service);
}

function withKey(apiKey, headers) {
    const h = new Headers(headers);
    h.set('x-api-key', apiKey);
    return h;
}

/**
 * fetch() against the Studio API with the key attached. `path` starts with
 * /api/..., the same paths as the OpenAPI spec. Throws ApiError on HTTP errors.
 */
export async function apiFetch(conn, path, init = {}) {
    if (!path.startsWith('/api/')) throw new Error('path must start with /api/');
    const res = await fetch(`${conn.studioHost}/v1${path}`, {
        ...init,
        headers: withKey(conn.apiKey, init.headers),
    });
    if (!res.ok) throw await errorFrom(res, 'Studio API');
    return res;
}

/** apiFetch() for JSON endpoints; also throws when the body says success: false. */
export async function apiFetchJson(conn, path, init = {}) {
    const res = await apiFetch(conn, path, init);
    const body = await res.json();
    if (body && body.success === false) {
        throw new ApiError(body.error || 'Request failed', res.status, 'Studio API');
    }
    return body;
}

/** `{ apiKeyId, projectId, role, expires? }` for the key in use. */
export async function getApiKeyInfo(conn) {
    const body = await apiFetchJson(conn, '/api/projects/api-key-info');
    return {
        apiKeyId: body.apiKeyId,
        projectId: body.projectId,
        role: body.role,
        expires: body.expires ? new Date(body.expires) : undefined,
    };
}

/** The project ID from the URL, or from the key. Never ask a user for it. */
export async function resolveProjectId(conn) {
    return conn.context?.projectId ?? (await getApiKeyInfo(conn)).projectId;
}

/**
 * Fetches authenticated Studio media (sample images, audio) and returns an
 * object URL for <img>/<audio>. Refuses URLs on any origin but Studio's so the
 * key can't leak. Call URL.revokeObjectURL() when the element goes away.
 */
export async function fetchObjectUrl(conn, url) {
    const u = new URL(url, conn.studioHost);
    if (u.origin !== new URL(conn.studioHost).origin) {
        throw new UntrustedHostError(`Refusing to send the API key to ${u.origin}`);
    }
    const res = await fetch(u, { headers: withKey(conn.apiKey) });
    if (!res.ok) throw await errorFrom(res, 'Studio media');
    return URL.createObjectURL(await res.blob());
}

// ---------------------------------------------------------------------------
// Ingestion API
// ---------------------------------------------------------------------------

/**
 * Uploads files with the Ingestion API's /api/{category}/files endpoint.
 * `files` is a File/Blob or an array of them. Extra ingestion headers
 * (x-no-label, x-add-date-id, ...) go in `headers`.
 */
export async function uploadToIngestion(conn, { files, category = 'training', label, headers } = {}) {
    if (!INGESTION_CATEGORIES.includes(category)) {
        throw new Error(`category must be one of ${INGESTION_CATEGORIES.join(', ')}`);
    }
    const list = Array.isArray(files) ? files : [files];
    if (!list.length || list.some((f) => !(f instanceof Blob))) {
        throw new Error('files must be one or more File or Blob objects');
    }

    const body = new FormData();
    list.forEach((file, i) => body.append('data', file, file.name || `file-${i}`));
    const h = withKey(conn.apiKey, headers);
    if (label !== undefined) h.set('x-label', label);

    // Leave Content-Type unset so the browser adds the multipart boundary.
    const res = await fetch(`${conn.ingestionHost}/api/${category}/files`, {
        method: 'POST',
        headers: h,
        body,
    });
    if (!res.ok) throw await errorFrom(res, 'Ingestion API');
    const type = res.headers.get('content-type') || '';
    return type.includes('application/json') ? res.json() : res.text();
}

// ---------------------------------------------------------------------------
// Learn block custom data
// ---------------------------------------------------------------------------

/** `[{ path, mimeType, size }]`; empty until the learn block has been trained. */
export async function listLearnBlockCustomData(conn, projectId, learnId) {
    const body = await apiFetchJson(conn, `/api/${projectId}/learn-data/${learnId}/custom-data/list`);
    return body.files ?? [];
}

/**
 * Reads one file, `path` relative to custom_data exactly as listed. Returns
 * the Response: use .json(), .text(), .blob() or .arrayBuffer().
 */
export function readLearnBlockCustomData(conn, projectId, learnId, path) {
    return apiFetch(conn,
        `/api/${projectId}/learn-data/${learnId}/custom-data/read?path=${encodeURIComponent(path)}`);
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

export function isValidSharedStateKey(key) {
    return typeof key === 'string' && SHARED_STATE_KEY_PATTERN.test(key);
}

function assertSharedStateKey(key) {
    if (!isValidSharedStateKey(key)) {
        throw new Error(`Invalid shared state key "${key}": 2-80 characters of A-Z a-z 0-9 _ -, ` +
            'starting and ending with a letter or digit');
    }
}

/** SHA-256 hex of a string, for turning paths or long names into valid keys. */
export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extension shared state: small versioned blobs stored on the project for this
 * extension, shared by every user and session. Needs the key Studio issued to
 * the extension; a dashboard key raises SharedStateUnavailableError.
 */
export class SharedStateClient {
    constructor(conn, projectId, { index } = {}) {
        this.conn = conn;
        this.projectId = projectId;
        this.index = index ?? conn.context?.sharedStateIndex ?? null;
        this._queues = new Map();
    }

    _path(key) {
        return `/api/${this.projectId}/extensions/shared-state?key=${encodeURIComponent(key)}`;
    }

    async _call(fn) {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof ApiError && /attached to an extension/i.test(err.message)) {
                throw new SharedStateUnavailableError(
                    'Shared state needs the API key Studio issues to the extension. ' +
                    'Open the extension from Studio to save shared settings.');
            }
            throw err;
        }
    }

    /** Refreshes `{ key: version }` from the server. */
    async loadIndex() {
        const body = await this._call(() =>
            apiFetchJson(this.conn, `/api/${this.projectId}/extensions/shared-state/list`));
        this.index = Object.fromEntries((body.sharedState ?? []).map((s) => [s.key, s.version]));
        return this.index;
    }

    /** Known version of a key; 0 means never written. */
    version(key) {
        return this.index?.[key] ?? 0;
    }

    /**
     * `{ version, blob }`, or null when the key is unset. Skips the request when
     * the index says the key doesn't exist; call loadIndex() first (or use
     * watch()) if the page has been open a while.
     */
    async read(key) {
        assertSharedStateKey(key);
        if (this.index && !(key in this.index)) return null;

        const res = await this._call(() => apiFetch(this.conn, this._path(key)));
        const header = res.headers.get('x-version');
        let version = header !== null && header !== '' ? Number(header) : NaN;
        if (!Number.isFinite(version)) {
            // Studio exposes x-version over CORS; a proxy may strip it.
            if (!this.index) await this.loadIndex();
            version = this.version(key);
        }
        const blob = await res.blob();
        if (!version) {
            if (this.index) {
                const { [key]: _gone, ...rest } = this.index;
                this.index = rest;
            }
            return null;
        }
        this.index = { ...(this.index ?? {}), [key]: version };
        return { version, blob };
    }

    /** Parsed JSON value, or `fallback` when unset. Validate the shape yourself. */
    async readJson(key, fallback = null) {
        const stored = await this.read(key);
        return stored ? JSON.parse(await stored.blob.text()) : fallback;
    }

    /**
     * Writes a Blob (or string) as the next version. Writes to the same key are
     * queued. Throws SharedStateConflictError if someone else saved first.
     */
    write(key, data, { filename = key, contentType } = {}) {
        assertSharedStateKey(key);
        const blob = data instanceof Blob
            ? data
            : new Blob([data], { type: contentType || 'text/plain' });
        if (blob.size > SHARED_STATE_MAX_BYTES) {
            return Promise.reject(new RangeError(`Shared state "${key}" exceeds 100 MB`));
        }
        const previous = this._queues.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(() => this._write(key, blob, filename));
        this._queues.set(key, next);
        return next;
    }

    async _write(key, blob, filename) {
        if (!this.index) await this.loadIndex();
        const form = new FormData();
        form.append('currentVersion', String(this.version(key)));
        form.append('state', blob, filename);

        const body = await this._call(() =>
            apiFetchJson(this.conn, this._path(key), { method: 'POST', body: form }));
        const status = body.status ?? {};
        if (status.type === 'conflict') throw new SharedStateConflictError(key, status.conflictError);
        if (status.type !== 'success' || typeof status.newVersion !== 'number') {
            throw new Error(`Unexpected shared state response for "${key}"`);
        }
        this.index = { ...(this.index ?? {}), [key]: status.newVersion };
        return status.newVersion;
    }

    /**
     * Stores JSON as text/plain, so the edge-impulse-api bindings won't parse
     * it on read and throw on a value that contains `success: false`.
     */
    writeJson(key, value) {
        return this.write(key, JSON.stringify(value), { filename: `${key}.json`, contentType: 'text/plain' });
    }

    /**
     * Writes and resolves conflicts. `onConflict(error)` returns 'overwrite'
     * (retry against the latest version) or 'theirs' (keep the other write).
     * The default, 'overwrite', suits caches; ask the user for settings.
     */
    async writeResolving(key, data, { onConflict = async () => 'overwrite', maxAttempts = 5, ...options } = {}) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return { outcome: 'saved', version: await this.write(key, data, options) };
            } catch (err) {
                if (!(err instanceof SharedStateConflictError)) throw err;
                await this.loadIndex();
                if (await onConflict(err) === 'theirs') {
                    return { outcome: 'kept-theirs', version: this.version(key) };
                }
            }
        }
        throw new Error(`Gave up saving "${key}" after ${maxAttempts} conflicting attempts`);
    }

    async delete(key) {
        assertSharedStateKey(key);
        await this._call(() => apiFetchJson(this.conn, this._path(key), { method: 'DELETE' }));
        if (this.index) {
            const { [key]: _removed, ...rest } = this.index;
            this.index = rest;
        }
    }

    /**
     * Polls for other users' changes while the page is visible and calls
     * `onChange(keys)` with the keys whose version moved. Returns a stop function.
     */
    watch(onChange, { intervalMs = 5000, onError } = {}) {
        let busy = false;
        const tick = async () => {
            if (busy || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
            busy = true;
            try {
                const before = this.index ?? {};
                const after = await this.loadIndex();
                const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
                const changed = [...keys].filter((k) => before[k] !== after[k]);
                if (changed.length) await onChange(changed);
            } catch (err) {
                onError?.(err);
            } finally {
                busy = false;
            }
        };
        const timer = setInterval(tick, intervalMs);
        return () => clearInterval(timer);
    }
}
