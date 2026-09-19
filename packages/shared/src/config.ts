import { z } from 'zod';

const nonEmptyString = z.string().min(1);

export const papraConfigSchema = z
  .object({
    apiUrl: nonEmptyString,
    apiToken: nonEmptyString,
    organizationId: nonEmptyString,
    defaultOcrLanguages: z.array(nonEmptyString).default(['en']),
  })
  .strict();

export type PapraConfig = z.infer<typeof papraConfigSchema>;

export const ruleSchema = z
  .object({
    from: nonEmptyString,
    to: nonEmptyString.optional(),
    password: nonEmptyString.optional(),
    namePrefix: nonEmptyString,
    ocrLanguages: z.array(nonEmptyString).optional(),
    forceOcr: z.boolean().optional(),
    tags: z.array(nonEmptyString),
    tagColor: nonEmptyString.optional(),
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;

export const sidecarConfigSchema = z
  .object({
    papra: papraConfigSchema,
    defaultTagColor: z.string().optional(),
    rules: z.array(ruleSchema),
  })
  .strict();

export type SidecarConfig = z.infer<typeof sidecarConfigSchema>;