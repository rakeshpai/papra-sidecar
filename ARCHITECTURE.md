# papra-sidecar — Architecture

## Overview

`papra-sidecar` is a bespoke ingestion pipeline for a home-lab
[Papra](https://papra.app) installation. It receives emails that contain
PDF attachments (bank/credit-card/mutual-fund statements), decrypts them with a
per-sender password, extracts text with configurable OCR language via
docling, and uploads the decrypted PDF + parsed content to Papra, tagging it
according to per-sender rules.

It exists because Papra's own content extraction calls docling **without any
OCR language configuration** (docling then defaults to Chinese). Verified in
Papra's source: `content-extraction-strategies/docling/docling.content-extraction-strategy.ts`
only passes the file; the `ocrLanguages` field on document creation only flows
to the internal tesseract ("lecture") strategy, never to docling. This sidecar
parses with docling itself so OCR language is fully under our control.

## High-level data flow

```
Bank/company email (password-protected PDF)
        │
        ▼
Family member's Gmail ──forward──▶ papra-ingest@rakeshpai.me
        │                            (Cloudflare Email Routing rule → Worker)
        ▼
┌─────────────────────────────────────┐
│ Cloudflare Email Worker (packages/worker) │
│  • parse raw MIME (postal-mime)           │
│  • pick the LARGEST PDF attachment        │
│  • POST multipart to webhook              │
└──────────────────┬────────────────────────┘
                   │ HTTPS (public via Cloudflare tunnel)
                   │ Authorization: Bearer <WEBHOOK_SECRET>
                   ▼
┌─────────────────────────────────────┐
│ papra-sidecar (packages/papra-sidecar)  │  Docker, Node 22 + Hono
│  • validate secret + payload             │  port 3000, NOT published to host
│  • match config rule (by from/to)        │  reachable only via tunnel
│  • enqueue job, reply 202                │
└──────────────────┬────────────────────────┘
                   │ docker network: home-docker-network
                   ▼
   1. decrypt PDF with rule password (qpdf)
   2. rename → {namePrefix}-{YYYY-MM}.pdf
   3. docling-serve /v1/convert/file (ocr_lang from rule)
   4. upload decrypted PDF to Papra API
   5. wait for Papra's own extraction to finish
   6. PATCH Papra document content = our docling markdown
   7. ensure/create tags, attach them to the document
```

### Runtime dependencies (already running in home-server-setup compose)

| Service | Address on network | Notes |
|---|---|---|
| `papra` | `http://papra:1221` | `ghcr.io/papra-hq/papra:latest`, API uses Bearer token |
| `docling-serve` | `http://docling-serve:5001` | `quay.io/docling-project/docling-serve-cpu:latest`, `/v1/convert/file` |

The sidecar has no other outbound dependencies. It does **not** expose ports to
the host; it is reached through the existing `cloudflared` tunnel ingress
(`papra-ingest.rakeshpai.me` → `http://papra-sidecar:3000`).

## Components

### 1. Cloudflare Email Worker (`packages/worker`)

- **Trigger**: Cloudflare Email Routing rule routes `papra-ingest@rakeshpai.me`
  to the worker (all family members forward their statements to this address).
- **Parsing**: `postal-mime` parses the raw MIME (`message.raw`), following the
  same pattern as the official `papra-hq/email-proxy`.
- **Attachment selection**: of the parsed `email.attachments`, choose the
  **largest** one whose MIME type is `application/pdf` (falling back to filename
  ending in `.pdf`). Emails with no PDF attachment are dropped (logged to
  worker observability) and not forwarded.
- **Forwarding**: single multipart/form-data POST to `WEBHOOK_URL` with header
  `Authorization: Bearer ${WEBHOOK_SECRET}`:
  - `from` — **envelope** sender observed by Email Routing (`message.from`). For
    Gmail-forwarded mail this is the family member's Gmail address (SRS-rewritten,
    e.g. `person1+caf_=papra-ingest=rakeshpai.me@gmail.com`).
  - `to` — **envelope** recipient observed by Email Routing (`message.to`, always
    `papra-ingest@rakeshpai.me`).
  - `originalFrom` — `From:` header address (the original bank/company sender).
  - `originalTo` — first `To:` header address.
  - `subject` — email subject (used for fallback document naming)
  - `date` — RFC 2822 date header (used for document naming)
  - `messageId` — `Message-Id` header (for logging/idempotency tracing)
  - `file` — the chosen PDF bytes, original filename preserved
