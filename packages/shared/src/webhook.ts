import { z } from 'zod';

export const webhookFieldsSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  date: z.string().min(1),
  messageId: z.string(),
});

export type WebhookFields = z.infer<typeof webhookFieldsSchema>;

export const webhookFileSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative(),
});

export type WebhookFile = z.infer<typeof webhookFileSchema>;

export const webhookPayloadSchema = webhookFieldsSchema.extend({
  file: webhookFileSchema,
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;