import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rule, SidecarConfig } from '@papra-sidecar/shared';
import { decryptPdf, isPdfUnencrypted } from './decrypt.js';
import { extractMarkdown } from './docling.js';
import { SidecarLogger } from './logger.js';
import {
  buildDocumentName,
  buildDocumentNameFromSubject,
  parseEmailDate,
} from './name.js';
import { PapraClient } from './papra.js';
import { collectGlobalTags, type EmailIdentity } from './rules.js';

export const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TAG_COLOR = '#6b7280';

export interface JobInput {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  originalFrom?: string;
  originalTo?: string;
  file: { filename: string; contentType?: string; data: Uint8Array };
}

export interface ProcessContext {
  config: SidecarConfig;
  rule: Rule | null;
  doclingBaseUrl: string;
  logDir: string;
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
  const identity: EmailIdentity = {
    from: input.from,
    to: input.to,
    originalFrom: input.originalFrom ?? '',
    originalTo: input.originalTo ?? '',
  };

  try {
    step = 'decrypt';
    const inputPath = join(tempDir, 'input.pdf');
    writeFileSync(inputPath, input.file.data);

    const decryptedPath = join(tempDir, 'decrypted.pdf');
    if (ctx.rule === null) {
      if (!isPdfUnencrypted(inputPath)) {
        logger.dropped({
          level: 'dropped',
          timestamp,
          messageId: input.messageId,
          from: input.from,
          to: input.to,
          subject: input.subject,
          reason: 'encrypted pdf with no matching rule',
        });
        return;
      }
      copyFileSync(inputPath, decryptedPath);
    } else {
      const decryptResult = decryptPdf(inputPath, decryptedPath, ctx.rule.password);
      if (decryptResult.kind === 'failed') {
        logger.failure({ ...failureBase, step, error: decryptResult.reason });
        return;
      }
    }

    step = 'docling';
    const emailDate = parseEmailDate(input.date);
    const documentName =
      ctx.rule === null
        ? buildDocumentNameFromSubject(input.subject, emailDate)
        : buildDocumentName(ctx.rule.namePrefix, emailDate);
    const namedPath = join(tempDir, documentName);
    copyFileSync(decryptedPath, namedPath);

    const ocrLanguages =
      ctx.rule !== null && ctx.rule.ocrLanguages !== undefined
        ? ctx.rule.ocrLanguages
        : ctx.config.papra.defaultOcrLanguages;
    const forceOcr = ctx.rule?.forceOcr ?? false;

    const markdown = await extractMarkdown(namedPath, {
      baseUrl: ctx.doclingBaseUrl,
      ocrLanguages,
      forceOcr,
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
    const globalTags = collectGlobalTags(ctx.config, identity);
    const tags =
      ctx.rule === null
        ? [...globalTags, ...(ctx.config.fallbackTag !== undefined ? [ctx.config.fallbackTag] : [])]
        : [...ctx.rule.tags, ...globalTags];
    const tagIds = await ensureTags(papra, ctx.config, tags, ctx.rule?.tagColor);
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
      ocrLanguages,
      tags,
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
  tags: string[],
  color?: string,
): Promise<string[]> {
  const existing = await papra.listTags();
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
  const tagIds: string[] = [];
  for (const name of tags) {
    const key = name.toLowerCase();
    const existingTag = byName.get(key);
    if (existingTag !== undefined) {
      tagIds.push(existingTag.id);
      continue;
    }
    const resolvedColor = color ?? config.defaultTagColor ?? DEFAULT_TAG_COLOR;
    const created = await papra.createTag(name, resolvedColor);
    byName.set(key, created);
    tagIds.push(created.id);
  }
  return tagIds;
}