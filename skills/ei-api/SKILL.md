---
name: ei-api
description: Work with the Edge Impulse Studio, Ingestion, and Remote Management APIs; CLI tools; Linux runners; SDKs; custom blocks; and Studio extension registration. Use for project and sample management, data upload, model training and testing, deployment builds, device control, job monitoring, registering or enabling Studio extensions, automation, or any programmatic Edge Impulse platform integration. To build the extension web app itself, use ei-build-studio-extensions.
metadata:
  version: "1.0.3"
---

# Edge Impulse API and ecosystem

Use the detailed [reference](references/REFERENCE.md) selectively. For endpoints or payloads not covered there, consult the live Studio OpenAPI specification at https://studio.edgeimpulse.com/openapi.yml.

## Prepare

1. Check for `EI_API_KEY` and `EI_PROJECT_ID` before asking for credentials.
2. Never print, commit, or embed API keys.
3. Use the project API key for project-scoped Studio, Ingestion, and Remote Management operations. Use user authentication only when the requested endpoint requires it.

## Route the task

- Read **Authentication** before making API calls.
- Read **Studio API** for projects, samples, devices, deployments, jobs, users, and organizations.
- Read **Ingestion API** for uploading sensor, audio, image, or structured data.
- Read **Remote Management API** for live device sessions and commands.
- Read **CLI Tools** for daemon, uploader, data forwarder, runner, and block workflows.
- Read **Linux CLI** for EIM deployment and inference.
- Read **Custom Blocks** for organization block development.
- Read **Studio Extensions** to register, update, enable, or list Studio extensions, or to script extension shared state. To build the extension web app itself (the embedded iframe, `postMessage` API key handshake, Content-Security-Policy, and UI), use the `ei-build-studio-extensions` skill instead.
- Read **Common Recipes & Quick Reference** for ready-to-adapt commands and Python patterns.

## Execution workflow

1. Identify the project, target resource, requested mutation, and expected output.
2. Fetch current state before modifying or deleting anything.
3. Use exact API paths and schemas from the reference or OpenAPI spec.
4. Check HTTP status and the response's `success` field.
5. Treat jobs as asynchronous. Poll `/jobs/{jobId}/status` with bounded intervals until `.job.finished` is `true`, then check `.job.finishedSuccessful`.
6. On failure, fetch `/jobs/{jobId}/stdout/download` and show the relevant error lines. Tell users they can also monitor progress at `https://studio.edgeimpulse.com/studio/<projectId>/jobs`.
7. Save binary or text responses without attempting JSON decoding.
8. Verify the final resource, artifact, or job state and report it clearly.

## Safety

- Preview bulk relabel, move, and delete operations before executing them.
- Preserve category, label, metadata, and filename semantics during data migration.
- Use pagination for sample and job lists.
- Do not assume a deployment target identifier from its display name; query current targets.
- Prefer environment variables or secret stores for credentials.
