import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rule, SidecarConfig } from '@papra-sidecar/shared';
import { decryptPdf, isPdfUnencrypted } from './decrypt.js';
import { SidecarLogger } from './logger.js';
import {
  buildDocumentName,
  buildDocumentNameFromSubject,
  parseEmailDate,
} from './name.js';
import { PapraClient } from './papra.js';
import { collectGlobalTags, type EmailIdentity } from './rules.js';

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

    const emailDate = parseEmailDate(input.date);
    const documentName =
      ctx.rule === null
        ? buildDocumentNameFromSubject(input.subject, emailDate)
        : buildDocumentName(ctx.rule.namePrefix, emailDate);
    const namedPath = join(tempDir, documentName);

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
      copyFileSync(inputPath, namedPath);
    } else {
      const decryptResult = decryptPdf(inputPath, namedPath, ctx.rule.password);
      if (decryptResult.kind === 'failed') {
        logger.failure({ ...failureBase, step, error: decryptResult.reason });
        return;
      }
    }

    step = 'papra:create';
    const papra = new PapraClient(
      ctx.config.papra.apiToken,
      ctx.config.papra.organizationId,
      ctx.config.papra.apiUrl,
    );
    const document = await papra.createDocument(namedPath);

    step = 'papra:tags';
    const globalTags = collectGlobalTags(ctx.config, identity);
    const tags = [
      ...new Set(
        ctx.rule === null
          ? [
              ...globalTags,
              ...(ctx.config.fallbackTag !== undefined ? [ctx.config.fallbackTag] : []),
            ]
          : [...ctx.rule.tags, ...globalTags],
      ),
    ];
    const failedTags = await applyTags({
      papra,
      config: ctx.config,
      tags,
      ...(ctx.rule?.tagColor !== undefined ? { color: ctx.rule.tagColor } : {}),
      documentId: document.id,
      logger,
    });
    if (failedTags.length > 0) {
      throw new Error(
        `failed to apply ${failedTags.length} of ${tags.length} tag(s): ${failedTags.join(', ')}`,
      );
    }

    logger.processed({
      level: 'processed',
      timestamp,
      messageId: input.messageId,
      from: input.from,
      to: input.to,
      documentId: document.id,
      documentName,
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

interface ApplyTagsOptions {
  papra: PapraClient;
  config: SidecarConfig;
  tags: string[];
  color?: string;
  documentId: string;
  logger: SidecarLogger;
}

/**
 * Resolves, creates and attaches each tag independently. A failure on one tag is
 * logged with the tag name and does not prevent the remaining tags from being
 * applied; the names of the tags that failed are returned so the caller can fail
 * the job loudly (instead of silently leaving the document untagged).
 */
async function applyTags({
  papra,
  config,
  tags,
  color,
  documentId,
  logger,
}: ApplyTagsOptions): Promise<string[]> {
  const existing = await papra.listTags();
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
  const failed: string[] = [];

  for (const name of tags) {
    const key = name.toLowerCase();
    try {
      let tag = byName.get(key);
      if (tag === undefined) {
        const resolvedColor = color ?? config.defaultTagColor ?? DEFAULT_TAG_COLOR;
        tag = await papra.createTag(name, resolvedColor);
        byName.set(key, tag);
      }
      await papra.addTagToDocument(documentId, tag.id);
    } catch (error) {
      failed.push(name);
      logger.log.error(
        {
          step: 'papra:tags',
          documentId,
          tag: name,
          error: error instanceof Error ? error.message : String(error),
        },
        'tag application failed',
      );
    }
  }

  return failed;
}