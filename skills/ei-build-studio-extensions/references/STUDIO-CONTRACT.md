# Studio extension contract

Everything Studio does around your extension, and what it expects back. The SKILL.md has the summary; this file has the detail.

## Contents

- [Register the extension](#register-the-extension)
- [Scopes and URL parameters](#scopes-and-url-parameters)
- [Get the API key](#get-the-api-key)
- [Key lifetime](#key-lifetime)
- [Messages Studio handles](#messages-studio-handles)
- [The iframe sandbox](#the-iframe-sandbox)
- [Content-Security-Policy](#content-security-policy)
- [Run locally](#run-locally)
- [Deploy](#deploy)

## Register the extension

Studio only embeds registered extensions. Each extension belongs to an organization, or to your personal developer profile, and from there it can be enabled on projects. Register it on the **Extensions** page of the organization or profile that owns it, or with the API:

```js
// POST /v1/api/organizations/{organizationId}/extension (multipart form)
await api.organizationBlocks.addOrganizationExtensionBlock(organizationId, {
  name: 'Label audit',
  description: 'Finds samples whose label disagrees with the model.',
  url: 'https://label-audit.example.com/',
  navbarLocation: 'project',
  requiredApiKeyRole: 'readonly',
  authMethod: 'api_key_via_postmessage',
  visibility: 'project',
  onlyAvailableInProjectId: 12345,   // required when visibility is 'project'
});
```

Registration is an account-level action: run it from a script with an organization API key or JWT, never from inside an extension.

| Field | Required | Values and notes |
| --- | --- | --- |
| `name`, `description` | Yes | Shown in Studio's navigation and extension list |
| `url` | Yes | Where the app is served. HTTPS, except `http://localhost` for development. No credentials in the URL, and not on `edgeimpulse.com`. Query parameters you add are kept. |
| `navbarLocation` | Yes | The scope: the Studio page that shows the extension. See [Scopes](#scopes-and-url-parameters). |
| `requiredApiKeyRole` | Yes | The role of the key Studio issues: `readonly`, `ingestiononly`, `ingestion_deployment`, or `admin`. Pick the least that works. |
| `authMethod` | Yes | `api_key_via_postmessage`. The legacy `api_key_via_url` puts the key in the URL, where it ends up in history and logs. Don't use it. |
| `visibility` | No | `project` (one project, set `onlyAvailableInProjectId`), `organization` (default), or `everyone` |
| `publicProjectTierAvailability` | No | With `everyone`: `enterprise-only`, `all-projects`, or `all-projects-including-whitelabels` |
| `repositoryUrl`, `logo`, `navbarIcon` | No | Source link, logo image file, and a Font Awesome icon class for the navigation entry |
| `requireAdminInstall` | No | `true` lets only organization administrators enable the extension on projects |
| `hideSideMenu` | No | `true` hides Studio's side menu while the extension is open |
| `showOnLearnBlockTypes` | No | For `learn_block` locations: the learn block types to show the extension on. Unset or empty means all. |
| `indBlockNoLongerAvailable`, `blockNoLongerAvailableReason` | No | Retire an extension without deleting it |

Related calls: `updateOrganizationExtensionBlock`, `deleteOrganizationExtensionBlock`, and `getOrganizationExtensionBlock` on `api.organizationBlocks`. On a project: `api.projects.listProjectAvailableExtensions`, `getProjectActiveExtensions`, `addProjectActiveExtension(projectId, { extensionId })`, and `removeProjectActiveExtension`. Look for these in the [OpenAPI spec](API.md#find-the-right-endpoint) first. They aren't listed there yet, so until they are, check exact names and parameters in the hosted bindings' type declarations (`https://studio.edgeimpulse.com/api-bindings/browser/edge-impulse-api.d.ts`).

**Granting access.** The first time a user opens the extension in a project, Studio asks them to grant it access, then issues a key with the requested role. Changing `url` or `requiredApiKeyRole` later voids every grant, so users are asked again.

**Origin.** Studio answers messages only from the **origin of the registered `url`**. Keep the whole app on that origin. A redirect to another host (for example from an apex domain to `www`, or to a login page) means Studio drops your messages and never sends a key.

## Scopes and URL parameters

| `navbarLocation` | Extra parameters |
| --- | --- |
| `project` | None |
| `impulse` | `impulseId` |
| `dsp_block` | `impulseId`, `dspId` |
| `learn_block` | `impulseId`, `learnId` (no `dspId`) |

Every scope also gets `apiKey=__POSTMESSAGE__`, `projectId`, `studioHost`, and `sharedState`, and may get `ingestionHost`.

The other locations (`devices`, `data_acquisition`, `experiments`, `create_impulse`, `upload_model`, `live_classification`, `model_testing`, `deployment`, `versioning`) place the extension next to those Studio pages. Treat them like `project` scope. The bindings also list `data_acquisition_top_navbar`, `dsp_block_top_navbar`, `learn_block_top_navbar`, and `organization_dashboard`. For any location other than the four above, log `location.search` once during development to see exactly what arrives.

Check the IDs your scope needs before using them, and show a clear message when one is missing:

```js
import { readStudioContext, missingScopeParams } from './ei-extension.js';

const context = readStudioContext();
const missing = missingScopeParams(context, 'learn_block');   // e.g. ['learnId']
if (missing.length) showMessage(`Open this extension from a learning block (missing ${missing.join(', ')}).`);
```

`sharedState` is a JSON object such as `{"settings":3,"last_view":12}`: every shared state key this extension has in the project, with its current version. See [SHARED-STATE.md](SHARED-STATE.md).

## Get the API key

Studio loads the extension with `apiKey=__POSTMESSAGE__`. The real key arrives over `postMessage`:

1. The extension adds a `message` listener, then posts `{ type: 'REQUEST_API_KEY' }` to `window.parent`, targeted at the Studio origin.
2. Studio checks that the message came from the extension's iframe and from the registered origin. It replies with `{ type: 'set_api_key', apiKey: 'ei_…' }`, targeted at the extension's origin.
3. The extension accepts the reply only if `event.source === window.parent` and `event.origin` equals the Studio origin it validated, and `apiKey` is a string starting with `ei_`.

The key never touches the URL, browser history, or server logs.

Rules for any implementation, in any language:

- Validate `studioHost` **before** asking. It decides which origin you ask and accept a key from.
- Post to that exact origin, never `'*'`.
- Listen before posting, and remove the listener once you have the key.
- Time out (the bindings use 10 seconds) and show "Reload the page in Studio" rather than hanging.
- Ignore messages that fail the checks. Don't throw on them: other scripts post messages too.

`requestApiKeyFromStudio()` in the helper is a complete implementation. A minimal one:

```js
function requestApiKeyFromStudio(studioOrigin, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', onMessage); reject(new Error('No key from Studio')); }, timeoutMs);
    function onMessage(ev) {
      if (ev.source !== window.parent || ev.origin !== studioOrigin) return;
      if (ev.data?.type !== 'set_api_key' || typeof ev.data.apiKey !== 'string') return;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(ev.data.apiKey);
    }
    addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'REQUEST_API_KEY' }, studioOrigin);
  });
}
```

### Trusted hosts

The key is requested from `studioHost` and sent to `studioHost` and `ingestionHost`, so both are an allowlist decision:

- HTTPS on `edgeimpulse.com` or any subdomain: allowed.
- `localhost`, `127.0.0.1`, or `[::1]`: allowed only while the extension itself runs on loopback (development).
- Anything else: allowed only if you add the exact origin to `trustedOrigins`, for example a private or self-hosted Studio on its own domain. No wildcards.
- URLs with a username or password: rejected.

### Resolve the project, don't ask for it

Every project API key belongs to exactly one project, so the key identifies the project. Use `projectId` from the URL when it's there, and otherwise read it from the key with `GET /v1/api/projects/api-key-info` (`api.projects.getCurrentApiKeyInfo()`, or `resolveProjectId()` in the helper). Never prompt for a project ID.

## Key lifetime

- Keys issued to extensions are short-lived (currently about a day), and Studio rotates them on page load before they run out. Read `expires` from the key info rather than assuming a lifetime.
- Studio answers every `REQUEST_API_KEY` with the key the page loaded with, so asking again won't replace an expired key. On a `401` inside Studio, tell the user to reload the page.
- `getApiKeyInfo()` (helper) or `api.projects.getCurrentApiKeyInfo()` returns `{ apiKeyId, projectId, role, expires }`. `expires` is set on extension keys.
- Removing the extension from a project revokes its keys and deletes its shared state.

## Messages Studio handles

| Message | Direction | Payload |
| --- | --- | --- |
| `REQUEST_API_KEY` | Extension → Studio | `{ type: 'REQUEST_API_KEY' }` |
| `set_api_key` | Studio → extension | `{ type: 'set_api_key', apiKey: 'ei_…' }` |
| `IFRAME_HEIGHT` | Extension → Studio | `{ type: 'IFRAME_HEIGHT', height: <pixels> }` |

Studio ignores anything else, and anything from an origin other than your registered URL's.

**Sizing.** Either fill the frame and scroll inside it, or report your content height whenever it changes so Studio resizes the iframe:

```js
const stop = startHeightReporter(conn.studioHost);   // helper: ResizeObserver, deduplicated
// or by hand:
new ResizeObserver(() => window.parent.postMessage(
  { type: 'IFRAME_HEIGHT', height: document.body.scrollHeight }, studioOrigin)).observe(document.body);
```

Avoid layouts whose height depends on the viewport height (`100vh`) when you report height: the frame grows, the viewport grows, and the loop never settles.

## The iframe sandbox

Studio frames extensions with:

```html
<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer">
```

and no `allow` attribute, so no permission-policy features.

| Feature | Status | Alternative |
| --- | --- | --- |
| Scripts, forms, `fetch`, WebAssembly, Web Workers | Work | |
| Your own origin's storage (`localStorage`, IndexedDB, Cache API) | Works, but partitioned | Shared state for data that must persist or be shared |
| Cookies to your own backend | Often blocked as third-party cookies | Send credentials in headers; never the Edge Impulse key to anyone but Studio and Ingestion |
| `alert()`, `confirm()`, `prompt()`, `print()` | Blocked (no `allow-modals`) | In-page dialogs |
| Downloads (`<a download>`, `Content-Disposition: attachment`, `blob:` links) | Blocked (no `allow-downloads`); popups inherit the sandbox | Render the result in the page, or provide text to copy |
| Navigating the top window | Blocked (no `allow-top-navigation`) | `<a target="_blank" rel="noopener">` |
| Camera, microphone, geolocation, fullscreen, clipboard write, WebUSB, Web Serial | Blocked (no `allow` features) | `<input type="file">` for files recorded elsewhere; selectable text instead of a copy button |
| `document.referrer` | Empty (`no-referrer`) | `studioHost` |

**Storage partitioning.** Browsers key a cross-site iframe's storage by the top-level site. Data your app saves while embedded in Studio isn't visible when the app is opened directly, and the reverse. Clearing Studio's site data clears it too. Never store the API key there.

## Content-Security-Policy

Send this policy on every HTML response. *Allowed origins* are the Edge Impulse services the app uses: `https://studio.edgeimpulse.com` and `https://ingestion.edgeimpulse.com`, plus any other Studio or ingestion host you accept through `studioHost`, `ingestionHost`, or `trustedOrigins`.

```text
default-src     'self' <allowed origins>;
base-uri        'self';
connect-src     'self' <allowed origins> wss://studio.edgeimpulse.com;
font-src        'self';
form-action     'self' <allowed origins>;
frame-ancestors 'self' https://studio.edgeimpulse.com;
img-src         'self' <allowed origins> data: blob:;
manifest-src    'self';
media-src       'self' <allowed origins> blob:;
object-src      'none';
script-src      'self' <allowed origins> 'unsafe-inline' 'unsafe-eval';
style-src       'self' <allowed origins> 'unsafe-inline';
worker-src      'self' blob:
```

It's shown one directive per line for reading. Send it as a single header line: [STACKS.md](STACKS.md#response-headers) has it ready to paste, and the header setup for common hosts and frameworks.

| Directive | What it allows |
| --- | --- |
| `default-src` | Anything a more specific directive doesn't cover: your origin and the Edge Impulse services |
| `base-uri` | A `<base>` tag pointing at your origin only, so injected markup can't redirect relative URLs |
| `connect-src` | `fetch`, XHR, and websockets to the Studio API and Ingestion. `wss://` is for the job websocket that `runJobUntilCompletion` opens: an `https://` source doesn't match `wss://`, and without it the bindings retry for 60 seconds, then fail the job wait. |
| `font-src` | Fonts from your origin. Self-host them, or add the font host. |
| `form-action` | Form submissions to your origin and the Edge Impulse services |
| `frame-ancestors` | Framing by Studio and your own origin only |
| `img-src` | Images from the Edge Impulse services, `data:` URIs, and `blob:` object URLs for media fetched with the key |
| `manifest-src` | A web app manifest from your origin |
| `media-src` | Audio and video from the Edge Impulse services and `blob:` object URLs |
| `object-src` | No plugins (`<object>`, `<embed>`) |
| `script-src` | Your scripts, the hosted bindings from Studio, inline scripts, and `eval`. Pyodide and other WebAssembly runtimes need `'unsafe-eval'`. The bindings don't, so drop it if nothing else needs it. |
| `style-src` | Your styles, inline `<style>` blocks, and `style` attributes |
| `worker-src` | Web Workers from your origin or `blob:` URLs |

- **It must be an HTTP response header.** Browsers ignore `frame-ancestors` in a `<meta>` tag.
- **`frame-ancestors` must name Studio.** With `'self'` alone, the browser refuses to let Studio frame an app on another origin. Add other Studio origins with spaces: `frame-ancestors 'self' https://studio.edgeimpulse.com https://studio.example.com`. Without the directive, any site can frame your app and try to trick users into acting in it.
- **Don't send `X-Frame-Options: DENY` or `SAMEORIGIN`.** Some hosts and frameworks add one by default. Remove it.
- **Add exact origins, only to the directives that need them.** A script CDN goes in `script-src`, a third-party API in `connect-src`, and a font host in `font-src`. Never use `*`, `https:`, or `http:`, and don't add `'unsafe-*'` keywords beyond the ones above.
- **Send the same policy from your dev server.** Then a blocked script or request shows up locally, not after you deploy. The browser console names the directive and the URL it blocked (`Refused to connect to … because it violates … connect-src`).

Also recommended: `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.

## Run locally

**Standalone** is fastest for UI work. Run your dev server, open the app directly, and paste a project API key from the **Keys** tab of the project dashboard. Pass scope IDs in the URL yourself:

```text
http://localhost:8080/                               project scope
http://localhost:8080/?impulseId=1                   impulse scope
http://localhost:8080/?impulseId=1&dspId=3           dsp_block scope
http://localhost:8080/?impulseId=1&learnId=5         learn_block scope
```

A dashboard key isn't attached to an extension, so shared state refuses it (see [SHARED-STATE.md](SHARED-STATE.md#requirements)). Everything else works.

**Embedded in Studio** is the only way to test the handshake, the issued key's role, and shared state:

1. Register a second, development extension with `visibility: 'project'` (only your test project sees it) and `url: 'http://localhost:8080/'`. Studio accepts `http://` for localhost.
2. Make your dev server send the [Content-Security-Policy](#content-security-policy), with Studio in `frame-ancestors`. `assets/server.js` does; see [STACKS.md](STACKS.md#response-headers) for Vite and others.
3. Open the project in Studio and pick the extension in the navigation.

Chromium-based browsers and Firefox treat `http://localhost` as a secure context, so an HTTPS Studio page can frame it. If your browser blocks it as mixed content, put an HTTPS tunnel in front of the dev server and register the tunnel URL. Tunnel URLs that change between sessions void the grant each time; a stable tunnel hostname avoids that.

**A different Studio.** To test against a private or self-hosted Studio, pass its origins in the URL (`?studioHost=…&ingestionHost=…`) or the connect form's Advanced fields, add them to `trustedOrigins`, and add them to your CSP: both as allowed origins, the Studio origin in `frame-ancestors`, and its `wss://` origin in `connect-src`. For `server.js`, set `STUDIO_ORIGIN="https://studio.edgeimpulse.com https://studio.example.com"` and `INGESTION_ORIGIN` the same way.

## Deploy

1. Build static files, or deploy your server, to a host that serves HTTPS and lets you set response headers ([STACKS.md](STACKS.md#response-headers)).
2. Configure the [Content-Security-Policy](#content-security-policy) header, and remove any `X-Frame-Options`.
3. Check the headers are live:

   ```bash
   curl -sI https://your-app.example.com/ | grep -i -E 'content-security-policy|x-frame-options'
   ```

4. Register the production URL (or update the existing extension) with `authMethod: 'api_key_via_postmessage'`. Changing the URL asks every user to grant access again.
5. Open it from a project in Studio and confirm the key arrives: the app loads data without showing the connect form.

There are no secrets to deploy. Studio supplies the key at runtime. If your backend needs its own credentials, keep them server-side.
