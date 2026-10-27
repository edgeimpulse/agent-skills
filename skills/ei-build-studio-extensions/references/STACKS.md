# Extensions in any stack

The integration is the same whatever you build with. Read the context once, get a connection (from Studio or a connect form), keep the key in memory, and serve every page with the Content-Security-Policy header. This file shows that wiring for common stacks, then the header setup for common hosts.

## Contents

- [Rules for every stack](#rules-for-every-stack)
- [Plain HTML](#plain-html)
- [TypeScript](#typescript)
- [React](#react)
- [Vue](#vue)
- [Svelte](#svelte)
- [Angular](#angular)
- [Pyodide and Python in the browser](#pyodide-and-python-in-the-browser)
- [Backend proxy](#backend-proxy)
- [Server-rendered apps](#server-rendered-apps)
- [Response headers](#response-headers)

## Rules for every stack

- **Copy `ei-extension.js` (and `ei-extension.d.ts`) into your source tree.** It's a dependency-free ES module that any bundler or a plain `<script type="module">` can load.
- **Read the context at module load, before the router starts.** Client-side routers rewrite the URL and can drop the query string. Call `readStudioContext()` in your entry file and pass the result around.
- **Start the handshake once.** Store the promise from `connectInStudio()` in module scope so re-renders, hot reloads, and React StrictMode reuse it.
- **Keep the connection in memory.** Don't put the key in persisted stores (Redux Persist, Pinia persisted state, `localStorage`-backed stores), URLs, or route state. A reload asks Studio again.
- **Render API data as text.** Avoid `dangerouslySetInnerHTML`, `v-html`, `{@html}`, and `[innerHTML]` with sample names, labels, or metadata.
- **Use a relative or configurable base path** if the app is served from a sub-path. The registered URL decides the path Studio loads.
- **Send the Content-Security-Policy from the dev server too**, so you can test embedded in Studio and see anything the policy blocks before you deploy ([Response headers](#response-headers)).

A shared module most framework examples below build on:

```js
// studio.js (JSDoc types let TypeScript projects import it as is)
import { connectInStudio, connectStandalone, readStudioContext } from './ei-extension.js';

/** @typedef {import('./ei-extension.js').Connection} Connection */

export const studioContext = readStudioContext();        // runs once, at import
/** @type {string[]} exact extra origins you trust */
export const TRUSTED_ORIGINS = [];

/** @type {Promise<Connection | null> | undefined} */
let pending;
/** Resolves to a connection inside Studio, or null when the app is opened directly. */
export function getStudioConnection() {
  return (pending ??= connectInStudio({ context: studioContext, trustedOrigins: TRUSTED_ORIGINS }));
}

/**
 * For the connect form. Throws an Error with a message fit for the UI.
 * @param {string} apiKey
 * @param {{ studioHost?: string, ingestionHost?: string }} [overrides]
 */
export function connectWithKey(apiKey, overrides) {
  return connectStandalone(apiKey, { context: studioContext, overrides, trustedOrigins: TRUSTED_ORIGINS });
}
```

Import `studio.js` from your entry file before the router so `readStudioContext()` sees the original URL.

## Plain HTML

`assets/index.html` is a complete no-build example: a `<script type="module">` that imports the helper, loads the hosted bindings, and shows a connect form outside Studio. Serve it with `assets/server.js` or any host that sets the header.

## TypeScript

Keep `ei-extension.d.ts` next to `ei-extension.js`. TypeScript picks the types up automatically for `import … from './ei-extension.js'`:

```ts
import { getApiKeyInfo, type Connection, type StudioContext } from './ei-extension.js';
```

If you use the npm bindings, `import { EdgeImpulseApi } from 'edge-impulse-api'` is fully typed. For the hosted script, declare the global or download the hosted `edge-impulse-api.d.ts` next to it. For typed `fetch` calls without the bindings, generate types from the OpenAPI spec with `npx openapi-typescript https://studio.edgeimpulse.com/openapi.yml -o studio-api.d.ts` ([Find the right endpoint](API.md#find-the-right-endpoint)).

## React

```ts
// useStudioConnection.ts
import { useCallback, useEffect, useState } from 'react';
import { describeError, type Connection } from './ei-extension.js';
import { connectWithKey, getStudioConnection } from './studio.js';

type State =
  | { status: 'loading' }
  | { status: 'standalone' }               // show the connect form
  | { status: 'ready'; conn: Connection }
  | { status: 'error'; message: string };

export function useStudioConnection() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getStudioConnection().then(
      (conn) => active && setState(conn ? { status: 'ready', conn } : { status: 'standalone' }),
      (err) => active && setState({ status: 'error', message: describeError(err) }),
    );
    return () => { active = false; };
  }, []);

  const connect = useCallback((apiKey: string, overrides?: { studioHost?: string; ingestionHost?: string }) => {
    setState({ status: 'ready', conn: connectWithKey(apiKey, overrides) });   // throws on invalid input
  }, []);

  return { state, connect };
}
```

```tsx
// App.tsx
export function App() {
  const { state, connect } = useStudioConnection();
  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  if (state.status === 'standalone') return <ConnectForm onConnect={connect} />;
  return <Extension conn={state.conn} />;
}
```

- Create the `EdgeImpulseApi` client once per connection (`useMemo` on `conn`) and pass it through context.
- StrictMode runs effects twice in development. The memoized promise in `studio.js` means only one handshake runs.
- With React Router, import `studio.js` in `main.tsx` before `createBrowserRouter`.

## Vue

```ts
// useStudioConnection.ts
import { ref, shallowRef } from 'vue';
import { describeError, type Connection } from './ei-extension.js';
import { connectWithKey, getStudioConnection } from './studio.js';

const status = ref<'loading' | 'standalone' | 'ready' | 'error'>('loading');
const conn = shallowRef<Connection | null>(null);    // shallow: don't make the key reactive deep state
const error = ref('');

getStudioConnection().then(
  (c) => { conn.value = c; status.value = c ? 'ready' : 'standalone'; },
  (e) => { error.value = describeError(e); status.value = 'error'; },
);

export function useStudioConnection() {
  function connect(apiKey: string, overrides?: { studioHost?: string; ingestionHost?: string }) {
    conn.value = connectWithKey(apiKey, overrides);
    status.value = 'ready';
  }
  return { status, conn, error, connect };
}
```

Exclude the connection from Pinia persistence plugins and Vue Devtools state you share in screenshots.

## Svelte

```ts
// studio-store.ts
import { writable } from 'svelte/store';
import { describeError, type Connection } from './ei-extension.js';
import { connectWithKey, getStudioConnection } from './studio.js';

type State = { status: 'loading' | 'standalone' | 'error'; message?: string } | { status: 'ready'; conn: Connection };
export const studio = writable<State>({ status: 'loading' });

getStudioConnection().then(
  (conn) => studio.set(conn ? { status: 'ready', conn } : { status: 'standalone' }),
  (err) => studio.set({ status: 'error', message: describeError(err) }),
);

export function connect(apiKey: string, overrides?: { studioHost?: string; ingestionHost?: string }) {
  studio.set({ status: 'ready', conn: connectWithKey(apiKey, overrides) });
}
```

With SvelteKit, the handshake must run in the browser only. Import the store from client code (`onMount`, or a `+layout.ts` with `ssr = false`), not from server load functions.

## Angular

```ts
// studio-connection.service.ts
import { Injectable, signal } from '@angular/core';
import { describeError, type Connection } from './ei-extension.js';
import { connectWithKey, getStudioConnection } from './studio.js';

@Injectable({ providedIn: 'root' })
export class StudioConnectionService {
  readonly status = signal<'loading' | 'standalone' | 'ready' | 'error'>('loading');
  readonly conn = signal<Connection | null>(null);
  readonly error = signal('');

  constructor() {
    getStudioConnection().then(
      (c) => { this.conn.set(c); this.status.set(c ? 'ready' : 'standalone'); },
      (e) => { this.error.set(describeError(e)); this.status.set('error'); },
    );
  }

  connect(apiKey: string, overrides?: { studioHost?: string; ingestionHost?: string }) {
    this.conn.set(connectWithKey(apiKey, overrides));
    this.status.set('ready');
  }
}
```

Import `studio.js` at the top of `main.ts`, before `bootstrapApplication`, so the router can't rewrite the URL first. `ng serve` can send headers with the `headers` option of the dev-server target in `angular.json`.

## Pyodide and Python in the browser

Run the handshake in JavaScript, then hand the key and hosts to Python. Python code can't receive `postMessage` itself.

```js
import { resolveProjectId } from './ei-extension.js';
import { getStudioConnection } from './studio.js';

const conn = await getStudioConnection();
if (!conn) throw new Error('Open this from Studio');  // or show a connect form and use connectWithKey()
const pyodide = await loadPyodide();
await pyodide.loadPackage(['micropip']);
await pyodide.runPythonAsync("import micropip; await micropip.install(['requests', 'pyodide-http'])");

pyodide.globals.set('EI_STUDIO_HOST', conn.studioHost);
pyodide.globals.set('EI_INGESTION_HOST', conn.ingestionHost);
pyodide.globals.set('EI_API_KEY', conn.apiKey);
pyodide.globals.set('EI_PROJECT_ID', await resolveProjectId(conn));
```

```python
import pyodide_http, requests
pyodide_http.patch_all()                           # route requests through the browser's fetch

res = requests.get(f"{EI_STUDIO_HOST}/v1/api/{EI_PROJECT_ID}/raw-data",
                   params={"category": "training", "limit": 20},
                   headers={"x-api-key": EI_API_KEY})
res.raise_for_status()
samples = res.json()["samples"]
```

- Never print the full key or leave it in a notebook cell's output. Notebooks are often saved, shared, or synced through shared state, and the key would go with them.
- Python libraries that make HTTP calls need a browser transport in Pyodide. `pyodide-http` patches `requests` and `urllib`; `pyodide.http.pyfetch` is the low-level option.
- Take paths, query parameters, and response fields from the [OpenAPI spec](API.md#find-the-right-endpoint). Python calls the REST API directly, so there are no bindings to catch a wrong name.
- Under the [recommended CSP](STUDIO-CONTRACT.md#content-security-policy), add the host you load Pyodide from (for example `https://cdn.jsdelivr.net`) to `script-src` and `connect-src`, or self-host it. If `micropip` installs from PyPI, also add `https://pypi.org https://files.pythonhosted.org` to `connect-src`. Pyodide needs the policy's `'unsafe-eval'`.

## Backend proxy

Use a backend when the work is heavy, needs secrets of its own, or calls services the browser can't reach.

**Forward the Studio key per request.** The browser gets the key from Studio as usual and sends it to your backend in a header:

```js
await fetch('https://api.your-app.example.com/analyze', {
  method: 'POST',
  headers: { 'x-ei-api-key': conn.apiKey, 'x-ei-studio-host': conn.studioHost, 'content-type': 'application/json' },
  body: JSON.stringify({ projectId }),
});
```

- Over HTTPS only, in a header or body, never in a query string (it ends up in access logs).
- The backend validates the Studio host with the same allowlist, uses the key for that request, and never stores or logs it. Strip it from request logging and error reports.
- Build the backend's Studio calls from the [OpenAPI spec](API.md#find-the-right-endpoint). Generate a client from it for your server's language if there are no bindings for it.
- Allow CORS from your extension's origin only.
- Don't rely on cookies to authenticate the browser to your backend: inside Studio's iframe they're third-party cookies and are often blocked.

**Or keep a key server-side.** For a tool that only ever serves one project, the backend can hold its own project API key, so the browser never sees one. You then need another way to make sure only the right people call your backend.

## Server-rendered apps

Django, Rails, Laravel, Flask, Express with templates, and similar frameworks work the same way: the server renders the page with the Content-Security-Policy header, and the key arrives in the browser after the page loads. Load the helper on the page and run the handshake there.

- The server never sees `__POSTMESSAGE__` turn into a key. If server code needs the key, forward it per request as in [Backend proxy](#backend-proxy).
- Remove default `X-Frame-Options` middleware for the extension's pages (see below).

## Response headers

Every HTML response needs the [recommended Content-Security-Policy](STUDIO-CONTRACT.md#content-security-policy), and no `X-Frame-Options`. On one line, ready to paste:

```text
default-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com; base-uri 'self'; connect-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com wss://studio.edgeimpulse.com; font-src 'self'; form-action 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com; frame-ancestors 'self' https://studio.edgeimpulse.com; img-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com data: blob:; manifest-src 'self'; media-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com blob:; object-src 'none'; script-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com 'unsafe-inline' 'unsafe-eval'; style-src 'self' https://studio.edgeimpulse.com https://ingestion.edgeimpulse.com 'unsafe-inline'; worker-src 'self' blob:
```

In the examples below, `CSP` is that line as a string constant (it contains single quotes, so use double quotes or backticks), and `<policy>` in a config file means paste the line there. Keep one copy per project, so dev and production send the same policy. Add origins as described in [STUDIO-CONTRACT.md](STUDIO-CONTRACT.md#content-security-policy). After deploying, check with `curl -sI https://your-app.example.com/`.

### Dev servers

**Node (no framework):** `assets/server.js` builds and sends the policy. Set `STUDIO_ORIGIN` and `INGESTION_ORIGIN` for extra origins.

**Vite** (React, Vue, Svelte, Solid, Preact, …), in `vite.config.js`:

```js
const CSP = "default-src 'self' …; worker-src 'self' blob:";   // the full line above
const securityHeaders = { 'Content-Security-Policy': CSP };

export default defineConfig({
  base: './',                          // relative asset URLs, works from any path
  server: { headers: securityHeaders },
  preview: { headers: securityHeaders },
});
```

`server.headers` covers `vite dev` and `preview.headers` covers `vite preview`. Production headers come from your host. The policy allows Vite's hot-reload websocket, which goes to the dev server's own origin (`'self'`), and the inline scripts some framework plugins inject (`'unsafe-inline'`).

**webpack-dev-server:** `devServer: { headers: { 'Content-Security-Policy': CSP } }`.

**Angular CLI:** the dev-server target's `headers` option in `angular.json`.

### Frameworks and servers

**Express:**

```js
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.removeHeader('X-Frame-Options');
  next();
});
```

Helmet sends `X-Frame-Options: SAMEORIGIN` and its own CSP by default. Turn both off and keep the middleware above: `app.use(helmet({ contentSecurityPolicy: false, xFrameOptions: false }))` (on Helmet 6 and earlier, `frameguard: false`).

**Next.js**, in `next.config.js`:

```js
module.exports = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'Content-Security-Policy', value: CSP }],
    }];
  },
};
```

Run the handshake in a client component (`'use client'`) inside `useEffect`. Next.js needs `'unsafe-eval'` in development, so keep it in the policy you use there.

**SvelteKit:** set the header in `src/hooks.server.js` (`response.headers.set('Content-Security-Policy', CSP)` in `handle`) for server-rendered pages, or on the host for `adapter-static`.

**Flask:**

```python
@app.after_request
def security_headers(response):
    response.headers["Content-Security-Policy"] = CSP
    response.headers.pop("X-Frame-Options", None)
    return response
```

**FastAPI / Starlette:**

```python
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    return response
```

**Django:** `XFrameOptionsMiddleware` is on by default and sends `X-Frame-Options: DENY`. Mark the extension's views with `@xframe_options_exempt` (or remove the middleware), and set the CSP header in a small middleware or with your CSP package.

**Nginx:**

```nginx
add_header Content-Security-Policy "<policy>" always;
```

An `add_header` inside a `location` block replaces all `add_header` lines inherited from the `server` block, so repeat it there. Remove any `add_header X-Frame-Options`.

**Apache** (`mod_headers`):

```apache
Header always set Content-Security-Policy "<policy>"
Header always unset X-Frame-Options
```

**Caddy:**

```caddy
header Content-Security-Policy "<policy>"
header -X-Frame-Options
```

### Static hosts

**Netlify and Cloudflare Pages**, in a `_headers` file in the published folder:

```text
/*
  Content-Security-Policy: <policy>
```

**Vercel**, in `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "<policy>" }
      ]
    }
  ]
}
```

**Firebase Hosting**, in `firebase.json` under `hosting`:

```json
"headers": [
  { "source": "**", "headers": [
    { "key": "Content-Security-Policy", "value": "<policy>" }
  ] }
]
```

**Amazon S3 with CloudFront:** S3 can't set the header. Attach a CloudFront response headers policy that sets `Content-Security-Policy` to `<policy>`, and leave its frame-options setting off.

**GitHub Pages** and other hosts that can't set response headers: Studio can still frame the app, but so can any other site. Use them for demos only, not for extensions people rely on.
