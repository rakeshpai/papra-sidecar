import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rule, SidecarConfig } from '@papra-sidecar/shared';
import { decryptPdf } from './decrypt.js';
import { extractMarkdown } from './docling.js';
import { SidecarLogger } from './logger.js';
import { buildDocumentName, parseEmailDate } from './name.js';
import { PapraClient } from './papra.js';

export const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TAG_COLOR = '#6b7280';

export interface JobInput {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  file: { filename: string; contentType?: string; data: Uint8Array };
}

export interface ProcessContext {
  config: SidecarConfig;
  rule: Rule;
  doclingBaseUrl: string;
  logDir: string;
}

function ocrLanguagesFor(config: SidecarConfig, rule: Rule): string[] {
  return rule.ocrLanguages ?? config.papra.defaultOcrLanguages;
}

export async function processJob(input: JobInput, ctx: ProcessContext): Promise<void> {
  const logger = new SidecarLogger(ctx.logDir);
  const timestamp = new Date().toISOString();
  const tempDir = mkdtempSync(join(tmpdir(), 'papra-sidecar-'));
  let step = 'setup';

  const failureBase = {
    level: 'failure' as const,
    timestamp,
    messageId: input.messageId,
    from: input.from,
    to: input.to,
  };

  try {
    step = 'decrypt';
    const inputPath = join(tempDir, 'input.pdf');
    writeFileSync(inputPath, input.file.data);

    const decryptedPath = join(tempDir, 'decrypted.pdf');
    const decryptResult = decryptPdf(inputPath, decryptedPath, ctx.rule.password);
    if (decryptResult.kind === 'failed') {
      logger.failure({ ...failureBase, step, error: decryptResult.reason });
      return;
    }

    step = 'docling';
    const documentName = buildDocumentName(ctx.rule.namePrefix, parseEmailDate(input.date));
    const namedPath = join(tempDir, documentName);
    copyFileSync(decryptedPath, namedPath);
    const markdown = await extractMarkdown(namedPath, {
      baseUrl: ctx.doclingBaseUrl,
      ocrLanguages: ocrLanguagesFor(ctx.config, ctx.rule),
      forceOcr: ctx.rule.forceOcr ?? false,
    });

    step = 'papra:create';
    const papra = new PapraClient(
      ctx.config.papra.apiToken,
      ctx.config.papra.organizationId,
      ctx.config.papra.apiUrl,
    );
    const document = await papra.createDocument(namedPath);

    step = 'papra:wait-extraction';
    await papra.waitForExtraction(document.id, EXTRACTION_TIMEOUT_MS);

    step = 'papra:patch';
    await papra.patchDocument(document.id, { name: documentName, content: markdown });

    step = 'papra:tags';
    const tagIds = await ensureTags(papra, ctx.config, ctx.rule);
    for (const tagId of tagIds) {
      await papra.addTagToDocument(document.id, tagId);
    }

    logger.processed({
      level: 'processed',
      timestamp,
      messageId: input.messageId,
      from: input.from,
      to: input.to,
      documentId: document.id,
      documentName,
      ocrLanguages: ocrLanguagesFor(ctx.config, ctx.rule),
      tags: ctx.rule.tags,
    });
  } catch (error) {
    logger.failure({
      ...failureBase,
      step,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureTags(
  papra: PapraClient,
  config: SidecarConfig,
  rule: Rule,
): Promise<string[]> {
  const existing = await papra.listTags();
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
  const tagIds: string[] = [];
  for (const name of rule.tags) {
    const key = name.toLowerCase();
    const existingTag = byName.get(key);
    if (existingTag !== undefined) {
      tagIds.push(existingTag.id);
      continue;
    }
    const color = rule.tagColor ?? config.defaultTagColor ?? DEFAULT_TAG_COLOR;
    const created = await papra.createTag(name, color);
    byName.set(key, created);
    tagIds.push(created.id);
  }
  return tagIds;
}