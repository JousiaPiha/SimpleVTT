import { z } from "zod";

export const sessionActionSchema = z.enum([
  "save-as",
  "open",
  "close",
  "clear",
  "retry",
]);
export type SessionAction = z.infer<typeof sessionActionSchema>;
export const sessionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  isDefault: z.boolean(),
  externalMedia: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export const sessionOperationSchema = z.object({
  id: z.string(),
  action: sessionActionSchema,
  status: z.enum(["running", "complete", "failed"]),
  message: z.string(),
  progress: z.number().min(0).max(100).nullable(),
  error: z.string().nullable(),
});
export const sessionStatusSchema = z.object({
  generation: z.string(),
  active: sessionInfoSchema.nullable(),
  error: z.string().nullable(),
  busy: z.boolean(),
  operation: sessionOperationSchema.nullable(),
});
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export const sessionRequestSchema = z
  .object({
    action: sessionActionSchema,
    path: z.string().min(1).max(4096).optional(),
    force: z.boolean().optional(),
  })
  .strict();
export const folderListingSchema = z.object({
  path: z.string().nullable(),
  parent: z.string().nullable(),
  folders: z.array(z.object({ name: z.string(), path: z.string() })),
  locations: z.array(z.object({ name: z.string(), path: z.string() })),
  warning: z.string().nullable(),
  empty: z.boolean(),
});
export type FolderListing = z.infer<typeof folderListingSchema>;
