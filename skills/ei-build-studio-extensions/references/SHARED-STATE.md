# Extension shared state

Studio gives every extension enabled in a project a small key-value store on the server. Each key holds one **blob** (any bytes, with a content type) and a **version** that goes up by one on every write. The store belongs to the extension's installation in that project, so everyone who opens the extension there reads and writes the same data, in any browser.

Use it for:

- **Settings** the team should share, such as thresholds, selected classes, or a chart configuration.
- **The last result**, so the page renders instantly next time instead of recomputing.
- **Files the user edits** inside the extension, such as notebooks or scripts.

Don't use it for secrets (everyone using the extension in the project can read it), private per-user preferences, or as a dataset. Samples belong in the project, through the Ingestion API.

| Store | Who sees it | Lasts |
| --- | --- | --- |
| Shared state | Everyone using the extension in this project | Until deleted, or until the extension is removed from the project |
| `localStorage`, IndexedDB | This browser only, partitioned under Studio's site | Until the browser clears it |
| Your own backend | Whatever you build | Whatever you build |

## Contents

- [Requirements](#requirements)
- [Data model](#data-model)
- [Endpoints](#endpoints)
- [Using the helper](#using-the-helper)
- [Using the bindings or fetch](#using-the-bindings-or-fetch)
- [Conflicts](#conflicts)
- [Cache locally by version](#cache-locally-by-version)
- [Pick up other users' changes](#pick-up-other-users-changes)
- [Naming keys](#naming-keys)
- [Checklist](#checklist)

## Requirements

- **A key Studio issued to the extension.** Each call checks that the key belongs to an enabled extension. A key from the project dashboard, such as one pasted into the connect form, fails with *"This API can only be used using an API key attached to an extension"*. The helper raises `SharedStateUnavailableError` for this. Keep the extension working without saving, and say so in the page.
- **Any role.** All calls accept a `readonly` key, so a read-only extension can still save its own state.
- **Current bindings,** if you use them. The methods are on `api.projects` in recent `edge-impulse-api` builds. Check the [OpenAPI spec](API.md#find-the-right-endpoint) first. The shared state endpoints aren't listed there yet, so until they are, this page and the bindings' `edge-impulse-api.d.ts` describe them.

## Data model

- **Keys:** 2 to 80 characters from `A-Z a-z 0-9 _ -`, starting and ending with a letter or digit: `^[A-Za-z0-9][A-Za-z0-9_-]{0,78}[A-Za-z0-9]$`. No dots, slashes, or spaces. To key by a path or long name, hash it (`sha256Hex()` in the helper) and keep the real name inside the value.
- **Values:** one file per write, up to **100 MB** per key. The content type and filename you send are stored and returned on read.
- **Versions:** a key that has never been written reads as version `0`. Each successful write returns `newVersion`, the previous version plus one. After a delete, versions can start again at `1`.
- **Index:** Studio passes the current `{ key: version }` map in the `sharedState` URL parameter, so the first render needs no list request.
- **Scope:** one store per extension per project, shared by every page and scope of the extension. There is no per-impulse or per-block partition; put that in the key ([Naming keys](#naming-keys)).

## Endpoints

| Bindings (`api.projects.…`) | REST (`{studioHost}/v1`) | Returns |
| --- | --- | --- |
| `getExtensionSharedStateList(projectId)` | `GET /api/{projectId}/extensions/shared-state/list` | `{ sharedState: [{ key, version }] }` |
| `getExtensionSharedState(projectId, { key })` | `GET /api/{projectId}/extensions/shared-state?key=` | The stored bytes with their `Content-Type`, plus an `x-version` header. An unset key returns an empty body and `x-version: 0`. |
| `setExtensionSharedState(projectId, { currentVersion, state }, { key })` | `POST /api/{projectId}/extensions/shared-state?key=` (multipart: `currentVersion`, and a `state` file) | `{ status: { type: 'success', newVersion } }` or `{ status: { type: 'conflict', conflictError } }` |
| `deleteExtensionSharedState(projectId, { key })` | `DELETE /api/{projectId}/extensions/shared-state?key=` | `{ success: true }` |

Writes are **optimistic**: you send the version you last saw as `currentVersion` (`0` for a new key), and the server refuses the write with `conflict` if someone else saved in between.

## Using the helper

`SharedStateClient` in `assets/ei-extension.js` handles the index, versions, per-key write queues, conflicts, and the dashboard-key case:

```js
import { SharedStateClient, SharedStateUnavailableError } from './ei-extension.js';

const state = new SharedStateClient(conn, projectId);   // starts from the sharedState URL index

// Read: null when unset. Validate the shape; anyone with access to the project can write it.
const settings = { threshold: 0.6, ...(await state.readJson('settings', {})) };

// Write: throws SharedStateConflictError if someone else saved first.
await state.writeJson('settings', { v: 1, ...settings, threshold: 0.7 });

// Binary data
await state.write('last_plot', pngBlob);
const stored = await state.read('last_plot');           // { version, blob } | null
if (stored) img.src = URL.createObjectURL(stored.blob);

// Delete
await state.delete('last_plot');
```

`writeJson()` stores JSON as `text/plain` on purpose. The bindings parse `application/json` responses and throw on any body containing `success: false`, which a stored value might.

Degrade when shared state isn't available:

```js
try {
  await state.writeJson('settings', settings);
} catch (err) {
  if (err instanceof SharedStateUnavailableError) showNotice('Settings are saved when the extension is opened from Studio.');
  else throw err;
}
```

## Using the bindings or fetch

Read with `fetch` when you need the exact bytes and the version:

```js
const res = await fetch(
  `${conn.studioHost}/v1/api/${projectId}/extensions/shared-state?key=${encodeURIComponent(key)}`,
  { headers: { 'x-api-key': conn.apiKey } });
if (!res.ok) throw new Error(`Shared state ${res.status}`);
const version = Number(res.headers.get('x-version') ?? index[key] ?? 0);   // exposed over CORS
const blob = version ? await res.blob() : null;
```

Through the bindings, the return value follows the stored content type: an object for JSON, a string for text, or an `ArrayBuffer` for binary ([API.md](API.md#return-values-depend-on-the-content-type)). Pass `responseHeadersCallback` to read `x-version`.

Write with a version check. The bindings take the file as `{ value, options: { filename, contentType } }`, not a bare `Blob`:

```js
const res = await api.projects.setExtensionSharedState(
  projectId,
  {
    currentVersion: index[key] ?? 0,
    state: { value: JSON.stringify(value), options: { filename: `${key}.json`, contentType: 'text/plain' } },
  },
  { key },
);
if (res.status.type === 'conflict') throw new ConflictError(key);   // see Conflicts
index[key] = res.status.newVersion;
```

With `fetch`, send multipart form data with `currentVersion` and a `state` file (`form.append('state', blob, filename)`), and leave `Content-Type` unset.

Queue writes **per key**, so two quick saves of the same key don't race each other into a conflict with yourself:

```js
const queues = new Map();
function queueWrite(key, blob) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => write(key, blob));
  queues.set(key, next);
  return next;
}
```

Skip the read when you can. If the index says a key doesn't exist, use the default without a request.

## Conflicts

A conflict means someone else saved since you last read. Decide per key:

| Kind of data | Resolution |
| --- | --- |
| Caches and derived results | **Last writer wins.** Reload the index and retry against the new version. |
| Settings and user-edited content | **Ask.** Offer *Keep theirs* (reload their value, drop yours) or *Overwrite* (retry against the latest version). Make *Keep theirs* the default. |

```js
const result = await state.writeResolving('settings', JSON.stringify(settings), {
  onConflict: () => askInPage('Settings were changed by someone else.', ['theirs', 'overwrite']),
});
if (result.outcome === 'kept-theirs') settings = await state.readJson('settings', defaults);
```

Ask with an in-page dialog. `window.confirm()` is blocked by Studio's iframe sandbox. Without `onConflict`, `writeResolving()` overwrites, which suits caches.

## Cache locally by version

For values larger than a few kilobytes, keep a copy in IndexedDB keyed by `(key, version)`:

1. On load, compare the cached version with the index.
2. Same version: use the copy, with no request.
3. Different: fetch, then replace the copy.
4. After a write, cache the new value only once the server confirms `newVersion`.
5. On delete, or when a key disappears from the index, drop the cached copy. Versions can restart at `1` after a delete, so a version number alone can't prove the copy is current.

IndexedDB is partitioned per top-level site, so the cache made inside Studio isn't shared with the standalone app. That's fine for a cache.

## Pick up other users' changes

Nothing pushes changes to you. If several people may have the extension open at once, poll the list while the page is visible and re-read keys whose version moved:

```js
const stop = state.watch(async (changedKeys) => {
  for (const key of changedKeys) await reload(key);
}, { intervalMs: 5000 });
```

Don't overwrite unsaved local edits from a poll. Mark them as conflicting and let the user choose.

## Naming keys

Every page and scope of the extension shares one store, so put the context in the key:

| Data | Key |
| --- | --- |
| Project-wide settings | `settings` |
| Per impulse | `` `settings_${impulseId}` `` |
| Per learning block | `` `settings_${impulseId}_${learnId}` `` |
| Per processing block | `` `settings_${impulseId}_${dspId}` `` |
| Per file path | `` `file_${await sha256Hex(path)}` `` (69 characters) |

Keep a format version inside the value (`{ v: 2, … }`) so a newer build of the extension can migrate what an older build stored.

## Checklist

- [ ] The key comes from Studio, and the extension still works, with a notice, when shared state is refused.
- [ ] Keys match the pattern, include the impulse or block context where relevant, and hash anything path-like.
- [ ] Values stay under 100 MB and carry a format version.
- [ ] The first index comes from the `sharedState` URL parameter and is refreshed after a conflict.
- [ ] Reads treat version `0` or a missing key as "use the default", and validate and escape what they read.
- [ ] Writes send `currentVersion`, are queued per key, and handle conflicts on purpose.
- [ ] Conflict prompts are in-page, not `window.confirm()`.
- [ ] Local caches are keyed by version and dropped on delete.
- [ ] Nothing secret is stored.
