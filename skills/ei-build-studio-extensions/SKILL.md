---
name: ei-build-studio-extensions
description: Build Edge Impulse Studio extensions, which are web apps in any language or framework that Studio embeds in an iframe on a project, impulse, DSP block, or learn block page. Use when asked to create, register, debug, secure, or deploy an extension; read the context Studio passes in URL parameters (projectId, impulseId, dspId, learnId, studioHost, ingestionHost, sharedState); get the project API key over postMessage (apiKey=__POSTMESSAGE__, REQUEST_API_KEY, set_api_key); call the Studio and Ingestion APIs with the edge-impulse-api bindings or fetch, taking endpoints from the OpenAPI spec; run jobs; show authenticated sample media; save settings or results in extension shared state; read learn block custom data; resize the iframe; work inside the iframe sandbox; or set the Content-Security-Policy, including frame-ancestors. Covers plain HTML, React, Vue, Svelte, Angular, Pyodide, and backend-proxy apps, and ships a dependency-free helper module, an unstyled starter, and a dev server.
metadata:
  version: "1.0.0"
---

# Build Edge Impulse Studio extensions

An Edge Impulse Studio extension is **a web app that Studio embeds in an iframe**. You host it anywhere that serves HTTPS and lets you set response headers. You register its URL with Studio, and Studio then shows it as a page in a project. Studio passes the project context as URL query parameters and hands over a short-lived, project-scoped API key with `postMessage`. Your app uses that key to call the Edge Impulse APIs.

Nothing about the UI is prescribed. Use any language that runs in a browser (or compiles to it) and any framework, component library, or CSS you like. This skill covers only the integration contract: context, auth, API access, storage, sandbox, headers, and deployment. It applies to every Edge Impulse plan.

## How it fits together

```text
Studio page on https://studio.edgeimpulse.com
└─ <iframe src="https://your-app.example.com/?apiKey=__POSTMESSAGE__&projectId=…&studioHost=…&sharedState=…">
     1. read the context from the URL, once, at startup
     2. validate studioHost (and ingestionHost): the key is sent there
     3. → postMessage { type: 'REQUEST_API_KEY' } to the Studio origin
     4. ← { type: 'set_api_key', apiKey: 'ei_…' }, accepted only from window.parent on the Studio origin
     5. call {studioHost}/v1/api/… and {ingestionHost}/api/… with the x-api-key header
     6. → postMessage { type: 'IFRAME_HEIGHT', height } whenever the content height changes (optional)
```

Opened outside Studio (no parent frame), there is no key to ask for. Show a connect form that takes a project API key instead of failing.

## What's in this skill

| Need | Read or copy |
| --- | --- |
| Registration fields, scopes, URL parameters, the postMessage protocol, key lifetime, the iframe sandbox, CSP, local development, deployment | [references/STUDIO-CONTRACT.md](references/STUDIO-CONTRACT.md) |
| Finding endpoints in the OpenAPI spec, API bindings, raw REST, the Ingestion API, jobs, sample media, learn block custom data, errors, performance | [references/API.md](references/API.md) |
| Saving settings and results for every user of the project: versions, conflicts, caching, live updates | [references/SHARED-STATE.md](references/SHARED-STATE.md) |
| React, Vue, Svelte, Angular, Pyodide, backend proxies, and the response-header setup for common hosts | [references/STACKS.md](references/STACKS.md) |
| Dependency-free helpers for the context, handshake, host checks, fetch, ingestion, custom data, and shared state | [assets/ei-extension.js](assets/ei-extension.js), with types in [assets/ei-extension.d.ts](assets/ei-extension.d.ts) |
| A working, deliberately unstyled starter page | [assets/index.html](assets/index.html) |
| A zero-dependency Node dev server that sends the required headers | [assets/server.js](assets/server.js) |

## Prerequisites

