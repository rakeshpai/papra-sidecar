import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { loadEnv } from './env.js';
import { buildApp } from './index.js';
import { SidecarLogger } from './logger.js';

const env = loadEnv();
const config = loadConfig(env.SIDECAR_CONFIG);
const logger = new SidecarLogger(env.LOG_DIR);
const app = buildApp({ env, config, logger });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.log.info(`papra-sidecar listening on port ${info.port}`);
});