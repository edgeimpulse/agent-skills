/*
 * Minimal static server for an Edge Impulse Studio extension. Node 18+, no
 * dependencies.
 *
 * Studio embeds your extension cross-site in an iframe, so every response must
 * carry a Content-Security-Policy whose frame-ancestors names Studio. A plain
 * static file server can't set it; this one sends the recommended policy
 * (references/STUDIO-CONTRACT.md#content-security-policy). Use whatever server
 * or host you like in production, as long as it sends the same header.
 *
 *   node server.js                     # serves this folder on http://localhost:8080
 *   PORT=3000 node server.js
 *   STUDIO_ORIGIN="https://studio.edgeimpulse.com https://studio.example.com" node server.js
 *   INGESTION_ORIGIN="https://ingestion.edgeimpulse.com https://ingestion.example.com" node server.js
 *
 * Two ways to try it:
 *   - standalone: open http://localhost:8080/ and paste a project API key;
 *   - in Studio: register a project-visibility extension with the URL
 *     http://localhost:8080/ (Studio accepts http:// for localhost only). If
 *     your browser won't frame it, put an HTTPS tunnel in front and register
 *     the tunnel URL instead.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname);

// The Edge Impulse origins the app loads from or calls. Exact origins only: no
// wildcards, and never X-Frame-Options: DENY.
const origins = (list) => list.split(/[\s,]+/).filter(Boolean).map((origin) => new URL(origin).origin);
const STUDIO_ORIGINS = origins(process.env.STUDIO_ORIGIN || 'https://studio.edgeimpulse.com');
const INGESTION_ORIGINS = origins(process.env.INGESTION_ORIGIN || 'https://ingestion.edgeimpulse.com');
const ALLOWED = [...STUDIO_ORIGINS, ...INGESTION_ORIGINS].join(' ');
// runJobUntilCompletion opens a websocket to the Studio host, and an https://
// source doesn't match wss://.
const JOB_SOCKETS = STUDIO_ORIGINS.map((origin) => origin.replace(/^http/, 'ws')).join(' ');

// Add exact origins to the directives that need them when the app loads
// anything else (a CDN goes in script-src, a third-party API in connect-src).
const CSP = [
    `default-src 'self' ${ALLOWED}`,
    "base-uri 'self'",
    `connect-src 'self' ${ALLOWED} ${JOB_SOCKETS}`,
    "font-src 'self'",
    `form-action 'self' ${ALLOWED}`,
    `frame-ancestors 'self' ${STUDIO_ORIGINS.join(' ')}`,
    `img-src 'self' ${ALLOWED} data: blob:`,
    "manifest-src 'self'",
    `media-src 'self' ${ALLOWED} blob:`,
    "object-src 'none'",
    `script-src 'self' ${ALLOWED} 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' ${ALLOWED} 'unsafe-inline'`,
    "worker-src 'self' blob:",
].join('; ');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
};

function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS, ...headers });
    res.end(body);
}

http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        return;
    }

    let rel;
    try {
        rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        send(res, 400, 'Bad request');
        return;
    }
    if (rel.endsWith('/')) rel += 'index.html';

    // Contain path traversal: the resolved file must stay inside ROOT.
    const file = path.resolve(ROOT, `.${rel}`);
    if (rel.includes('\0') || (file !== ROOT && !file.startsWith(ROOT + path.sep))) {
        send(res, 403, 'Forbidden');
        return;
    }
    if (path.basename(file) === path.basename(__filename)) {
        send(res, 404, 'Not found');
        return;
    }

    fs.readFile(file, (err, body) => {
        if (err) {
            send(res, 404, 'Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
            ...SECURITY_HEADERS,
        });
        res.end(req.method === 'HEAD' ? undefined : body);
    });
}).listen(PORT, () => {
    console.log(`Extension on http://localhost:${PORT}/`);
    console.log(`  Content-Security-Policy: ${CSP}`);
    console.log(`  standalone: open http://localhost:${PORT}/ and paste a project API key`);
    console.log(`  in Studio:  register http://localhost:${PORT}/ as the extension URL`);
});