- **Env**: `WEBHOOK_URL` (secret var), `WEBHOOK_SECRET` (secret var).
- **Failure semantics**: if the webhook POST fails or returns non-2xx, the
  worker throws; Email Routing then fails delivery, which surfaces as a bounce /
  retry. The sidecar is expected to return `202` promptly, so the worker never
  blocks on parsing work.

### 2. papra-sidecar (`packages/papra-sidecar`)

Node 22 + [Hono](https://hono.dev), ESM, TypeScript with strictest settings.

#### HTTP surface (port 3000)

| Route | Method | Purpose |
|---|---|---|
| `/webhook` | POST | Accept email+PDF, validate, enqueue, return `202` |
| `/healthz` | GET | Docker healthcheck; returns `200 {"ok":true}` |

- **Auth**: every request must carry `Authorization: Bearer <WEBHOOK_SECRET>`.
  Rejected with `401` (constant-time comparison) otherwise.
- **Body size cap**: reject bodies > 25 MB (`413`).

#### Request handling

1. Authenticate.
2. Parse multipart body; validate against the shared webhook payload schema
   (zod).
3. Build an email identity: `from`, `to`, `originalFrom`, `originalTo`
   (normalized: lowercased, Gmail `+`-suffix stripped from the local part).
4. **Whitelist gate** (`allowedSenders`): the normalized envelope `from` (or
   `originalFrom` as a fallback) must be in `allowedSenders`. Anything else is
   dropped + logged to `dropped.jsonl` with `reason: "sender not whitelisted"`
   and returns `202` (accepted-and-ignored, so the worker doesn't bounce mail).
5. Match a specific `rules` entry: `rule.from` matches `originalFrom` **or**
   `from`; optional `rule.to` matches `originalTo` **or** `to`; first match wins.
   - If found → enqueue a **specific-rule job** (uses rule password, namePrefix,
     ocrLanguages, tags).
   - If not found → enqueue a **fallback job** (see pipeline below).
6. Enqueue on the in-memory FIFO queue (concurrency 1) and return `202`.

#### Job pipeline (per email, serialized)

1. **Persist**: write uploaded PDF to a temp file.
2. **Decrypt / gate**:
   - Specific rule: if the rule has a `password`, `qpdf --decrypt --password=…`;
     on failure retry without a password (in case the sender sent a plain PDF).
     Both failing → `failures.jsonl` and stop.
   - Fallback (no rule): `qpdf --decrypt` without a password succeeds only for
     **unencrypted** PDFs. Encrypted → drop + log to `dropped.jsonl` with
     `reason: "encrypted pdf with no matching rule"`. Unencrypted → copy as-is.
   - `qpdf --decrypt --password=<pw> <in> <out>`;
   - on failure, retry `qpdf --decrypt <in> <out>` (in case the sender sent an
     unencrypted PDF) — if that succeeds, log a warning and proceed;
   - if both fail → failure log (`invalid password / corrupt PDF`) and stop.
   - No password in rule → use the PDF as-is.
3. **Name**:
   - Specific rule: `{namePrefix}-{YYYY-MM}.pdf`.
   - Fallback: `{sanitizedSubject}-{YYYY-MM}.pdf` (subject sanitized for
     filenames, capped at 80 chars).
   - `YYYY-MM` derives from the email `date` header (fallback to current time).
   - This becomes the Papra document name (Papra names documents from the uploaded
     filename).
4. **Parse with docling**:
   - `POST {DOCLING_BASE_URL}/v1/convert/file` (multipart):
     - `files` = decrypted PDF,
     - `to_formats` = `md`,
     - `image_export_mode` = `placeholder`,
     - `ocr_lang` = each configured language (repeatable); specific rules may
       override, otherwise `papra.defaultOcrLanguages` (defaults to `["en"]`),
     - `force_ocr` = rule `forceOcr` (default `false`).
   - Response: `{ document: { md_content } }`. Strip `<!-- image -->`
     placeholders (same as Papra does).
   - Non-2xx / failure → failure log and stop.
5. **Upload to Papra**:
   - `POST {apiUrl}/api/organizations/{organizationId}/documents` (multipart),
     `Authorization: Bearer {apiToken}`, field `file` = the renamed decrypted
     PDF.
   - Returns the created (or, via Papra dedup, existing) document.
6. **Wait for Papra's own extraction**: `GET .../documents/{id}` until
   `document.content` is non-empty or a timeout elapses (default 5 min). This
   guarantees our PATCH below is the final word, so Papra's Chinese-default
   docling extraction cannot overwrite our English content afterwards.
7. **Patch content**: `PATCH .../documents/{id}` with `content` = our docling
   markdown (and `name` = the chosen name, belt-and-suspenders).
8. **Tags**: the tag set is —
   - specific rule: `rule.tags` ∪ all matching `globalRules` tags;
   - fallback: all matching `globalRules` tags ∪ `fallbackTag` (if configured).
   For each tag name —
   - `GET .../tags`, find by name (cache the mapping);
   - if missing, `POST .../tags` with `{ name, color }` (`tags:create` needed);
   - `POST .../documents/{id}/tags` with `{ tagId }` (`tags:read` +
     `documents:update` needed). Re-adding an existing tag is idempotent.
9. **Success**: append a line to `processed.jsonl` with context (messageId,
   from, document id, docling time, tags).

#### Logging

- Structured logs to stdout (pino) for `docker logs`.
- JSONL files in `LOG_DIR` (default `/app/logs`, a mounted volume):
  - `failures.jsonl` — any pipeline failure, with step + context.
  - `dropped.jsonl` — non-whitelisted senders and fallback PDFs that can't be
    processed (reason field included).
  - `processed.jsonl` — successful runs.

#### Env

| Variable | Default | Purpose |
|---|---|---|
| `WEBHOOK_SECRET` | — (required) | Bearer secret for the webhook |
| `SIDECAR_CONFIG` | `/app/config.yaml` | Config file path |
| `LOG_DIR` | `/app/logs` | JSONL log directory |
| `DOCLING_BASE_URL` | `http://docling-serve:5001` | docling-serve endpoint |
| `PORT` | `3000` | HTTP listen port |

Papra connection details live in the config YAML (not env), so multiple
senders/rules can share one config file.

### 3. Config (`/app/config.yaml`, mounted read-only)

```yaml
papra:
  apiUrl: "http://papra:1221"
  apiToken: "<papra-api-token>"      # documents:create/read/update, tags:read/create
  organizationId: "<org-id>"
  defaultOcrLanguages: ["en"]        # global OCR default (used unless a rule overrides)

allowedSenders:                      # REQUIRED — only these are processed at all
  - person1@gmail.com
  - person2@gmail.com

defaultTagColor: "#6b7280"           # color for auto-created tags (optional override per rule)

fallbackTag: "adhoc-email-ingest"    # optional; tag added to every no-rule document

globalRules:                         # optional; tags applied to EVERY processed email
  - from: "person1@gmail.com"        #   match envelope from (normalized)
    tags: ["person1"]
  - originalTo: "@bank.com"          #   '@...' = domain-suffix match
    tags: ["bank"]

rules:
  - from: "statement@hdfcbank.com"   # matches the From: header or envelope from
    to: "papra-ingest@rakeshpai.me"  # optional; matches To: header or envelope to
    password: "abc123"               # optional; omit for plain PDFs
    namePrefix: "HDFC-Statement"     # → HDFC-Statement-2026-09.pdf
    ocrLanguages: ["en"]             # optional; falls back to papra.defaultOcrLanguages
    forceOcr: false                  # optional; passed to docling
    tags: ["bank", "hdfc"]
    tagColor: "#e11d48"              # optional; overrides defaultTagColor for auto-created tags
```

Notes:
- Config is read once at startup; **reload = container restart**.
- Passwords are plaintext in the file (accepted trade-off for a homelab).
- Address matching normalizes addresses (lowercase, Gmail `+`-suffix stripped),
  so Gmail SRS forwarding aliases like `person1+caf_=…@gmail.com` match
  `person1@gmail.com`.
- `globalRules` may match any of `from`/`to`/`originalFrom`/`originalTo`; a rule
  with multiple fields requires all to match; `@domain.com` values match by
  domain suffix. Global rules add tags only (never passwords/naming).
- `allowedSenders` gates **everything** — if an email doesn't match, it is
  dropped before any rule processing.

### 4. Papra API token requirements

| Permission | Used for |
|---|---|
| `documents:create` | upload |
| `documents:read` | poll until extraction done |
| `documents:update` | PATCH content/name |
| `tags:read` | resolve tag names → ids |
| `tags:create` | auto-create missing tags |

### 5. docling-serve

No changes required. The sidecar talks to the existing
`quay.io/docling-project/docling-serve-cpu:latest` container. The `ocr_lang`
parameter uses BCP-47 tags (`en`, `hi-IN`, …). The service canonicalizes them,
so `en` → English.

## Webhook payload (shared schema, `packages/shared`)

multipart/form-data:

| Field | Type | Description |
|---|---|---|
| `from` | string | envelope sender (`message.from`) |
| `to` | string | envelope recipient (`message.to`) |
| `originalFrom` | string (optional) | `From:` header address |
| `originalTo` | string (optional) | first `To:` header address |
| `subject` | string | subject |
| `date` | string | RFC 2822 date header |
| `messageId` | string | Message-Id header |
| `file` | file | the largest PDF attachment |

Validated on both sides with the same zod schema (worker constructs it,
sidecar parses it).

## Security model

- **Transport**: HTTPS end-to-end. The worker → sidecar hop goes over the
  Cloudflare tunnel (public `papra-ingest.rakeshpai.me`) to a container that is
  not otherwise reachable from the host network.
- **Auth**: shared `WEBHOOK_SECRET` as Bearer token; sidecar rejects everything
  else with `401` (constant-time compare).
- **Sender allow-list**: the sidecar only processes senders with a config rule;
  everything else is dropped + logged. Because mail is forwarded from Gmail,
  SPF/DKIM/DMARC are handled by Gmail; the `from` header is still header-
  spoofable in principle, so the allow-list is a convenience gate, not a
  cryptographic boundary.
- **Payload caps**: 25 MB body limit.
- **Secrets at rest**: webhook secret in compose `.env`; per-sender passwords in
  the mounted config YAML (plaintext, repo-private).

## Failure handling

- Webhook accepts and returns `202` immediately; all heavy work is async.
- Failures are **not retried** (in this iteration): each failure is appended to
  `failures.jsonl` with the messageId and step, so a human can re-drive or
  investigate. A container restart drops queued jobs (in-memory queue).
- Papra dedup is relied upon to prevent duplicate documents if an email is
  processed twice.

## Deployment topology

- **Worker** → published to Cloudflare via `wrangler deploy` (GitHub Actions on
  `main`). Emails routed to it via Email Routing.
- **papra-sidecar** → built with `buildx` for `linux/amd64` + `linux/arm64`,
  pushed to `ghcr.io/rakeshpai/papra-sidecar` (`latest` on `main`, `vX.Y.Z` on
  tags), pulled into `home-server-setup`'s docker compose.
- **home-server-setup PR** adds the `papra-sidecar` service, `.env` entry,
  config file, and documents the two manual steps (tunnel ingress route +
  Email Routing rule).

## Repository layout

```
.
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── shared/                  # zod schemas shared across runtimes
│   ├── worker/                  # Cloudflare Email Worker
│   └── papra-sidecar/           # Dockerized Node 22 + Hono app
└── .github/workflows/
    ├── ci.yaml
    └── deploy.yaml
```