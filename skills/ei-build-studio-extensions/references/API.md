# Calling the Edge Impulse APIs from an extension

An extension talks to two services, both with the same project API key in the `x-api-key` header:

| Service | Default origin | Base path | Used for |
| --- | --- | --- | --- |
| Studio API | `https://studio.edgeimpulse.com` (`studioHost`) | `/v1/api/…` | Almost everything: project, data, impulse, jobs, shared state |
| Ingestion API | `https://ingestion.edgeimpulse.com` (`ingestionHost`) | `/api/…` | Uploading new samples |

Both send CORS headers, so a browser app can call them directly.

## Contents

- [Find the right endpoint](#find-the-right-endpoint)
- [Load the bindings](#load-the-bindings)
- [Authenticate](#authenticate)
- [Raw REST with fetch](#raw-rest-with-fetch)
- [Namespaces](#namespaces)
- [Return values depend on the content type](#return-values-depend-on-the-content-type)
- [Long-running jobs](#long-running-jobs)
- [Upload data](#upload-data)
- [Sample images and audio](#sample-images-and-audio)
- [Learn block custom data](#learn-block-custom-data)
- [Errors](#errors)
- [Performance](#performance)

## Find the right endpoint

The [OpenAPI spec](https://studio.edgeimpulse.com/openapi.yml) is the source of truth for the Studio API. Look up every call there before you write it, whether you use the bindings, `fetch`, Python, or a backend. Check the path, method, parameters, request body, and response schema. Don't guess names or shapes from memory, from older code, or from the examples in this skill.

The spec is large (about 1 MB), so search it instead of reading it whole:

```bash
curl -sL https://studio.edgeimpulse.com/openapi.yml -o openapi.yml
grep -n "operationId: listSamples$" openapi.yml       # a bindings method → its operation
grep -n "^  /api/{projectId}/raw-data" openapi.yml    # a path → its operations
grep -n "^    ListSamplesResponse:" openapi.yml       # a request or response schema
```

Read from the matching line down to the next entry at the same indentation. Fetch a fresh copy when you start work, because new endpoints and fields land often. The [Studio API reference](https://docs.edgeimpulse.com/apis/studio) shows the same API as browsable pages.

The bindings follow the spec's names and parameter order, so the spec tells you exactly how to call them:

| In the spec | In the bindings | Example |
| --- | --- | --- |
| `servers` (`https://studio.edgeimpulse.com/v1`) | `{studioHost}/v1`, from the `endpoint` you pass | |
| The operation's tag | The namespace, in camelCase | `Raw data` → `api.rawData` |
| `operationId` | The method name | `listSamples` → `api.rawData.listSamples()` |
| Path parameters | The leading arguments, in path order | `getSampleAsImage(projectId, sampleId, …)` |
| Request body, then query parameters | The next arguments, as objects | `batchEditLabels(projectId, body, queryParams)` |

- **No bindings for your stack?** Generate types or a client from the spec. For typed `fetch` calls in TypeScript, `npx openapi-typescript openapi.yml -o studio-api.d.ts` works. For other languages, use an OpenAPI client generator. Point the generated client at `{studioHost}/v1`, not the server URL hard-coded in the spec.
- **Not in the spec yet:** the extension endpoints, which are registration (`/api/organizations/{organizationId}/extension…`), a project's available and active extensions, and shared state (`/api/{projectId}/extensions/…`). Search the spec first anyway, and if it lists them, it wins. Until it does, use the bindings' type declarations, [`edge-impulse-api.d.ts`](https://studio.edgeimpulse.com/api-bindings/browser/edge-impulse-api.d.ts), together with [SHARED-STATE.md](SHARED-STATE.md) and [the registration fields](STUDIO-CONTRACT.md#register-the-extension).
- **The Ingestion API isn't in the spec.** Its reference is the [Ingestion API documentation](https://docs.edgeimpulse.com/apis/ingestion) ([Upload data](#upload-data)).

## Load the bindings

`edge-impulse-api` is the generated JavaScript and TypeScript client for the whole Studio API.

**No build step.** The hosted script always serves the current version and defines a global `EdgeImpulseApi`:

```html
<script src="https://studio.edgeimpulse.com/api-bindings/browser/edge-impulse-api.js"></script>
```

A minified build is at `edge-impulse-api.min.js` and type declarations at `edge-impulse-api.d.ts`, both in the same folder. To pin a version or avoid the extra origin, download the file and serve it yourself, and refresh it when you need newer APIs.

**Bundlers and Node:**

```bash
npm install edge-impulse-api
```

```ts
import { EdgeImpulseApi } from 'edge-impulse-api';
```

The postMessage handshake, shared state, and learn block custom data are recent additions. Check that a vendored copy is new enough:

```bash
grep -c __POSTMESSAGE__ edge-impulse-api.js        # 0 means too old for the handshake
```

**Python.** The `edgeimpulse-api` package wraps the same REST API, and plain `requests` with an `x-api-key` header works too. To run Python in the browser, see [Pyodide and Python in the browser](STACKS.md#pyodide-and-python-in-the-browser).

## Authenticate

```js
const api = new EdgeImpulseApi({ endpoint: conn.studioHost });   // validated origin, no /v1
await api.authenticate({ method: 'apiKey', apiKey: conn.apiKey });
```

- `endpoint` comes from `studioHost`. Don't hard-code the public Studio, or the extension can't run against any other deployment.
- Pass the real key from the helper, or `'__POSTMESSAGE__'` to let the bindings run the handshake (see [SKILL.md](../SKILL.md#with-the-bindings-only)).
- Extensions only ever use `method: 'apiKey'`. The bindings also support `jwtToken` for account-level tooling. Never collect Edge Impulse usernames or passwords in an extension.

## Raw REST with fetch

Every bindings method maps to `{studioHost}/v1{path}`, where `path` is the operation's path in the [OpenAPI spec](#find-the-right-endpoint). Use `fetch` when you need exact bytes, response headers, streaming, or a language without bindings:

```js
const res = await fetch(`${conn.studioHost}/v1/api/${projectId}/raw-data?category=training&limit=20`, {
  headers: { 'x-api-key': conn.apiKey },
});
if (!res.ok) throw new Error(`Studio API ${res.status}`);
const { samples, totalCount } = await res.json();
```

The helper wraps this with error handling:

```js
import { apiFetch, apiFetchJson, ApiError } from './ei-extension.js';

const body = await apiFetchJson(conn, `/api/${projectId}/raw-data?category=training&limit=20`);
// ApiError has .status and the API's error message. success: false bodies throw too.
```

## Namespaces

The client groups calls by area. Common ones for extensions:

```js
// Project
const { projectId, role, expires } = await api.projects.getCurrentApiKeyInfo();
const { project } = await api.projects.getProjectInfo(projectId);          // project.name, …

// Data. category is required: 'training' | 'testing' | 'validation' | 'post-processing' | 'all'
const { samples, totalCount } = await api.rawData.listSamples(projectId, {
  category: 'training', limit: 50, offset: 0,
});
const { sample } = await api.rawData.getSample(projectId, sampleId);

// Impulse and blocks
const { impulse } = await api.impulse.getImpulse(projectId);
// also api.dsp, api.learn, api.deployment, api.classify, api.jobs, api.devices
```

For any other call, and for the exact parameters and response of these, look the operation up in the OpenAPI spec first ([Find the right endpoint](#find-the-right-endpoint)). The bindings method name is the spec's `operationId`.

## Return values depend on the content type

The bindings choose the return value from the response's `Content-Type`, not from the method:

| Response `Content-Type` | Bindings return |
| --- | --- |
| `application/json` | A parsed object. ISO-8601 date strings become `Date` objects. A body with `success: false` throws. |
| `image/*`, `video/*`, `audio/*`, `application/octet-stream`, `zip`, `x-tar`, `cbor` | An `ArrayBuffer` (a `Buffer` in Node) |
| Anything else (`text/plain`, `text/csv`, …) | A string |

Endpoints that return stored files with their own type (learn block custom data, shared state) can therefore return any of the three. When you need a `Blob`, the exact bytes, or a response header, use `fetch`. To read response headers through the bindings, pass `{ headers: {}, responseHeadersCallback: (h) => … }` as the last argument. It's called on the next tick after the call resolves.

## Long-running jobs

Training, feature generation, exports, and builds return a job ID. Start the job, then wait with `runJobUntilCompletion`, which takes a job **reference**:

```js
const { id: jobId } = await api.jobs.startRetrainJob(projectId, { impulseId });   // needs a role that can write

await api.runJobUntilCompletion(
  { type: 'project', projectId, jobId },
  (line) => log.append(line),          // job output as it streams
);
```

- It streams logs over a websocket (`wss://` on the Studio host) and polls the job status every few seconds. Your CSP's `connect-src` must list the Studio host's `wss://` origin: an `https://` source doesn't cover it, and a blocked socket fails the wait after 60 seconds of retries ([CSP](STUDIO-CONTRACT.md#content-security-policy)).
- It throws if the job fails. Show the error and the last log lines.
- While a job runs, disable the control that started it and show progress. Never leave the page silent for minutes.
- To list or cancel jobs, see `api.jobs.listActiveJobs`, `getJobStatus`, and `cancelJob`.

## Upload data

Uploads go to the Ingestion API, a separate origin that the Studio bindings don't cover. Validate `ingestionHost` too: the key goes there.

```js
import { uploadToIngestion } from './ei-extension.js';

await uploadToIngestion(conn, { files: input.files[0], category: 'training', label: 'faulty' });
```

Without the helper:

```js
const body = new FormData();
body.append('data', file, file.name);           // up to 1000 files per request, all named 'data'

const res = await fetch(`${conn.ingestionHost}/api/training/files`, {
  method: 'POST',
  headers: { 'x-api-key': conn.apiKey, 'x-label': 'faulty' },   // don't set Content-Type
  body,
});
if (!res.ok) throw new Error(`Ingestion API ${res.status}: ${await res.text()}`);
```

- Paths: `/api/training/files`, `/api/validation/files`, `/api/testing/files`, `/api/post-processing/files`, and `/api/split/files` (split across training, validation, and testing using the project's split settings).
- Leave `Content-Type` unset so the browser adds the multipart boundary.
- Other headers (`x-label`, `x-no-label`, `x-add-date-id`, `x-disallow-duplicates`, …) are in the [Ingestion API reference](https://docs.edgeimpulse.com/apis/ingestion).
- The key needs a role that can ingest: `ingestiononly`, `ingestion_deployment`, or `admin`.
- Reading, relabeling, moving, and deleting samples stay on the Studio API (`api.rawData`).

## Sample images and audio

Studio media URLs need the key. Using one as a raw `<img src>` returns `401`. Fetch it with the key and hand the element an object URL:

```js
import { fetchObjectUrl } from './ei-extension.js';

img.src = await fetchObjectUrl(conn, `/v1/api/${projectId}/raw-data/${sampleId}/image`);
// later, when the element is removed:
URL.revokeObjectURL(img.src);
```

`fetchObjectUrl` refuses URLs on any origin other than Studio's, so the key can't be sent elsewhere by mistake. Revoke object URLs as rows leave the page, or a long list leaks memory. The spec lists the media endpoints under `/api/{projectId}/raw-data/{sampleId}/` (`image`, `wav`, `video`, `raw`, …) with their query parameters and content types. Pick the one for your data type there.

## Learn block custom data

A learning block can leave extra files for an extension: per-sample scores, embeddings, plots, a report. Anything the training script writes under **`/home/custom_data`** is kept with the learn block and is readable through the API after training. This works for custom learning blocks and for expert mode.

Producer, in the training script:

```python
import json, os

out = "/home/custom_data"
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "manifest.json"), "w") as f:
    json.dump({"version": 1, "files": ["scores.csv"]}, f)
with open(os.path.join(out, "scores.csv"), "w") as f:
    f.write("sample_id,score\n")
```

Consumer, in a `learn_block` extension (`impulseId` and `learnId` arrive in the URL):

```js
import { listLearnBlockCustomData, readLearnBlockCustomData } from './ei-extension.js';

const files = await listLearnBlockCustomData(conn, projectId, context.learnId);
// [{ path: 'manifest.json', mimeType: 'application/json', size: 41 }, …], or [] before training

if (!files.length) {
  showEmptyState('Train this learning block to generate data for this view.');
} else {
  const manifest = await (await readLearnBlockCustomData(conn, projectId, context.learnId, 'manifest.json')).json();
  const plot = await (await readLearnBlockCustomData(conn, projectId, context.learnId, 'plots/loss.png')).blob();
  img.src = URL.createObjectURL(plot);
}
```

With the bindings: `api.learn.listLearnBlockCustomDataFiles(projectId, learnId)` and `api.learn.readLearnBlockCustomDataFile(projectId, learnId, { path })`. The second returns an object, string, or `ArrayBuffer` depending on the file's type ([content types](#return-values-depend-on-the-content-type)).

- `path` is relative to `custom_data`, exactly as the list returns it. The list recurses a few folder levels deep, so keep the layout shallow.
- Only regular files are listed and readable. Symlinks are skipped, and paths that escape `custom_data` read as not found.
- **An untrained block lists `[]`.** Show an empty state that says to train the block, not an error.
- **Ship a manifest.** Read a small versioned JSON file first, so the extension knows what to expect and notices when the training script changes.
- Both calls only need read access, so a `readonly` key is enough.

## Errors

The bindings throw a plain `Error` with the API's `error` message and no status code. Some failures are rejected with a **string** (for example the postMessage timeout), so read errors with `describeError()` or `typeof err === 'string' ? err : err.message`. The helper's `ApiError` carries `.status`.

| Symptom | Usual cause | What to tell the user |
| --- | --- | --- |
| `401` inside Studio | The extension key expired or was revoked (extension removed, or its URL or role changed) | Reload the page in Studio. Asking Studio again returns the same key. |
| `401` standalone | Wrong key, revoked key, or a key for another project | Check the key in the project's Keys tab |
| `'No "set_api_key" message received via postMessage within 10 seconds'` | Not embedded, the app redirected to another origin, or `endpoint` isn't the Studio that framed the app | Open the extension from Studio. Check `studioHost` and redirects. |
| `"auth.apiKey" should start with "ei_"` with `__POSTMESSAGE__` | Bindings older than the handshake | Load current bindings |
| `403` | The key's role can't do this, or the feature isn't on the project's plan | Say which permission is missing |
| "This API can only be used using an API key attached to an extension" | Shared state with a dashboard key | Shared state works when opened from Studio ([SHARED-STATE.md](SHARED-STATE.md#requirements)) |
| `404` on a project route | `projectId` doesn't match the key's project | Resolve the project from the key |
| CORS error in the console | Wrong host, a proxy that strips CORS headers, or a CSP `connect-src` that blocks the call | Check `studioHost`, `ingestionHost`, and your CSP |

Show errors in the page, not only in the console. Never log the key, a URL containing it, or request headers to analytics or error trackers.

## Performance

- Fetch once and derive in memory. Don't call `listSamples` once per row.
- Paginate with `limit` and `offset` at the API instead of fetching everything.
- Request the category you show (`training`, `testing`) rather than `all`.
- Run independent requests in parallel (`Promise.all`), and cap concurrency for large batches such as thumbnails.
- Cache large derived results in shared state or IndexedDB, keyed by a version, rather than recomputing on every load ([SHARED-STATE.md](SHARED-STATE.md#cache-locally-by-version)).
