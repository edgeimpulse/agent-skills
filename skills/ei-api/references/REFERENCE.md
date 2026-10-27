# Edge Impulse API & Ecosystem Full Reference

## Table of Contents
1. [Platform Overview](#platform-overview)
2. [Authentication](#authentication)
3. [Studio API](#studio-api)
4. [Ingestion API](#ingestion-api)
5. [Remote Management API](#remote-management-api)
6. [CLI Tools](#cli-tools)
7. [Linux CLI](#linux-cli)
8. [Custom Blocks](#custom-blocks)
9. [Studio Extensions](#studio-extensions)
10. [Common Recipes & Quick Reference](#common-recipes--quick-reference)

---

## Platform Overview

Edge Impulse is the leading development platform for machine learning on edge devices. It provides an end-to-end workflow: collect data → design an impulse → train a model → deploy to hardware.

### Key Concepts

- **Project**: A container for datasets, impulse design, and trained models. Identified by a numeric `projectId`.
- **Impulse**: The ML pipeline consisting of input block → processing (DSP) blocks → learning blocks → output. An impulse defines how raw data is processed and classified.
- **DSP Block (Signal Processing)**: Transforms raw sensor data into features (e.g., spectral analysis for audio, image resize/crop for vision).
- **Learn Block**: The ML model that learns from DSP features (neural network, anomaly detection, regression, etc.).
- **Deployment**: Compiled model + runtime packaged for a specific target (C++ library, Arduino library, Linux EIM, WebAssembly, etc.).
- **Sample**: A single data item (time-series, image, audio, video) with a label, stored in training or testing dataset.
- **Device**: A physical board or virtual device connected to a project for data acquisition or inference.
- **Organization**: Groups projects, users, and custom blocks under an enterprise entity.
- **Block**: A containerized (Docker) unit of custom DSP, ML, transformation, or deployment logic.
- **Studio extension**: A web app that Studio embeds in an iframe as a page in a project. It is not a block: it runs in the user's browser, not in Edge Impulse's infrastructure. See [Studio Extensions](#studio-extensions).

### Base URLs
| Service | URL |
|---------|-----|
| Studio API | `https://studio.edgeimpulse.com/v1` |
| Ingestion API | `https://ingestion.edgeimpulse.com` |
| Remote Management | `wss://remote-mgmt.edgeimpulse.com` |
| OpenAPI Spec | `https://studio.edgeimpulse.com/openapi.yml` |

---

## Authentication

### API Key (Project-Level)
Most common method. Found in Studio → Dashboard → Keys.

```
x-api-key: ei_abc123...
```

Used for: Studio API, Ingestion API, Remote Management API.

### JWT Token (User-Level)
Obtained via login endpoint. Required for user/org management operations.

```bash
# Get JWT token
curl -X POST https://studio.edgeimpulse.com/v1/api-login \
  -H "Content-Type: application/json" \
  -d '{"username": "you@example.com", "password": "yourpassword"}'
```

Response contains `token`. Use as:
```
x-jwt-token: <token>
# or Cookie: jwt=<token>
```

### HMAC Keys
Used to sign data payloads for the Ingestion API. Ensures data integrity. Managed per-project via `GET/POST /api/{projectId}/hmackeys`.

### Scopes
JWT tokens have scopes that limit access:
- `projects:read`, `projects:create`, `projects:update`
- `devices:read`, `devices:create`, `devices:update`, `devices:delete`
- `user:read`, `organizations:read`

---

## Studio API

**Base URL:** `https://studio.edgeimpulse.com/v1`

The Studio API exposes most Studio functionality programmatically. All endpoints return JSON. Long-running operations use an async job pattern.

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all active projects |
| POST | `/api/projects/create` | Create a new project |
| GET | `/api/{projectId}/devkeys` | Get development API keys |
| GET | `/api/{projectId}/downloads` | Get available deployment downloads |
| GET | `/api/{projectId}/data-summary` | Get dataset summary (counts, labels) |
| GET | `/api/{projectId}/data-axes` | Get sensor axes summary |
| GET | `/api/{projectId}/data-interval` | Get training data interval (ms) |
| GET | `/api/{projectId}/versions` | List project versions |
| POST | `/api/{projectId}/versions/{versionId}` | Update a version |
| DELETE | `/api/{projectId}/versions/{versionId}` | Delete a version |
| GET | `/api/{projectId}/socket-token` | Get WebSocket token for real-time events |
| GET | `/api/{projectId}/last-modification` | Get last modification timestamp |
| GET | `/api/{projectId}/development-boards` | Get compatible dev boards |
| GET | `/api/{projectId}/target-constraints` | Get target device constraints |
| POST | `/api/{projectId}/target-constraints` | Set target device constraints |
| GET | `/api/{projectId}/model-variants` | Get available model variants |

#### Project Collaborators
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/{projectId}/collaborators/add` | Add collaborator |
| POST | `/api/{projectId}/collaborators/remove` | Remove collaborator |
| POST | `/api/{projectId}/collaborators/transfer-ownership` | Transfer to user |
| POST | `/api/{projectId}/collaborators/transfer-ownership-org` | Transfer to org |

#### API & HMAC Keys
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/{projectId}/apikeys` | List API keys |
| POST | `/api/{projectId}/apikeys` | Create API key |
| DELETE | `/api/{projectId}/apikeys/{apiKeyId}` | Revoke API key |
| GET | `/api/{projectId}/hmackeys` | List HMAC keys |
| POST | `/api/{projectId}/hmackeys` | Add HMAC key |
| DELETE | `/api/{projectId}/hmackeys/{hmacId}` | Remove HMAC key |

### Raw Data (Samples)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/{projectId}/raw-data` | List samples (with filters: category, label, limit, offset) |
| GET | `/api/{projectId}/raw-data/count` | Count samples matching filters |
| GET | `/api/{projectId}/raw-data/ratio` | Get train/test split ratio |
| GET | `/api/{projectId}/raw-data/metadata` | Get sample metadata fields |
| GET | `/api/{projectId}/raw-data/{sampleId}` | Get single sample details |
| DELETE | `/api/{projectId}/raw-data/{sampleId}` | Delete a sample |
| GET | `/api/{projectId}/raw-data/{sampleId}/raw` | Download raw file (CBOR/JSON) |
| GET | `/api/{projectId}/raw-data/{sampleId}/wav` | Download as WAV |
| GET | `/api/{projectId}/raw-data/{sampleId}/image` | Download as image (JPG/PNG) |
| GET | `/api/{projectId}/raw-data/{sampleId}/video` | Download as video (MP4/AVI) |
| POST | `/api/{projectId}/raw-data/{sampleId}/rename` | Rename sample |
| POST | `/api/{projectId}/raw-data/{sampleId}/edit-label` | Change label |
| POST | `/api/{projectId}/raw-data/{sampleId}/move` | Move between train/test |
| POST | `/api/{projectId}/raw-data/{sampleId}/crop` | Crop sample |
| POST | `/api/{projectId}/raw-data/{sampleId}/split` | Split into frames |
| POST | `/api/{projectId}/raw-data/{sampleId}/segment` | Segment sample |
| POST | `/api/{projectId}/raw-data/{sampleId}/find-segments` | Auto-detect segments |
| POST | `/api/{projectId}/raw-data/{sampleId}/bounding-boxes` | Set object detection bounding boxes |
| POST | `/api/{projectId}/raw-data/{sampleId}/structured-labels` | Set multi-label time-segmented labels |
| POST | `/api/{projectId}/rebalance` | Rebalance train/test split |
| POST | `/api/{projectId}/raw-data/delete-all` | Delete all samples |
| POST | `/api/{projectId}/raw-data/delete-all/{category}` | Delete all in category |
| GET | `/api/{projectId}/raw-data/label-object-detection-queue` | OD labeling queue |

#### Multi-label Samples (Structured Labels) & Large Sample Options

##### Listing & Fetching Options
- **Query parameters when listing samples** (`GET /api/{projectId}/raw-data`):
  - `category` (**required**): one of `training`, `testing`, `validation`, `post-processing`, `all`
  - `limit`: number of samples per page
  - `offset`: pagination offset
  - `labels`: only include samples whose label is in the given list, passed as a **JSON-encoded string**, for example `labels=["idle","snake"]`
- **Renaming vs. relabeling** — these two endpoints are easy to confuse:
  - `POST /api/{projectId}/raw-data/{sampleId}/rename` sets the sample's **file name**, not its label. Body: `{ "name": "faulty-machine2.A3de" }`
  - `POST /api/{projectId}/raw-data/{sampleId}/edit-label` sets the sample's **label** (class). Body: `{ "label": "label" }`
- **Large Sample Downsampling**:
  - `GET /api/{projectId}/raw-data/{sampleId}?limitPayloadValues=N` downsamples the payload to ~N values server-side.
  - The response's `totalPayloadLength` still reports the true reading count. It sits on the response envelope alongside `sample` and `payload`, not inside the `Sample` object, and it is only returned by the single-sample endpoint.
  - `intervalMs` is fixed and is not affected by `limitPayloadValues`.

##### Multi-label Mechanics (Structured Labels)
A sample can carry **time-segmented labels** instead of a single label for the entire sample (e.g., the first second is `idle`, the next two are `walk`). When a sample has structured labels, its `label` field is ignored.

These come back on the `Sample` object from both list (`GET /api/{projectId}/raw-data`) and single sample (`GET /api/{projectId}/raw-data/{sampleId}`) endpoints:

```jsonc
{
  "label": "idle",                      // summary / first label (single-label field)
  "structuredLabelsList": ["idle", "walk"],   // distinct labels present
  "structuredLabels": [
    { "startIndex": 0,   "endIndex": 99,  "label": "idle" },  // endIndex is INCLUSIVE
    { "startIndex": 100, "endIndex": 299, "label": "walk" }
  ]
}
```

- **Inclusive End Index**: `endIndex` is **inclusive** — `{ startIndex: 0, endIndex: 3 }` covers indices 0, 1, 2, and 3.
- **Time Code Calculation**: Convert index to time code in milliseconds by multiplying by `intervalMs`: `timeMs = index * intervalMs`.
- **Multi-label Condition**: Treat a sample as multi-label when it contains two or more segments (`structuredLabels` length >= 2).
- **Truncation Control**: pass `GET /api/{projectId}/raw-data/{sampleId}?truncateStructuredLabels=true` to return only a slice of the labels for samples with many segments. Omit it to get the full set.
- **Writing Structured Labels**: Set multi-label segments via `POST /api/{projectId}/raw-data/{sampleId}/structured-labels`. The array must cover the **complete sample** — use the sample's `valuesCount` as the upper bound. A gapped or partial array returns an error:
  ```json
  {
    "structuredLabels": [
      { "startIndex": 0, "endIndex": 99, "label": "idle" },
      { "startIndex": 100, "endIndex": 299, "label": "walk" }
    ]
  }
  ```

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/{projectId}/devices` | List all devices |
| GET | `/api/{projectId}/device/{deviceId}` | Get device details |
| DELETE | `/api/{projectId}/device/{deviceId}` | Delete device |
| POST | `/api/{projectId}/devices/create` | Register new device |
| POST | `/api/{projectId}/devices/{deviceId}/rename` | Rename device |
| POST | `/api/{projectId}/device/{deviceId}/start-sampling` | Trigger remote sampling |
| POST | `/api/{projectId}/devices/{deviceId}/request-model-update` | Push model update |
| POST | `/api/{projectId}/device/{deviceId}/debug-stream/inference/start` | Start inference debug |
| POST | `/api/{projectId}/device/{deviceId}/debug-stream/snapshot/start` | Start snapshot stream |
| POST | `/api/{projectId}/device/{deviceId}/debug-stream/keep-alive` | Keep debug alive |
| POST | `/api/{projectId}/device/{deviceId}/debug-stream/stop` | Stop debug stream |
| POST | `/api/{projectId}/device/{deviceId}/get-impulse-records` | Get on-device records |

### Deployment

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deployment/targets` | List all deployment targets |
| GET | `/api/{projectId}/downloads` | List available downloads for project |

Deployment builds are triggered as jobs (see Jobs section).

### Jobs (Async Operations)

Long-running operations (training, DSP generation, deployment builds, data export) return a `jobId` immediately.

**Pattern:**
1. Start a job → receive `jobId` (e.g., `job-1569583053767`)
2. Connect to project WebSocket for real-time updates
3. Listen for events:
   - `job-data-{jobId}` — progress updates (percentage, status messages)
   - `job-finished-{jobId}` — completion with success/failure status

**Key job-triggering endpoints:**
- Feature generation (DSP)
- Model training / retraining
- Deployment builds
- Data export
- Performance calibration
- Dataset rebalancing (v2)

Jobs are subject to the same compute time limits as the Studio UI.

### AI Actions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/{projectId}/ai-actions` | List AI Actions |
| POST | `/api/{projectId}/ai-actions/create` | Create AI Action |
| GET | `/api/{projectId}/ai-actions/{actionId}` | Get AI Action config |
| POST | `/api/{projectId}/ai-actions/{actionId}` | Update AI Action |
| DELETE | `/api/{projectId}/ai-actions/{actionId}` | Delete AI Action |
| POST | `/api/{projectId}/ai-actions/order` | Reorder actions |
| POST | `/api/{projectId}/ai-actions/{actionId}/preview-samples` | Preview affected samples |
| GET | `/api/{projectId}/ai-actions/{actionId}/clear-proposed-changes` | Clear proposed changes |

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api-login` | Get JWT token |
| GET | `/api/user` | Get current user |
| POST | `/api/user` | Update current user |
| DELETE | `/api/user` | Delete current user |
| GET | `/api/user/projects` | Get user's projects |
| GET | `/api/user/organizations` | Get user's organizations |
| POST | `/api/user/change-password` | Change password |
| POST | `/api/user/mfa/totp/create-key` | Generate MFA key |
| POST | `/api/user/mfa/totp/set-key` | Enable MFA |
| POST | `/api/user/mfa/totp/clear` | Disable MFA |
| GET | `/api/user/subscription/metrics` | Get compute metrics |
| POST | `/api-user-request-reset-password` | Request password reset |

### Organizations & White-labels

Organizations manage enterprise features: custom blocks, storage buckets, data campaigns, pipelines, and project provisioning.

White-label endpoints (`/api/whitelabel/{id}/...`) manage custom deployment targets and impulse blocks for branded instances.

---

## Ingestion API

**Base URL:** `https://ingestion.edgeimpulse.com`

Used to upload data (sensor readings, images, audio, video) into Edge Impulse projects.

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/training/files` | Upload training data (multipart) |
| POST | `/api/testing/files` | Upload testing data (multipart) |
| POST | `/api/anomaly/files` | Upload anomaly data (multipart) |
| POST | `/api/training/data` | Upload training data (legacy, JSON/CBOR body) |
| POST | `/api/testing/data` | Upload testing data (legacy, JSON/CBOR body) |
| POST | `/api/anomaly/data` | Upload anomaly data (legacy, JSON/CBOR body) |

### Required Headers
| Header | Value | Description |
|--------|-------|-------------|
| `x-api-key` | `ei_abc123...` | Project API key (required) |
| `Content-Type` | `multipart/form-data`, `application/json`, or `application/cbor` | Data format |

### Optional Headers
| Header | Value | Description |
|--------|-------|-------------|
| `x-label` | `string` | Label for the uploaded data |
| `x-no-label` | `1` | Prevent automatic label assignment |
| `x-disallow-duplicates` | `1` | Reject duplicate files (hash-based) |
| `x-add-date-id` | `1` | Append unique date-based ID to filename |
| `X-File-Name` | `string` | Filename (legacy `/data` endpoints) |

### Supported File Formats
- **Sensor data:** `.json`, `.cbor`, `.csv`
- **Audio:** `.wav`
- **Images:** `.jpg`, `.png`
- **Video:** `.mp4`, `.avi`
- **Labels:** `.labels` (for pre-annotated data)

### Limits
- Max **1,000 files** per request
- Max **100 MB** per individual file

### Data Envelope Format (JSON/CBOR)

For structured sensor data uploads:

```json
{
  "protected": {
    "ver": "v1",
    "alg": "HS256",
    "iat": 1234567890
  },
  "signature": "HMAC-SHA256-hex-or-zeros-if-unsigned",
  "payload": {
    "device_name": "my-device",
    "device_type": "MY_SENSOR",
    "interval_ms": 16,
    "sensors": [
      { "name": "accX", "units": "m/s2" },
      { "name": "accY", "units": "m/s2" },
      { "name": "accZ", "units": "m/s2" }
    ],
    "values": [
      [0.01, -9.81, 0.03],
      [0.02, -9.80, 0.01]
    ]
  }
}
```

For unsigned data, set signature to all zeros: `"0000000000000000000000000000000000000000000000000000000000000000"`.

### Response Codes
| Code | Meaning |
|------|---------|
| 200 | Success — filename returned in body |
| 400 | Invalid request structure |
| 401 | Missing or invalid API key |
| 421 | Required header missing |
| 500 | Server error |

### Upload Examples

**Upload image files (multipart):**
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/files \
  -H "x-api-key: ei_abc123" \
  -H "x-label: cat" \
  -F "data=@cat01.jpg" \
  -F "data=@cat02.jpg"
```

**Upload WAV audio:**
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/files \
  -H "x-api-key: ei_abc123" \
  -H "x-label: noise" \
  -F "data=@ambient.wav"
```

**Upload structured sensor data (JSON body):**
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/data \
  -H "x-api-key: ei_abc123" \
  -H "x-label: walking" \
  -H "Content-Type: application/json" \
  -d '{
    "protected": {"ver":"v1","alg":"none","iat":1234567890},
    "signature": "0000000000000000000000000000000000000000000000000000000000000000",
    "payload": {
      "device_name": "sensor-01",
      "device_type": "ACCEL",
      "interval_ms": 10,
      "sensors": [{"name":"accX","units":"m/s2"},{"name":"accY","units":"m/s2"},{"name":"accZ","units":"m/s2"}],
      "values": [[0.01,-9.81,0.03],[0.02,-9.80,0.01]]
    }
  }'
```

**Upload CSV:**
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/files \
  -H "x-api-key: ei_abc123" \
  -H "x-label: idle" \
  -F "data=@sensor_readings.csv"
```

---

## Remote Management API

**Endpoint:** `wss://remote-mgmt.edgeimpulse.com` (port 443) or `ws://remote-mgmt.edgeimpulse.com` (port 80)

Enables two-way WebSocket communication between devices and Edge Impulse Studio. Used for remote data acquisition, live inference debugging, and snapshot streaming. Messages are encoded in CBOR or JSON (format set by the initial Hello message).

### Connection Flow

#### 1. Hello (Handshake)
Device sends first:
```json
{
  "hello": {
    "version": 3,
    "apiKey": "ei_abc123...",
    "deviceId": "my-device-001",
    "deviceType": "MY_BOARD",
    "connection": "ip",
    "sensors": [
      {
        "name": "Accelerometer",
        "maxSampleLengthS": 300,
        "frequencies": [62.5, 100]
      },
      {
        "name": "Camera (320x240)",
        "maxSampleLengthS": 5,
        "frequencies": [10]
      }
    ],
    "supportsSnapshotStreaming": true
  }
}
```

Server responds with `{ "hello": true/false }`.

#### 2. Sampling Flow
**Server → Device** (sample request):
```json
{
  "sample": {
    "label": "wave",
    "length": 5000,
    "path": "/api/training/data",
    "hmacKey": "abc123...",
    "interval": 16,
    "sensor": "Accelerometer"
  }
}
```

Device responds `true/false`, then sends sequential notifications:
1. `{ "sampleStarted": true }` — sampling begins
2. `{ "sampleProcessing": true }` — (optional) preprocessing
3. `{ "sampleReading": true, "progressPercentage": 50 }` — (optional) reading from device
4. `{ "sampleUploading": true }` — uploading to ingestion service
5. `{ "sampleFinished": true }` — done

#### 3. Snapshot Streaming
**Server → Device:**
- `{ "startSnapshot": true }` — begin camera streaming
- `{ "stopSnapshot": true }` — stop streaming

**Device → Server:**
```json
{ "snapshotFrame": "<base64-encoded-jpg>" }
```
Recommended max 5 frames/second.

---

## CLI Tools

Install the Edge Impulse CLI globally via npm (requires Node.js v16+):

```bash
npm install -g edge-impulse-cli
```

### edge-impulse-daemon
Configures devices over serial and acts as a proxy for devices without IP connectivity. Bridges serial devices to the Remote Management API.

```bash
edge-impulse-daemon                    # Interactive setup
edge-impulse-daemon --clean            # Reset credentials
edge-impulse-daemon --api-key ei_...   # Use API key directly
```

### edge-impulse-uploader
Uploads and signs local files to a project's dataset.

```bash
# Upload files with automatic label from filename
edge-impulse-uploader path/to/files/*.wav

# Upload with explicit label
edge-impulse-uploader --label "noise" recording.wav

# Upload to testing dataset
edge-impulse-uploader --category testing path/to/files/*

# Upload with API key (non-interactive)
edge-impulse-uploader --api-key ei_... --label "idle" data.csv

# Upload directory of images
edge-impulse-uploader --label "cat" images/*.jpg
```

### edge-impulse-data-forwarder
Collects data from any device over serial and forwards to Edge Impulse. The simplest way to connect custom hardware.

```bash
edge-impulse-data-forwarder                     # Interactive
edge-impulse-data-forwarder --frequency 100     # Set sample rate (Hz)
edge-impulse-data-forwarder --clean             # Reset credentials
```

The device should print comma-separated sensor values over serial (e.g., `0.01,-9.81,0.03\n`).

### edge-impulse-run-impulse
Displays the impulse running on a connected device. Shows real-time inference results.

```bash
edge-impulse-run-impulse
```

### edge-impulse-blocks
Manages custom blocks (see [Custom Blocks](#custom-blocks) section below).

```bash
edge-impulse-blocks init       # Initialize a new block
edge-impulse-blocks runner     # Test block locally
edge-impulse-blocks push       # Deploy block to Edge Impulse
edge-impulse-blocks info       # Show block configuration
edge-impulse-blocks --clean    # Reset authentication
```

### Common CLI Flags
| Flag | Description |
|------|-------------|
| `--api-key ei_...` | Authenticate non-interactively |
| `--clean` | Reset stored credentials |
| `--dev` | Use development server |
| `--silent` | Suppress output |
| `--help` | Show help |

---

## Linux CLI

For running inference and collecting data on Linux devices (Raspberry Pi, Jetson, etc.).

### Installation

```bash
# Linux / macOS / Raspberry Pi
npm install -g edge-impulse-linux

# Additional dependencies (Linux)
sudo apt install -y gcc g++ make build-essential sox gstreamer1.0-tools \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-base gstreamer1.0-plugins-base-apps
```

### edge-impulse-linux
Collects sensor data (camera/microphone) on Linux devices and uploads to Edge Impulse.

```bash
edge-impulse-linux                         # Interactive setup
edge-impulse-linux --disable camera        # Audio only
edge-impulse-linux --disable microphone    # Camera only
edge-impulse-linux --api-key ei_...        # Non-interactive
edge-impulse-linux --clean                 # Reset credentials
```

### edge-impulse-linux-runner
Downloads and runs a trained model locally for inference. Can expose an HTTP API.

```bash
# Run model with live sensor input (streaming mode)
edge-impulse-linux-runner

# Run with specific API key
edge-impulse-linux-runner --api-key ei_...

# Expose HTTP API for on-demand inference
edge-impulse-linux-runner --run-http-server 4911

# Run from a local .eim model file
edge-impulse-linux-runner --model-file path/to/model.eim

# Download model without running
edge-impulse-linux-runner --download path/to/model.eim
```

#### HTTP Server Mode
When started with `--run-http-server <port>`, the runner exposes endpoints for on-demand classification:

```bash
# Classify from live sensor
curl http://localhost:4911/api/classify

# Get runner info
curl http://localhost:4911/api/info
```

#### Key Runner Options
| Flag | Description |
|------|-------------|
| `--run-http-server <port>` | Enable HTTP API mode |
| `--model-file <path>` | Use local .eim file |
| `--download <path>` | Download model file only |
| `--api-key ei_...` | Non-interactive auth |
| `--quantized` | Use int8 quantized model |
| `--enable-camera` | Force camera usage |
| `--enable-microphone` | Force microphone usage |
| `--clean` | Reset credentials |

---

## Custom Blocks

Blocks are Docker containers that add custom logic to Edge Impulse. They can be written in any language. (Studio extensions, which are embedded web apps, are covered separately in [Studio Extensions](#studio-extensions).)

### Block Types

| Type | Purpose | Example |
|------|---------|---------|
| **Transformation** | Process/transform datasets | Data augmentation, format conversion, synthetic data |
| **Custom DSP** | Custom signal processing | Proprietary feature extraction, custom FFT |
| **Custom ML** | Custom learning algorithms | PyTorch model, scikit-learn pipeline, pre-trained weights |
| **Deployment** | Custom build targets | Proprietary firmware, custom library format |

### Creating a Block

#### 1. Initialize
```bash
edge-impulse-blocks init
```
Prompts for: block type, name, description, organization. Generates a template with Dockerfile and scaffolding.

#### 2. Develop & Test Locally
```bash
# Test transformation block
edge-impulse-blocks runner --data-item <item-id>

# Test ML block
edge-impulse-blocks runner --epochs 50 --learning-rate 0.001

# Test DSP block
edge-impulse-blocks runner --file <sample-file>
```

The runner caches downloaded data to minimize bandwidth on repeat runs.

#### 3. Push to Edge Impulse
```bash
edge-impulse-blocks push
```
Archives the block directory and uploads to Edge Impulse for cloud execution.

### Dockerfile Requirements

Every block needs a `Dockerfile` with:

```dockerfile
FROM python:3.10-slim

# Install dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy application
COPY . /app

# CRITICAL: Must use ENTRYPOINT (not CMD)
ENTRYPOINT ["python", "/app/main.py"]
```

**Important constraints:**
- Must have an `ENTRYPOINT` instruction
- **Never use `WORKDIR /home/...`** — the `/home` path is mounted by Edge Impulse at runtime, making your files inaccessible
- Keep images small to reduce push/pull times

### Configuration Files

- **`.ei-block-config`** — Block metadata (auto-generated by init). Commit to version control.
- **`.ei-ignore`** — Exclude files from upload (like .gitignore). Uses absolute paths or wildcards.

```
# .ei-ignore example
*.pyc
__pycache__/
.git/
.env
test_data/
```

### Block Authentication
```bash
edge-impulse-blocks --api-key ei_...    # API key auth
edge-impulse-blocks --clean             # Reset credentials
edge-impulse-blocks info                # View current config
```

---

## Studio Extensions

A Studio extension is a web app, hosted anywhere over HTTPS, that Studio embeds in an iframe as a page in a project. Studio passes the project context in URL query parameters and hands the app a short-lived, project-scoped API key over `postMessage`.

This section covers the API calls for registering and managing extensions from a script. **To build the extension app itself** (the key handshake, the iframe sandbox, the Content-Security-Policy header, and the UI), use the `ei-build-studio-extensions` skill.

> These endpoints aren't in `openapi.yml` yet. Take exact names and parameters from the API bindings' type declarations: `https://studio.edgeimpulse.com/api-bindings/browser/edge-impulse-api.d.ts`, or the `edge-impulse-api` npm package.

### Register and manage extensions (organization)

Extensions belong to an organization, or to your personal developer profile. These calls need an organization API key or a JWT. Never make them from inside an extension.

| Method | Endpoint | Bindings method (`api.organizationBlocks`) |
|--------|----------|--------------------------------------------|
| GET | `/api/organizations/{organizationId}/extension` | `listOrganizationExtensionBlocks` |
| POST | `/api/organizations/{organizationId}/extension` | `addOrganizationExtensionBlock` (multipart form) |
| GET | `/api/organizations/{organizationId}/extension/{extensionId}` | `getOrganizationExtensionBlock` |
| POST | `/api/organizations/{organizationId}/extension/{extensionId}` | `updateOrganizationExtensionBlock` (multipart form) |
| DELETE | `/api/organizations/{organizationId}/extension/{extensionId}` | `deleteOrganizationExtensionBlock` |

Main registration fields:

| Field | Values |
|-------|--------|
| `name`, `description`, `url` | Required. `url` must be HTTPS (`http://localhost` is allowed for development). |
| `navbarLocation` | Required. Where the extension appears, for example `project`, `impulse`, `dsp_block`, `learn_block`, `data_acquisition`, `deployment`, or `organization_dashboard`. |
| `requiredApiKeyRole` | Required. `readonly`, `ingestiononly`, `ingestion_deployment`, or `admin`. Pick the least that works. |
| `authMethod` | Required. Use `api_key_via_postmessage`. The legacy `api_key_via_url` leaks the key into URLs and logs. |
| `visibility` | `project` (with `onlyAvailableInProjectId`), `organization` (default), or `everyone` |
| `publicProjectTierAvailability` | With `everyone`: `enterprise-only`, `all-projects`, or `all-projects-including-whitelabels` |
| `requireAdminInstall`, `hideSideMenu`, `showOnLearnBlockTypes`, `repositoryUrl`, `logo`, `navbarIcon` | Optional |

### Enable extensions on a project

| Method | Endpoint | Bindings method (`api.projects`) |
|--------|----------|----------------------------------|
| GET | `/api/{projectId}/extensions/available` | `listProjectAvailableExtensions` |
| GET | `/api/{projectId}/extensions/active` | `getProjectActiveExtensions` |
| POST | `/api/{projectId}/extensions/active/add` | `addProjectActiveExtension` (body `{ "extensionId": … }`) |
| DELETE | `/api/{projectId}/extensions/active/{projectExtensionId}` | `removeProjectActiveExtension` |

Removing an extension from a project revokes its keys and deletes its shared state.

### Shared state

Versioned blobs that an extension stores on a project, visible to every user of that extension in the project. These calls only work with a key that Studio issued to the extension. A project API key from the dashboard is rejected.

| Method | Endpoint | Bindings method (`api.projects`) |
|--------|----------|----------------------------------|
| GET | `/api/{projectId}/extensions/shared-state/list` | `getExtensionSharedStateList` |
| GET | `/api/{projectId}/extensions/shared-state?key=…` | `getExtensionSharedState` (version in the `x-version` response header; `0` means no state) |
| POST | `/api/{projectId}/extensions/shared-state?key=…` | `setExtensionSharedState` (multipart `state` file and `currentVersion`; a stale `currentVersion` is a conflict) |
| DELETE | `/api/{projectId}/extensions/shared-state?key=…` | `deleteExtensionSharedState` |

See the `ei-build-studio-extensions` skill for key naming rules, size limits, and conflict handling.

### Identify a key

`GET /api/projects/api-key-info` (`api.projects.getCurrentApiKeyInfo()`) returns the `projectId`, `role`, and, for short-lived keys such as those Studio issues to extensions, `expires`. Use it to resolve the project from a key instead of asking for a project ID.

---

## Common Recipes & Quick Reference

### Recipe: List all projects
```bash
curl -H "x-jwt-token: $JWT" \
  https://studio.edgeimpulse.com/v1/api/projects
```

### Recipe: Get project info and data summary
```bash
curl -H "x-api-key: $API_KEY" \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/data-summary"
```

### Recipe: List all samples in training dataset
```bash
curl -H "x-api-key: $API_KEY" \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/raw-data?category=training&limit=100&offset=0"
```

### Recipe: Upload training images via Ingestion API
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/files \
  -H "x-api-key: $API_KEY" \
  -H "x-label: dog" \
  -F "data=@dog1.jpg" \
  -F "data=@dog2.jpg" \
  -F "data=@dog3.jpg"
```

### Recipe: Upload sensor data (JSON body)
```bash
curl -X POST https://ingestion.edgeimpulse.com/api/training/data \
  -H "x-api-key: $API_KEY" \
  -H "x-label: idle" \
  -H "Content-Type: application/json" \
  -d @sensor_data.json
```

### Recipe: Batch upload with uploader CLI
```bash
# Upload all WAV files with labels extracted from filenames
edge-impulse-uploader --api-key $API_KEY training_data/*.wav

# Upload to testing category
edge-impulse-uploader --api-key $API_KEY --category testing test_data/*.jpg
```

### Recipe: Move sample between train/test
```bash
curl -X POST \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"category": "testing"}' \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/raw-data/$SAMPLE_ID/move"
```

### Recipe: Edit sample label
```bash
curl -X POST \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label": "new_label"}' \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/raw-data/$SAMPLE_ID/edit-label"
```

### Recipe: Set multi-label structured labels
```bash
curl -X POST \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "structuredLabels": [
      {"startIndex": 0, "endIndex": 99, "label": "idle"},
      {"startIndex": 100, "endIndex": 299, "label": "walk"}
    ]
  }' \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/raw-data/$SAMPLE_ID/structured-labels"
```

### Recipe: Delete all samples
```bash
curl -X POST -H "x-jwt-token: $JWT" \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/raw-data/delete-all"
```

### Recipe: List devices
```bash
curl -H "x-api-key: $API_KEY" \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/devices"
```

### Recipe: Trigger remote sampling
```bash
curl -X POST \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"wave","lengthMs":5000,"sensor":"Built-in accelerometer","interval":16}' \
  "https://studio.edgeimpulse.com/v1/api/$PROJECT_ID/device/$DEVICE_ID/start-sampling"
```

### Recipe: Get deployment targets
```bash
curl -H "x-api-key: $API_KEY" \
  "https://studio.edgeimpulse.com/v1/api/deployment/targets"
```

### Recipe: Run inference on Linux with HTTP API
```bash
# Start runner in HTTP mode
edge-impulse-linux-runner --api-key $API_KEY --run-http-server 4911 &

# Classify
curl http://localhost:4911/api/classify
```

### Recipe: Create and push a custom block
```bash
edge-impulse-blocks init                  # Set up block scaffold
# ... develop your block ...
edge-impulse-blocks runner --epochs 10    # Test locally
edge-impulse-blocks push                  # Deploy to Edge Impulse
```

### Recipe: Python — Upload data programmatically
```python
import requests

API_KEY = "ei_abc123..."
PROJECT_ID = 12345

# Upload image
with open("sample.jpg", "rb") as f:
    resp = requests.post(
        "https://ingestion.edgeimpulse.com/api/training/files",
        headers={
            "x-api-key": API_KEY,
            "x-label": "cat",
        },
        files={"data": ("sample.jpg", f, "image/jpeg")},
    )
print(resp.json())
```

### Recipe: Python — List samples
```python
import requests

API_KEY = "ei_abc123..."
PROJECT_ID = 12345

resp = requests.get(
    f"https://studio.edgeimpulse.com/v1/api/{PROJECT_ID}/raw-data",
    headers={"x-api-key": API_KEY},
    params={"category": "training", "limit": 50},
)
samples = resp.json().get("samples", [])
for s in samples:
    print(f"  {s['id']}: {s['label']} ({s['filename']})")
```

### Recipe: Python — Set multi-label structured labels
```python
import requests

API_KEY = "ei_abc123..."
PROJECT_ID = 12345
SAMPLE_ID = 67890

resp = requests.post(
    f"https://studio.edgeimpulse.com/v1/api/{PROJECT_ID}/raw-data/{SAMPLE_ID}/structured-labels",
    headers={"x-api-key": API_KEY, "Content-Type": "application/json"},
    json={
        "structuredLabels": [
            {"startIndex": 0, "endIndex": 99, "label": "idle"},
            {"startIndex": 100, "endIndex": 299, "label": "walk"},
        ]
    },
)
print(resp.json())
```

### Environment Variable Convention
```bash
export EI_API_KEY="ei_abc123..."
export EI_PROJECT_ID="12345"
```

### Quick Command Reference
| Task | Command / Endpoint |
|------|--------------------|
| Install CLI | `npm install -g edge-impulse-cli` |
| Install Linux CLI | `npm install -g edge-impulse-linux` |
| Connect device (serial) | `edge-impulse-daemon` |
| Forward serial data | `edge-impulse-data-forwarder` |
| Upload files | `edge-impulse-uploader --label X files/*` |
| Run inference (Linux) | `edge-impulse-linux-runner` |
| Run inference (HTTP) | `edge-impulse-linux-runner --run-http-server 4911` |
| Init custom block | `edge-impulse-blocks init` |
| Test block locally | `edge-impulse-blocks runner` |
| Push block | `edge-impulse-blocks push` |
| Get JWT | `POST /api-login` |
| List projects | `GET /api/projects` |
| Upload data | `POST ingestion.edgeimpulse.com/api/training/files` |
| List samples | `GET /api/{projectId}/raw-data` |
| Set multi-label segments | `POST /api/{projectId}/raw-data/{sampleId}/structured-labels` |
| List devices | `GET /api/{projectId}/devices` |
| Deployment targets | `GET /api/deployment/targets` |
| Identify an API key | `GET /api/projects/api-key-info` |
| Register a Studio extension | `POST /api/organizations/{organizationId}/extension` |
| Enable an extension on a project | `POST /api/{projectId}/extensions/active/add` |

## Source Repositories

- https://github.com/edgeimpulse/edge-impulse-cli — CLI tools (daemon, uploader, data forwarder, run-impulse, blocks)
- https://github.com/edgeimpulse/edge-impulse-linux-cli — Linux CLI and EIM impulse runner
- https://github.com/edgeimpulse/python-sdk — Edge Impulse Python SDK for programmatic platform workflows
- https://github.com/edgeimpulse/linux-sdk-python — `edge_impulse_linux` Python SDK for EIM inference
- https://github.com/edgeimpulse/linux-sdk-go — Go SDK for Linux EIM models
- https://github.com/edgeimpulse/inferencing-sdk-cpp — portable C++ inferencing SDK
- https://github.com/edgeimpulse/ingestion-sdk-c — C99 header-only ingestion SDK for embedded data collection
