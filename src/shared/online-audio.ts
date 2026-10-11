import { z } from "zod";
import { audioCategorySchema } from "./audio.js";
import { assetSchema } from "./contracts.js";

export const onlineAudioInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(4096)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "Use an HTTP or HTTPS media link without a username or password."),
    category: audioCategorySchema,
    name: z.string().trim().max(120).optional(),
  })
  .strict();
export type OnlineAudioInput = z.infer<typeof onlineAudioInputSchema>;
export const onlineAudioJobSchema = z.object({
  id: z.string(),
  status: z.enum([
    "checking",
    "downloading",
    "converting",
    "saving",
    "complete",
    "failed",
    "cancelled",
  ]),
  category: audioCategorySchema,
  title: z.string(),
  progress: z.number().min(0).max(100).nullable(),
  error: z.string().nullable(),
  asset: assetSchema.nullable(),
});
export type OnlineAudioJob = z.infer<typeof onlineAudioJobSchema>;
export const onlineAudioToolsSchema = z.object({
  ready: z.boolean(),
  missing: z.array(z.string()),
});
export const onlineAudioBusy = (job: OnlineAudioJob | null) =>
  !!job && !["complete", "failed", "cancelled"].includes(job.status);
