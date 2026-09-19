FROM node:22-bookworm-slim AS build

WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN npm install -g pnpm@11.22.0
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @papra-sidecar/shared build \
  && pnpm --filter @papra-sidecar/papra-sidecar build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends qpdf \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build /repo/packages ./packages

RUN npm install -g pnpm@11.22.0 \
  && pnpm install --prod --frozen-lockfile --ignore-scripts

ENV NODE_ENV=production

USER node
EXPOSE 3000

CMD ["node", "packages/papra-sidecar/dist/main.js"]