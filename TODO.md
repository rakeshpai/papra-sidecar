# TODO — papra-sidecar

Sequential, step-by-step implementation plan. Check off each item as it is
done. Phases are ordered so that each phase leaves the repo in a working,
verifiable state. Every `tsc --noEmit` / `pnpm lint` / `pnpm test` must pass
at the end of each phase.

Legend: 🔧 = code, 🧪 = test, 📦 = packaging, 🚀 = deploy.

---

## Phase 0 — Workspace scaffolding

- [ ] 0.1 Create `pnpm-workspace.yaml` listing `packages/*`.
- [ ] 0.2 Add root `package.json` scripts:
  - `build`, `typecheck`, `lint`, `test`, `dev:worker`, `dev:sidecar`.
  - `packageManager` / `devEngines` already pin pnpm `^11.22.0`.
- [ ] 0.3 Create `tsconfig.base.json` with the strictest shared settings:
  - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
    `verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
    `noUnusedLocals`, `noUnusedParameters`, `noUnusedLocals`,
    `forceConsistentCasingInFileNames`, `noPropertyAccessFromIndexSignature`,
    `isolatedModules`, `skipLibCheck` (perf only).
  - Per-package overrides: `worker` → `moduleResolution: bundler`, types
    `@cloudflare/workers-types`, target `ES2022`; `papra-sidecar` →
    `module: NodeNext`, `moduleResolution: NodeNext`, target `ES2023`,
    types `node`.
- [ ] 0.4 Add `.gitignore` (node_modules, dist, .wrangler, *.log).
- [ ] 0.5 Add `eslint.config.js` (flat config; `typescript-eslint` strict
      recommended + `no-unused-vars` erroring).
- [ ] 0.6 Add Vitest root config (`vitest.workspace.ts` or per-package configs).
- [ ] 0.7 Verify: `pnpm install` runs clean; `pnpm typecheck` passes with no
      code yet.

## Phase 1 — `packages/shared` (schemas)

- [ ] 1.1 Package skeleton: `package.json` (name `@papra-sidecar/shared`, ESM,
      `exports` for `./schemas`), `tsconfig.json` extending base.
- [ ] 1.2 `src/webhook.ts` — zod schema for the multipart webhook payload
      (`from`, `to`, `subject`, `date` RFC2822, `messageId`, `file` as
      `{ filename, contentType, size }`).
- [ ] 1.3 `src/config.ts` — zod schema for `config.yaml`:
      `papra{apiUrl,apiToken,organizationId,defaultOcrLanguages}`,
      `defaultTagColor`, `rules[]` with `from`, optional `to`, optional
      `password`, `namePrefix`, optional `ocrLanguages`, optional `forceOcr`,
      `tags[]`, optional `tagColor`. Strict (no unknown keys).
- [ ] 1.4 `src/logs.ts` — zod schemas for failure/drop/processed log lines.
- [ ] 1.5 🧪 Unit tests for schema acceptance/rejection (vitest).
- [ ] 1.6 Verify `pnpm typecheck` + `pnpm test` in this package.

## Phase 2 — `packages/worker`

- [ ] 2.1 Skeleton: `package.json` (`@papra-sidecar/worker`, deps `postal-mime`,
      `hono` not needed; dev deps `wrangler`, `@cloudflare/workers-types`,
      `@cloudflare/vitest-pool-workers` optional), `tsconfig.json`.
- [ ] 2.2 `wrangler.jsonc` (or `.toml`): `name = "papra-sidecar-worker"`,
      `main = "src/index.ts"`, `compatibility_date`, `observability.logs`
      enabled (mirror `papra-hq/email-proxy`).
- [ ] 2.3 `src/types.ts` — `Env { WEBHOOK_URL, WEBHOOK_SECRET }`,
      `ForwardableEmailMessage` typing.
- [ ] 2.4 `src/select.ts` — pure function: given parsed attachments, return the
      largest PDF (mime `application/pdf` or `.pdf` filename). 🧪 unit test.
- [ ] 2.5 `src/payload.ts` — pure function: build `FormData` from parsed email
      + chosen attachment (`from`, `to`, `subject`, `date`, `messageId`, `file`)
      using the shared schema types. 🧪 unit test.
- [ ] 2.6 `src/index.ts` — `email(message, env)` handler:
      parse with `postal-mime` → select largest PDF → if none, `console.log`
      drop and return → POST to `WEBHOOK_URL` with
      `Authorization: Bearer ${WEBHOOK_SECRET}` → throw on non-2xx.
- [ ] 2.7 🔧 Manual smoke test: `wrangler dev` and confirm the email handler
      compiles; optional `wrangler email send` test once deployed.
- [ ] 2.8 Verify `pnpm typecheck` + `pnpm test`.

## Phase 3 — `packages/papra-sidecar` (core app)

- [ ] 3.1 Skeleton: `package.json` (`@papra-sidecar/papra-sidecar`, deps `hono`,
      `zod`, `yaml`, `pino`; dev deps `vitest`, `@types/node`), `tsconfig.json`.
- [ ] 3.2 `src/env.ts` — zod-validated env: `WEBHOOK_SECRET` (required),
      `SIDECAR_CONFIG`, `LOG_DIR`, `DOCLING_BASE_URL`, `PORT`.
- [ ] 3.3 `src/config.ts` — load YAML, parse with shared schema, expose typed
      config + `defaultOcrLanguages`/`defaultTagColor` resolution.
- [ ] 3.4 `src/rules.ts` — `matchRule(config, {from, to})`: first rule matching
      `from` (case-insensitive) and optional `to`; returns rule or `null`.
      🧪 unit tests (incl. `to`-constraint and no-match).
- [ ] 3.5 `src/logger.ts` — pino stdout logger + JSONL appenders
      (`failures.jsonl`, `dropped.jsonl`, `processed.jsonl`) with zod-typed
      lines.
- [ ] 3.6 `src/queue.ts` — in-memory FIFO with concurrency 1 (simple async
      worker loop; no external dep or use `p-queue` if preferred).
- [ ] 3.7 `src/decrypt.ts` — qpdf wrapper:
      - `decryptPdf(inPath, outPath, password?)` runs `qpdf --decrypt
        [--password=<pw>]`;
      - fallback: retry without password when password attempt fails;
      - returns result classification (`decrypted` | `plain` | `failed`) and
        throws a typed error on hard failure. 🧪 test with a fixture encrypted
        PDF (generate in CI via `qpdf --encrypt`).
- [ ] 3.8 `src/name.ts` — `buildDocumentName(namePrefix, emailDate)` →
      `{prefix}-{YYYY-MM}.pdf`; parses RFC2822 `date`, falls back to now.
      🧪 unit tests.
- [ ] 3.9 `src/docling.ts` — `extractMarkdown(pdfPath, {ocrLanguages, forceOcr})`:
      POST `{DOCLING_BASE_URL}/v1/convert/file` multipart (`files`,
      `to_formats=md`, `image_export_mode=placeholder`, `ocr_lang` repeated,
      `force_ocr`), parse `{document:{md_content}}`, strip `<!-- image -->`.
      Timeout + typed errors. 🧪 test with mocked fetch.
- [ ] 3.10 `src/papra.ts` — Papra API client:
      - `createDocument(orgId, file)` (multipart),
      - `getDocument(orgId, id)`,
      - `waitForExtraction(orgId, id, timeoutMs)` — poll until
        `document.content` non-empty (default 5 min),
      - `patchDocument(orgId, id, {name, content})`,
      - `listTags(orgId)`, `createTag(orgId, {name, color})`,
      - `addTagToDocument(orgId, docId, tagId)`.
      All with `Authorization: Bearer` and typed errors. 🧪 test with mocked
      fetch.
- [ ] 3.11 `src/process.ts` — the job runner that ties 3.7–3.10 together:
      1. temp file → 2. decrypt → 3. rename → 4. docling → 5. upload →
      6. waitForExtraction → 7. patch content/name → 8. ensure tags →
      9. processed log. Each step wrapped so failures append to
      `failures.jsonl`.
- [ ] 3.12 `src/index.ts` — Hono app:
      - `POST /webhook`: Bearer auth (constant-time), 25 MB cap, multipart
        parse + shared-schema validation, `matchRule` (no match → `dropped`
        log + `202`), enqueue + `202`.
      - `GET /healthz` → `200 {"ok":true}`.
- [ ] 3.13 `Dockerfile` — `node:22` (bookworm-slim), install `qpdf` via apt,
      copy built dist, `USER node`, `CMD ["node", "dist/index.js"]`; include
      `HEALTHCHECK` hitting `/healthz`.
- [ ] 3.14 `.dockerignore`, `docker-compose` for local dev (optional
      `compose.dev.yaml`) wiring config/logs volumes.
- [ ] 3.15 🔧 Manual smoke test: run locally against a stub papra/docling (or
      `wrangler dev` / plain `node`), POST a fixture email payload via curl;
      confirm 202, then processed/failure log lines.
- [ ] 3.16 Verify `pnpm typecheck` + `pnpm test` + `pnpm build`.

## Phase 4 — CI

- [ ] 4.1 `.github/workflows/ci.yaml`: on PR + push to `main` — `pnpm/action-setup`
      (v11), `actions/setup-node@v4` (Node 22), `pnpm install --frozen-lockfile`,
      `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [ ] 4.2 Ensure the fixture encrypted PDF for decrypt tests is generated
      inside CI (apt `qpdf` or `sudo apt-get install -y qpdf` step).