- A host that serves **HTTPS** and lets you set **HTTP response headers** (for the Content-Security-Policy). `http://localhost` is fine during development.
- Somewhere to register the extension: an organization you administer, or your personal developer profile. See [Register](references/STUDIO-CONTRACT.md#register-the-extension).
- For development outside Studio only: a project API key (`ei_…`) from the **Keys** tab of the project dashboard. Inside Studio, Studio issues the key.

For platform scripting outside an extension (uploading datasets, running training from CI, managing organizations, or registering extensions from a script), use the `ei-api` skill.

## Workflow

1. **Pick the scope and the least role.** The scope (`navbarLocation`) is the Studio page the extension lives on, and it decides which IDs arrive in the URL. The role (`requiredApiKeyRole`) is what the key may do. Use `readonly` unless the extension writes.
2. **Start from a template.** Copy the three files in `assets/` for a no-build app, or wire the helper into your framework with [STACKS.md](references/STACKS.md). The [official simple examples](https://github.com/edgeimpulse/example-studio-extensions-simple) are complete extensions to compare against.
3. **Connect at startup** as shown below: read the context, validate the hosts, get the key (from Studio, or from the connect form), and resolve the project.
4. **Build the feature** on the Studio API ([API.md](references/API.md)). Look up every call in the [OpenAPI spec](https://studio.edgeimpulse.com/openapi.yml) before writing it ([how](references/API.md#find-the-right-endpoint)). Persist anything other users should see in shared state ([SHARED-STATE.md](references/SHARED-STATE.md)).
5. **Run it locally**, first standalone and then embedded in Studio ([local development](references/STUDIO-CONTRACT.md#run-locally)).
6. **Deploy** over HTTPS with the Content-Security-Policy header, register the production URL, and work through the [review checklist](#review-checklist).

## Quick start

```bash
mkdir my-extension
cp assets/index.html assets/ei-extension.js assets/ei-extension.d.ts assets/server.js my-extension/
cd my-extension
node server.js          # http://localhost:8080/
```

Open `http://localhost:8080/` and paste a project API key: the page shows the project name, a few training samples, and a shared-state value. To see it inside Studio, register an extension whose URL is `http://localhost:8080/` with `project` visibility. Studio accepts `http://` for localhost only.

`server.js` is CommonJS. If your `package.json` sets `"type": "module"`, rename it to `server.cjs`.

## The context Studio passes

Studio appends these query parameters to your registered URL, and keeps any parameters already in it:

| Parameter | When | Meaning |
| --- | --- | --- |
| `apiKey` | Always | The placeholder `__POSTMESSAGE__`: ask Studio for the key. Never a real key. |
| `projectId` | Always | The project. The key also identifies it, so you never need to ask a user for it. |
| `studioHost` | Always from Studio | Studio's origin. Defaults to `https://studio.edgeimpulse.com` when you open the app yourself. |
| `ingestionHost` | Optional | Ingestion API origin. Defaults to `https://ingestion.edgeimpulse.com`. |
| `impulseId` | `impulse`, `dsp_block`, `learn_block` scopes | The selected impulse |
| `dspId` | `dsp_block` scope | The processing block |
| `learnId` | `learn_block` scope | The learning block |
| `sharedState` | Always from Studio | JSON `{ "key": version }` index of this extension's shared state |

Read the parameters **once at startup**, before a client-side router rewrites the URL. Treat `studioHost` and `ingestionHost` as optional overrides: a URL parameter wins, then a value typed into the connect form, then the public default. Don't derive one host from the other.

## Connect at startup

### With the helper module (recommended)

The helper validates both hosts, runs the handshake with the sender checks, and gives you a connection object with the real key. Your own `fetch` calls need that key; the bindings can't give it to you.

```js
import {
  readStudioContext, connectInStudio, connectStandalone,
  resolveProjectId, startHeightReporter, describeError,
} from './ei-extension.js';

const context = readStudioContext();           // once, before any router runs

// Inside Studio: { apiKey, studioHost, ingestionHost, context }. Elsewhere: null.
let conn = await connectInStudio({ context });
if (!conn) {
  // Your connect form calls this on submit. It throws a message fit for the UI.
  conn = connectStandalone(form.apiKey.value, {
    context,
    overrides: { studioHost: form.studioHost.value, ingestionHost: form.ingestionHost.value },
  });
}

startHeightReporter(conn.studioHost);          // no-op outside Studio

const api = new EdgeImpulseApi({ endpoint: conn.studioHost });
await api.authenticate({ method: 'apiKey', apiKey: conn.apiKey });
const projectId = await resolveProjectId(conn);
```

To trust a self-hosted or private Studio deployment on its own domain, pass its exact origin: `connectInStudio({ context, trustedOrigins: ['https://studio.example.com'] })`. Do the same for `connectStandalone`.

### With the bindings only

Current `edge-impulse-api` bindings run the handshake themselves when you pass the placeholder. Validate the host first, because the endpoint is the only origin the bindings will accept a key from:

```js
import { readStudioContext, resolveHosts } from './ei-extension.js';

const { studioHost } = resolveHosts(readStudioContext());   // throws on an untrusted host
const api = new EdgeImpulseApi({ endpoint: studioHost });
await api.authenticate({ method: 'apiKey', apiKey: '__POSTMESSAGE__' });
```

This is enough when the bindings make every call. If you also upload to ingestion, fetch media, or pass the key to Python or a backend, use the helper instead. On timeout the bindings reject with a **string**, not an `Error`. Older vendored bindings that don't know the placeholder fail with `"auth.apiKey" should start with "ei_"`, so load current ones ([API.md](references/API.md#load-the-bindings)).

### Without any JavaScript helpers

The protocol is small enough to implement in any language that compiles to the browser. See [the handshake](references/STUDIO-CONTRACT.md#get-the-api-key) for the exact messages and the checks that are required.

## Security rules

These are not optional. Each one closes a way to leak or misuse the project key.

1. **Register with `authMethod: api_key_via_postmessage`.** Never put a key in a URL, including development URLs, bookmarks, and logs.
2. **Accept `set_api_key` only when `event.source === window.parent` and `event.origin` equals the validated Studio origin.** Target every message you send at that origin, never `'*'`. Without both checks, a page that frames yours could hand you a key to *its* project and collect what the user does next.
3. **Validate every host before the key is requested or sent.** Allow HTTPS on `edgeimpulse.com` and its subdomains, loopback only while the app itself runs on loopback, and exact origins you add on purpose. `assertTrustedHost()` implements this allowlist.
4. **Keep the key in memory only.** Don't write it to `localStorage`, IndexedDB, cookies, state-persistence plugins, logs, analytics, or error reports. A reload asks Studio again.
5. **Request the least role.** `readonly` unless the extension writes data, starts jobs, or changes the project.
6. **Send the [recommended Content-Security-Policy](references/STUDIO-CONTRACT.md#content-security-policy) as a real HTTP response header** on every page, from the dev server too. Its `frame-ancestors` must name Studio (`'self'` alone blocks Studio), and a `<meta>` tag can't carry that directive. Add exact origins only to the directives that need them, never wildcards, and never send `X-Frame-Options: DENY` or `SAMEORIGIN`, which stop Studio from framing you.
7. **Render API data as text.** Sample names, labels, and metadata are user input. Use `textContent` or your framework's escaping, not `innerHTML`.
8. **Send the key only to Studio and Ingestion.** Fetch Studio media with the key and hand elements an object URL. Never attach the key to a request for a third-party URL.
9. **Need the key hidden from the browser entirely?** Proxy every call through your own backend ([STACKS.md](references/STACKS.md#backend-proxy)).

## The connect form (standalone mode)

When the app is opened outside Studio, it needs a key from the user. Requirements, whatever it looks like:

- Ask for the **project API key only**. Never ask for a project ID (the key identifies the project) or for Studio credentials.
- Use `type="password"` and `autocomplete="off"`. Clear the field once the key is accepted.
- Put **optional** Studio and ingestion host fields in a collapsed "Advanced" section. Blank means the public default. Remove a field when the URL already provides that host.
- Validate the key (`ei_` prefix) and both hosts before connecting, and show errors inline.
- Explain that shared state isn't available with a dashboard key. Degrade instead of failing ([SHARED-STATE.md](references/SHARED-STATE.md#requirements)).

## Living in the iframe

Studio frames extensions with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` and `referrerpolicy="no-referrer"`, and grants no permission-policy features.

| Blocked | Do this instead |
| --- | --- |
| `alert()`, `confirm()`, `prompt()` | In-page dialogs and messages |
| File downloads (`<a download>`, `Content-Disposition`) | Show results in the page, or offer text to copy. Popups inherit the sandbox. |
| Navigating the top window | Links with `target="_blank" rel="noopener"` |
| Camera, microphone, fullscreen, clipboard writes | `<input type="file">` for uploads; selectable text |
| `document.referrer` | `studioHost` |

As a cross-site frame, your `localStorage`, IndexedDB, and cookies are partitioned per top-level site, and third-party cookies may be blocked. Keep shared or durable data in shared state, and don't rely on cookie sessions to your own backend. More in [STUDIO-CONTRACT.md](references/STUDIO-CONTRACT.md#the-iframe-sandbox).

Either fill the frame and scroll internally, or post `IFRAME_HEIGHT` so Studio resizes the frame to fit (`startHeightReporter()` does this). `REQUEST_API_KEY` and `IFRAME_HEIGHT` are the only messages Studio handles.

## States to handle

| Situation | What the user should see |
| --- | --- |
| Waiting for the key or the first API response | A loading indicator |
| Opened outside Studio | The connect form |
| A scope ID is missing (for example no `learnId` on a learn block extension) | A message naming the missing parameter (`missingScopeParams()`) |
| Nothing to show yet (no samples, untrained learn block) | An empty state that says what to do next |
| `401` inside Studio | "Reload the page in Studio." The key expired or was revoked, and asking again returns the same key. |
| `403` | The key's role or the plan doesn't allow it. Say which. |
| Shared state unavailable with a dashboard key | The feature still works, without saving |

## Review checklist

- [ ] Registered with `api_key_via_postmessage`, the least `requiredApiKeyRole`, and an HTTPS URL on the origin the app actually runs on, with no redirects to another origin.
- [ ] `apiKey=__POSTMESSAGE__` handled with the helper, current bindings, or a handshake that checks `event.source` and `event.origin`, targets the Studio origin, and times out.
- [ ] `studioHost` and `ingestionHost` are optional overrides (URL parameter, then connect form, then default), and both are validated before the key is requested or sent.
- [ ] The key is never in a URL, never persisted, never logged.
- [ ] `projectId` comes from the URL or the key, never from a prompt.
- [ ] Every Studio API call matches its operation in the OpenAPI spec (path, parameters, body, response fields). Only the extension and shared state endpoints, which the spec doesn't list yet, come from the bindings' type declarations.
- [ ] Opened outside Studio, the app shows a connect form instead of failing.
- [ ] Missing scope IDs, empty data, loading, `401`, and `403` all render something useful.
- [ ] Nothing relies on modal dialogs, downloads, top navigation, device permissions, or `document.referrer`.
- [ ] `IFRAME_HEIGHT` (if used) is posted to the Studio origin, not `'*'`.
- [ ] Production sends the recommended Content-Security-Policy as an HTTP header (Studio in `frame-ancestors`, the Studio `wss://` origin in `connect-src`) and no `X-Frame-Options`, checked with `curl -sI`. The browser console shows no CSP violations.
- [ ] Studio media is fetched with `x-api-key` and shown with object URLs that get revoked.
- [ ] API data is rendered as text.
- [ ] Shared state: valid keys, version-checked writes, conflicts handled, and a fallback for dashboard keys.

## Documentation

- https://studio.edgeimpulse.com/openapi.yml — OpenAPI specification, the source of truth for Studio API endpoints, parameters, and responses. Check it first. Only the extension and shared state endpoints aren't listed yet; for those, use the bindings' `edge-impulse-api.d.ts`
- https://docs.edgeimpulse.com/apis/studio — Studio API reference, as browsable pages
- https://docs.edgeimpulse.com/tools/libraries/api-bindings/studio/javascript — JavaScript and TypeScript API bindings (`edge-impulse-api`)
- https://docs.edgeimpulse.com/apis/ingestion — Ingestion API reference
- https://docs.edgeimpulse.com/studio/projects/dashboard/api-keys — project API keys and roles
- https://docs.edgeimpulse.com/studio/organizations/custom-blocks/custom-learning-blocks — custom learning blocks, which can write custom data for an extension
- https://docs.edgeimpulse.com/studio/projects/learning-blocks/expert-mode — expert mode, which can also write custom data
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage — `postMessage` and origin checks
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy — Content-Security-Policy directives and source values
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors — the `frame-ancestors` directive

## Reference repositories

- https://github.com/edgeimpulse/example-studio-extensions-simple — official simple Studio extension examples. Reuse the logic, and bring your own styling. If an example doesn't handle `__POSTMESSAGE__`, take the key handling from this skill.
- https://github.com/edgeimpulse/example-custom-ml-block-keras — a custom learning block to extend with a `/home/custom_data` writer for a `learn_block` extension

## Instructions

1. Ask what the extension should do and which Studio page it belongs on, if not stated. Map that to a scope: `project` for project-wide tools, `impulse`, `dsp_block`, or `learn_block` when it works on one block. Then pick the least role.
2. Ask which stack the user wants. Default to the no-build starter in `assets/` for prototypes. For a framework, follow [STACKS.md](references/STACKS.md) and copy `ei-extension.js` and `ei-extension.d.ts` into the source tree.
3. Build the UI with whatever the user's project already uses, and don't impose a design system. The starter is unstyled on purpose.
4. Always implement both modes: the postMessage handshake inside Studio, and a connect form outside it. Apply every rule in [Security rules](#security-rules).
5. Before writing any Studio API call, look it up in the OpenAPI spec: download it and search by `operationId` or path ([API.md](references/API.md#find-the-right-endpoint)). Take the path, method, parameters, body, and response fields from there, and map it to the bindings method by tag and `operationId`. Fall back to the bindings' type declarations only for endpoints the spec doesn't list (extension registration and shared state). Never guess an endpoint or a field.
6. Use the API bindings for Studio calls and `fetch` (or the helper) for ingestion, media, and anything that needs exact bytes or response headers. In stacks without bindings, generate types or a client from the spec.
7. Use shared state for anything other users or later sessions should see. Use the helper's `writeJson()` for settings, and handle conflicts.
8. Configure the Content-Security-Policy header for the user's host, adding exact origins for anything else the app loads ([STACKS.md](references/STACKS.md#response-headers)), and give them the registration values: URL, `navbarLocation`, `requiredApiKeyRole`, `authMethod: api_key_via_postmessage`, and `visibility`.
9. Finish with the review checklist and tell the user how to test standalone and embedded.
