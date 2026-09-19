import { z } from 'zod';

export const failureLogSchema = z.object({
  level: z.literal('failure'),
  timestamp: z.string(),
  messageId: z.string(),
  from: z.string(),
  to: z.string(),
  step: z.string(),
  error: z.string(),
});

export type FailureLogLine = z.infer<typeof failureLogSchema>;

export const droppedLogSchema = z.object({
  level: z.literal('dropped'),
  timestamp: z.string(),
  messageId: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
});

export type DroppedLogLine = z.infer<typeof droppedLogSchema>;

export const processedLogSchema = z.object({
  level: z.literal('processed'),
  timestamp: z.string(),
  messageId: z.string(),
  from: z.string(),
  to: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  ocrLanguages: z.array(z.string()),
  tags: z.array(z.string()),
});

export type ProcessedLogLine = z.infer<typeof processedLogSchema>;