- [ ] 4.3 Verify a PR triggers a green CI run.

## Phase 5 — Deploy automation

- [ ] 5.1 `.github/workflows/deploy.yaml`:
      - Job A (worker): on `main` — `wrangler deploy` from `packages/worker`
        with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets.
      - Job B (container): on `main` → push `ghcr.io/rakeshpai/papra-sidecar:latest`;
        on tag `v*` → also push `:vX.Y.Z`. `docker/build-push-action` with
        `buildx`, platforms `linux/amd64,linux/arm64`, cache from
        `ghcr.io/rakeshpai/papra-sidecar:cache`.
- [ ] 5.2 Set repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
      `GHCR_PAT` (or use `GITHUB_TOKEN` if the container repo is public).
- [ ] 5.3 🚀 Release v0.1.0 tag → confirm image on ghcr.

## Phase 6 — home-server-setup integration (PR in that repo)

- [ ] 6.1 Add `papra-sidecar` service to `docker-compose.yml`:
      ```yaml
      papra-sidecar:
        container_name: papra-sidecar
        image: ghcr.io/rakeshpai/papra-sidecar:latest
        hostname: papra-sidecar
        restart: unless-stopped
        environment:
          - WEBHOOK_SECRET=${PAPRA_SIDECAR_WEBHOOK_SECRET}
        volumes:
          - ./docker/papra-sidecar/config.yaml:/app/config.yaml:ro
          - ./docker/papra-sidecar/logs:/app/logs
        networks:
          - home-docker-network
        healthcheck:
          test: ["CMD", "node", "-e", "fetch('http://localhost:3000/healthz')"]
          interval: 60s
          timeout: 5s
          retries: 3
      ```
