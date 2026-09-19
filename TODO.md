# TODO — papra-sidecar

Implementation status. All automated work is complete and validated; the
remaining items are manual steps that require the live infrastructure
(Cloudflare account, home server).

Legend: 🔧 = code, 🧪 = test, 📦 = packaging, 🚀 = deploy, 📋 = manual

---

## Phase 0 — Workspace scaffolding

- [x] 0.1 Create `pnpm-workspace.yaml` listing `packages/*`.
- [x] 0.2 Add root `package.json` scripts (`build`, `typecheck`, `lint`, `test`).
- [x] 0.3 Create `tsconfig.base.json` with the strictest shared settings
      (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
      `verbatimModuleSyntax`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, …).
- [x] 0.4 Add `.gitignore`.
- [x] 0.5 Add `eslint.config.js` (typescript-eslint recommended).
- [x] 0.6 Add Vitest workspace config.
- [x] 0.7 Verify `pnpm install` + `pnpm typecheck` clean.

## Phase 1 — `packages/shared` (schemas)

- [x] 1.1 Package skeleton (`@papra-sidecar/shared`, ESM, `exports`).
- [x] 1.2 `src/webhook.ts` — webhook payload schema.
- [x] 1.3 `src/config.ts` — `config.yaml` schema (papra, defaultTagColor, rules).
- [x] 1.4 `src/logs.ts` — failure/drop/processed log schemas.
- [x] 1.5 🧪 Unit tests for schema acceptance/rejection.
- [x] 1.6 Verify `pnpm typecheck` + `pnpm test`.

## Phase 2 — `packages/worker`

- [x] 2.1 Skeleton + deps (`postal-mime`, `wrangler`, workers-types).
- [x] 2.2 `wrangler.jsonc` with observability logs.
- [x] 2.3 `src/types.ts` merged into `src/index.ts` (`Env`).
- [x] 2.4 `src/select.ts` — largest-PDF selection. 🧪 tested.
- [x] 2.5 `src/payload.ts` — multipart FormData builder. 🧪 tested.
- [x] 2.6 `src/index.ts` — `email` handler (parse → select → POST with Bearer).
- [x] 2.7 🔧 `wrangler deploy --dry-run` bundles cleanly.
- [x] 2.8 Verify `pnpm typecheck` + `pnpm test`.

## Phase 3 — `packages/papra-sidecar` (core app)

- [x] 3.1 Skeleton + deps (`hono`, `@hono/node-server`, `zod`, `yaml`, `pino`).
- [x] 3.2 `src/env.ts` — zod-validated env.
- [x] 3.3 `src/config.ts` — YAML loader + schema parse.
- [x] 3.4 `src/rules.ts` — per-sender rule matching. 🧪 tested.
- [x] 3.5 `src/logger.ts` — pino + JSONL appenders (appendFileSync).
- [x] 3.6 `src/queue.ts` — in-memory FIFO, concurrency 1.
- [x] 3.7 `src/decrypt.ts` — qpdf wrapper with plain/fallback handling. 🧪 tested.
- [x] 3.8 `src/name.ts` — `{prefix}-{YYYY-MM}.pdf` naming. 🧪 tested.
- [x] 3.9 `src/docling.ts` — docling-serve client (`ocr_lang` etc.). 🧪 tested.
- [x] 3.10 `src/papra.ts` — Papra API client (upload/poll/patch/tags). 🧪 tested.
- [x] 3.11 `src/process.ts` — job pipeline. 🧪 tested end-to-end (real qpdf,
      mocked docling/papra).
- [x] 3.12 `src/index.ts` + `src/main.ts` — Hono app (auth, 202, healthz). 🧪 tested.
- [x] 3.13 `Dockerfile` — multi-stage, `node:22-bookworm-slim` + qpdf.
- [x] 3.14 `.dockerignore` at repo root.
- [x] 3.15 🔧 Runtime layout validated locally (prod-only install + boot + healthz).
- [x] 3.16 Verify `pnpm typecheck` + `pnpm test` + `pnpm build`.

## Phase 4 — CI

- [x] 4.1 `.github/workflows/ci.yaml` (install → build → typecheck → lint → test).
- [x] 4.2 qpdf installed in CI for the decrypt fixture tests.
- [x] 4.3 Ready to run on PR/push (validated locally with the same commands).

## Phase 5 — Deploy automation

- [x] 5.1 `.github/workflows/deploy.yaml`:
      - Worker → `wrangler deploy` on `main` (secrets from repo secrets).
      - Container → buildx `linux/amd64,linux/arm64` → `ghcr.io/rakeshpai/papra-sidecar`
        (`latest` on main, `vX.Y.Z` + `vX.Y` on tags).
- [ ] 5.2 📋 Set repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
      `WORKER_WEBHOOK_URL`, `WORKER_WEBHOOK_SECRET`.
- [ ] 5.3 🚀 Release a `v0.1.0` tag to publish the image to ghcr.

## Phase 6 — home-server-setup integration

- [x] 6.1 Add `papra-sidecar` service to `docker-compose.yml` (image, env,
      config/log volumes, healthcheck, `home-docker-network`).
- [x] 6.2 `.env` requirement documented (`PAPRA_SIDECAR_WEBHOOK_SECRET`).
- [x] 6.3 `.gitignore` exception so `docker/papra-sidecar/config.yaml` is tracked.
- [x] 6.4 Create `docker/papra-sidecar/config.yaml` template.
- [x] 6.5 README section documenting the setup + manual steps.
- [x] 6.6 PR opened: https://github.com/rakeshpai/home-server-setup/pull/1
- [ ] 6.7 📋 Manual: add tunnel ingress route `papra-ingest.rakeshpai.me` →
      `http://papra-sidecar:3000`.
- [ ] 6.8 📋 Manual: Email Routing rule `papra-ingest@rakeshpai.me` →
      `papra-sidecar-worker`.
- [ ] 6.9 📋 Fill real values in `docker/papra-sidecar/config.yaml`.

## Phase 7 — End-to-end verification (requires live infra)

- [ ] 7.1 Deploy worker (push to main) and confirm Email Routing delivers to it.
- [ ] 7.2 `docker compose pull` + `up -d papra-sidecar`, confirm healthcheck green.
- [ ] 7.3 Send a real password-protected PDF from a configured sender to
      `papra-ingest@rakeshpai.me`.
- [ ] 7.4 Confirm in Papra: `{prefix}-{YYYY-MM}.pdf`, English docling content, tags.
- [ ] 7.5 Confirm `processed.jsonl` / `dropped.jsonl` / `failures.jsonl` lines.
- [ ] 7.6 Re-send the same statement → confirm Papra dedup avoids a duplicate.

---

## Out of scope (future iterations)

- Retries / dead-letter queue for failures.
- Non-PDF attachments, multi-PDF uploads.
- Password-protected ZIP/7z/GPG inputs.
- Hot-reload of config without restart.
- Per-recipient routing beyond the optional `to` constraint.