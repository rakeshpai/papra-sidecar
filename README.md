# papra-sidecar

A bespoke sidecar for a home-lab [Papra](https://papra.app) installation that
turns emailed PDF statements (bank / credit-card / mutual-fund) into tagged Papra
documents.

```
Bank email (password-protected PDF)
        │  forwarded from family members' Gmail
        ▼
papra-ingest@rakeshpai.me
        │  Cloudflare Email Routing → worker
        ▼
┌─────────────────────────────────────────────┐
│ Cloudflare Email Worker  (packages/worker)  │
│  • parse MIME, pick the LARGEST PDF         │
│  • POST multipart to the sidecar webhook    │
└────────────────────┬────────────────────────┘
                     │  HTTPS via Cloudflare tunnel (papra-ingest.rakeshpai.me)
                     │  Authorization: Bearer <WEBHOOK_SECRET>
                     ▼
┌─────────────────────────────────────────────┐
│ papra-sidecar  (packages/papra-sidecar)     │  Node 22 + Hono, in Docker
│  • validate secret + payload, reply 202     │
│  • per-sender rule match (drop+log unknown) │
│  • qpdf decrypt (per-sender password)       │
│  • name → {prefix}-{YYYY-MM}.pdf            │
│  • docling-serve parse (OCR language cfg)   │
│  • upload to Papra, wait, PATCH content     │
│  • auto-create & apply tags                 │
└────────────────────┬────────────────────────┘
                     ▼  home-docker-network
            papra  (http://papra:1221)   ·   docling-serve  (http://docling-serve:5001)
```

**Why this exists:** Papra's built-in content extraction calls docling without
any OCR language, so docling defaults to Chinese. This sidecar parses with
docling itself, letting each sender configure OCR languages. (Verified in
Papra's source: the `ocrLanguages` field never reaches the docling strategy.)

## Repository layout

```
packages/
  shared/          zod schemas shared across runtimes (webhook payload, config, logs)
  worker/          Cloudflare Email Worker (wrangler)
  papra-sidecar/   Dockerized Node 22 + Hono app
.github/workflows/
  ci.yaml          build + typecheck + lint + test on PR/push
  deploy.yaml      wrangler deploy (main) + buildx → ghcr.io/rakeshpai/papra-sidecar (tags)
```

## Local development

Requirements: Node.js 22+, pnpm 11.22, and `qpdf` (for the decrypt tests;
`brew install qpdf` or `apt install qpdf`).

```bash
pnpm install
pnpm build          # compiles shared + sidecar
pnpm typecheck
pnpm lint
pnpm test           # 61 tests
```

Run the sidecar locally:

```bash
mkdir -p /tmp/sidecar/logs
cat > /tmp/sidecar/config.yaml <<'EOF'
papra:
  apiUrl: http://papra:1221
  apiToken: CHANGE_ME
  organizationId: CHANGE_ME
rules: []
EOF
WEBHOOK_SECRET=dev-secret \
SIDECAR_CONFIG=/tmp/sidecar/config.yaml \
LOG_DIR=/tmp/sidecar/logs \
pnpm --filter @papra-sidecar/papra-sidecar start
curl localhost:3000/healthz   # → {"ok":true}
```

## Docker image

The image is built multi-stage (`node:22-bookworm-slim` + `qpdf`) and published
to `ghcr.io/rakeshpai/papra-sidecar`:

```bash
docker build -f packages/papra-sidecar/Dockerfile -t papra-sidecar:test .
```

**Runtime requirements / mount points:**

| Item | Value |
|---|---|
| Port | 3000 (never publish to the host; reach it only via the tunnel) |
| Env `WEBHOOK_SECRET` | (required) shared secret the worker sends as a Bearer token |
| Env `SIDECAR_CONFIG` | config file path, default `/app/config.yaml` |
| Env `LOG_DIR` | JSONL log dir, default `/app/logs` |
| Env `DOCLING_BASE_URL` | default `http://docling-serve:5001` |
| Env `PORT` | default `3000` |
| Mount `/app/config.yaml` | read-only config (restart to reload) |
| Mount `/app/logs` | `failures.jsonl`, `dropped.jsonl`, `processed.jsonl` |
| Healthcheck | `GET /healthz` → `200 {"ok":true}` |

`docker run` smoke test:

```bash
docker run --rm -d --name papra-sidecar \
  -e WEBHOOK_SECRET=test \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  -v "$PWD/logs:/app/logs" \
  -p 3000:3000 ghcr.io/rakeshpai/papra-sidecar:latest
curl localhost:3000/healthz
```

## App configuration (`config.yaml`)

Full schema (strictly validated):

```yaml
papra:
  apiUrl: "http://papra:1221"          # Papra service on the docker network
  apiToken: "papra-api-token"           # needs documents:create/read/update, tags:read/create
  organizationId: "org_xxx"             # Papra organization id
  defaultOcrLanguages: ["en"]           # global OCR language (fallback)

allowedSenders:                         # REQUIRED — only these are processed at all
  - person1@gmail.com                   # Gmail +-suffix (SRS) aliases match automatically
  - person2@gmail.com

defaultTagColor: "#6b7280"              # color for tags auto-created in Papra

fallbackTag: "adhoc-email-ingest"       # optional; tag added to every no-rule document

globalRules:                            # optional; tags applied to EVERY processed email
  - from: "person1@gmail.com"           #   matches envelope from
    tags: ["person1"]
  - originalFrom: "statement@bank.com"  #   matches the From: header
    tags: ["bank"]
  - originalTo: "@bank.com"             #   '@...' = domain-suffix match
    tags: ["bank"]

rules:
  - from: "statement@hdfcbank.com"       # sender (From: header or envelope)
    to: "papra-ingest@rakeshpai.me"      # optional constraint on recipient
    password: "abc123"                   # decryption password (omit for plain PDFs)
    namePrefix: "HDFC-Statement"         # document name → HDFC-Statement-2026-09.pdf
    ocrLanguages: ["en"]                 # optional; falls back to defaultOcrLanguages
    forceOcr: false                      # optional; passed to docling
    tags: ["bank", "hdfc"]               # auto-created in Papra if missing
    tagColor: "#e11d48"                  # optional per-rule color override
```

Notes:
- **`allowedSenders` gates everything**: an email whose sender (envelope `from`,
  or `originalFrom` as a fallback) is not whitelisted is dropped and logged to
  `dropped.jsonl` with `reason: "sender not whitelisted"`.
- **One `rules` entry per sender**; first matching `from` (+ optional `to`) wins.
- **Global rules** apply to all processed emails (specific-rule or fallback) and
  only add tags. A `@domain.com` value matches by domain suffix. Addresses are
  normalized (lowercased, Gmail `+`-suffix stripped), so Gmail SRS aliases like
  `person1+caf_=…@gmail.com` match `person1@gmail.com`.
- **Fallback**: emails from a whitelisted sender with no matching rule are still
  processed **if the PDF is unencrypted** (encrypted ones are dropped and logged).
  They are named from the subject (`{sanitizedSubject}-{YYYY-MM}.pdf`), use the
  global `defaultOcrLanguages`, and get the `fallbackTag` if configured.
- A wrong password on a specific rule is logged to `failures.jsonl` (no retry).
- If a rule has a password but the PDF is actually unencrypted, it is still
  processed (plain-copy fallback).
- The document name uses the **email date** → `{namePrefix}-{YYYY-MM}.pdf`.

## Cloudflare setup

### 1. Deploy the email worker

```bash
cd packages/worker
pnpm install
pnpm exec wrangler login
pnpm exec wrangler secret put WEBHOOK_URL    # https://papra-ingest.rakeshpai.me/webhook
pnpm exec wrangler secret put WEBHOOK_SECRET # same value as PAPRA_SIDECAR_WEBHOOK_SECRET
pnpm exec wrangler deploy
```

The worker:
- parses the raw email (`postal-mime`),
- selects the **largest PDF** attachment,
- POSTs `from`, `to`, `subject`, `date`, `messageId`, `file` (multipart) to
  `WEBHOOK_URL` with `Authorization: Bearer WEBHOOK_SECRET`,
- drops emails without a PDF.

### 2. Email Routing

In the Cloudflare dashboard → **Email Routing**:
1. Onboard your domain if you haven't.
2. Add a routing rule: **`papra-ingest@rakeshpai.me` → the `papra-sidecar-worker`**.
3. Have each family member forward their statement emails to
   `papra-ingest@rakeshpai.me` from their Gmail.

### 3. Tunnel route (to expose the sidecar webhook)

The sidecar is **not** published to the host; it is only reachable inside the
docker network. The Cloudflare worker can only reach public URLs, so route a
subdomain through the existing `cloudflared` tunnel:

Cloudflare Zero Trust dashboard → Networks → Tunnels → your tunnel →
Public Hostname → add:

| Field | Value |
|---|---|
| Subdomain | `papra-ingest` |
| Domain | `rakeshpai.me` |
| Service | `http://papra-sidecar:3000` |

### 4. GitHub Actions secrets

In the `papra-sidecar` repo settings → Secrets and variables → Actions:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy (permissions: Workers Scripts edit) |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |
| `WORKER_WEBHOOK_URL` | `https://papra-ingest.rakeshpai.me/webhook` |
| `WORKER_WEBHOOK_SECRET` | shared webhook secret |

Deploys: worker deploys on every push to `main`; the container is published to
ghcr when you push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## home-server-setup (docker compose)

Add the service to `docker-compose.yml` on `home-docker-network` (see the
[PR](https://github.com/rakeshpai/home-server-setup/pull/1) for the exact diff):

```yaml
papra-sidecar:
  container_name: papra-sidecar
  hostname: papra-sidecar
  image: ghcr.io/rakeshpai/papra-sidecar:latest
  restart: unless-stopped
  environment:
    - WEBHOOK_SECRET=${PAPRA_SIDECAR_WEBHOOK_SECRET}
  volumes:
    - ./docker/papra-sidecar/config.yaml:/app/config.yaml:ro
    - ./docker/papra-sidecar/logs:/app/logs
  healthcheck:
    test:
      - CMD
      - node
      - -e
      - fetch('http://localhost:3000/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))
    interval: 60s
    timeout: 5s
    retries: 3
    start_period: 10s
  networks:
    - home-docker-network
```

Steps:

1. Add `PAPRA_SIDECAR_WEBHOOK_SECRET=<random>` to your `.env`
   (generate with `openssl rand -hex 32`).
2. Create `docker/papra-sidecar/config.yaml` (see the schema above) and fill in
   the real Papra API token, organization id, and per-sender rules.
   The repo tracks a template at `docker/papra-sidecar/config.yaml`
   (runtime data under that dir is gitignored).
3. Apply the tunnel ingress route and the Email Routing rule (Cloudflare steps above).
4. `docker compose pull papra-sidecar && docker compose up -d papra-sidecar`.
5. Confirm the container is healthy (`docker compose ps`).

**Mount points recap** (sidecar container):

| Host path (`./docker/papra-sidecar/...`) | Container path | Purpose |
|---|---|---|
| `config.yaml` | `/app/config.yaml` (read-only) | app config; restart to reload |
| `logs/` | `/app/logs` | JSONL logs (`failures`, `dropped`, `processed`) |

## Verify end-to-end

1. Send a real password-protected PDF from a configured sender to
   `papra-ingest@rakeshpai.me`.
2. In Papra, expect a document `{namePrefix}-{YYYY-MM}.pdf` with English docling
   content and the configured tags.
3. Inspect logs:
   - `docker/papra-sidecar/logs/processed.jsonl` — success lines
   - `docker/papra-sidecar/logs/dropped.jsonl` — non-whitelisted senders and
     fallback PDFs that couldn't be processed (reason included)
   - `docker/papra-sidecar/logs/failures.jsonl` — decrypt / docling / Papra errors
4. Re-send the same statement → Papra's dedup should avoid a duplicate.

## Troubleshooting

- **Webhook returns 401** — `PAPRA_SIDECAR_WEBHOOK_SECRET` and the worker's
  `WEBHOOK_SECRET` must match.
- **Emails not arriving** — check the Email Routing rule and `wrangler tail`
  in `packages/worker`.
- **`step: docling` failures** — the sidecar can't reach
  `http://docling-serve:5001`; make sure `docling-serve` is up on the same
  docker network.
- **`step: papra:*` failures** — check the Papra API token permissions and that
  `papra.apiUrl` is reachable from the sidecar container.

## Out of scope (future)

- Retries / dead-letter queue for failures.
- Non-PDF attachments / multiple PDFs per email.
- ZIP / 7z / GPG encrypted attachments.
- Config hot-reload without restart.