- [ ] 6.2 Add `PAPRA_SIDECAR_WEBHOOK_SECRET=...` to `.env` (and generate a real
      random value).
- [ ] 6.3 Create `docker/papra-sidecar/config.yaml` from the ARCHITECTURE.md
      example, filled with real Papra `apiUrl`, `apiToken`, `organizationId`,
      and per-sender rules (all `to: papra-ingest@rakeshpai.me`).
- [ ] 6.4 Optional hardening: set `DOCLING_OPTIONS={"ocr_lang":["en"]}` on the
      `papra` service so Papra's own transient extraction isn't Chinese (our
      PATCH still wins regardless).
- [ ] 6.5 📋 Manual step (document in PR body): add tunnel ingress route in the
      Cloudflare dashboard: `papra-ingest.rakeshpai.me` →
      `http://papra-sidecar:3000`.
- [ ] 6.6 📋 Manual step (document in PR body): in Cloudflare Email Routing, add
      a rule for `papra-ingest@rakeshpai.me` → the deployed worker.
- [ ] 6.7 Open the PR to `rakeshpai/home-server-setup`.

## Phase 7 — End-to-end verification

- [ ] 7.1 Deploy worker (main) and confirm Email Routing delivers to it.
- [ ] 7.2 Pull sidecar image on the home server (`docker compose pull`), bring
      up, confirm `/healthz` green.
- [ ] 7.3 Send a real password-protected PDF from a configured sender to
      `papra-ingest@rakeshpai.me`.
- [ ] 7.4 Confirm in Papra: document named `{prefix}-{YYYY-MM}.pdf`, content is
      the English-OCR docling markdown (not Chinese), tags applied.
- [ ] 7.5 Confirm `processed.jsonl` has a success line; intentionally send an
      unmatched-sender email and confirm `dropped.jsonl`; wrong-password case →
      `failures.jsonl`.
- [ ] 7.6 Re-send the same statement → confirm Papra dedup avoids a duplicate.

---

## Out of scope (future iterations)

- Retries / dead-letter queue for failures.
- Non-PDF attachments, multi-PDF uploads.
- Password-protected ZIP/7z/GPG inputs.
- Hot-reload of config without restart.
- Per-recipient routing beyond the optional `to` constraint.