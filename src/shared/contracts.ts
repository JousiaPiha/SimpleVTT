import { z } from "zod";
import { drawingSchema } from "./drawing.js";
import { sceneContentSchema, publicContentSchema } from "./content.js";

export const CANVAS = { width: 1920, height: 1080 } as const;
export const categorySchema = z.enum([
  "background",
  "sprite",
  "image",
  "music",
  "ambience",
  "effect",
]);
export const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: categorySchema,
  mimeType: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;
const transform = {
  x: z.number().finite().min(-19200).max(19200),
  y: z.number().finite().min(-10800).max(10800),
  scale: z.number().finite().min(0.01).max(20),
  rotation: z.number().finite().min(-3600).max(3600),
  zIndex: z.number().int().min(-10000).max(10000),
};
const name = z.string().trim().min(1).max(120);
export const objectSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  assetId: z.string(),
  name,
  ...transform,
  visible: z.boolean(),
  width: z.number().positive().max(1920),
  height: z.number().positive().max(1920),
});
export type SceneObject = z.infer<typeof objectSchema>;
export const objectCreateSchema = objectSchema
  .pick({ assetId: true, name: true, width: true, height: true })
  .partial({ name: true, width: true, height: true })
  .strict();
export const objectPatchSchema = objectSchema
  .omit({ id: true, sceneId: true, assetId: true })
  .partial()
  .strict();
export type ObjectPatch = z.infer<typeof objectPatchSchema>;
export const gridFields = {
  gridEnabled: z.boolean().default(false),
  gridSize: z.number().int().min(20).max(400).default(80),
  gridColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
};
export const sceneSchema = z.object({
  ...gridFields,
  id: z.string(),
  name,
  backgroundAssetId: z.string().nullable(),
  objects: z.array(objectSchema),
  drawings: z.array(drawingSchema).default([]),
  content: z.array(sceneContentSchema).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;
export const sceneCreateSchema = z.object({ name }).strict();
export const scenePatchSchema = z
  .object({
    gridEnabled: gridFields.gridEnabled.removeDefault().optional(),
    gridSize: gridFields.gridSize.removeDefault().optional(),
    gridColor: gridFields.gridColor.removeDefault().optional(),
    name: name.optional(),
    backgroundAssetId: z.string().nullable().optional(),
  })
  .partial()
  .strict();
export type ScenePatch = z.infer<typeof scenePatchSchema>;
export const presentationInputSchema = z
  .object({ sceneId: z.string().nullable() })
  .strict();
export const loginSchema = z
  .object({ password: z.string().min(1).max(1024) })
  .strict();
export const publicObjectSchema = objectSchema.omit({
  name: true,
  sceneId: true,
  visible: true,
});
export type PublicObject = z.infer<typeof publicObjectSchema>;
export const publicSceneSchema = z.object({
  ...gridFields,
  id: z.string(),
  backgroundAssetId: z.string().nullable(),
  objects: z.array(publicObjectSchema),
  drawings: z.array(drawingSchema).default([]),
  content: z.array(publicContentSchema).default([]),
});
export type PublicScene = z.infer<typeof publicSceneSchema>;
export const presentationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("presentation.snapshot"),
    scene: publicSceneSchema.nullable(),
  }),
  z.object({
    type: z.literal("presentation.patch"),
    sceneId: z.string(),
    gridEnabled: gridFields.gridEnabled.removeDefault().optional(),
    gridSize: gridFields.gridSize.removeDefault().optional(),
    gridColor: gridFields.gridColor.removeDefault().optional(),
    backgroundAssetId: z.string().nullable(),
    upserts: z.array(publicObjectSchema),
    removed: z.array(z.string()),
    contentUpserts: z.array(publicContentSchema).default([]),
    contentRemoved: z.array(z.string()).default([]),
    drawingUpserts: z.array(drawingSchema).default([]),
    drawingRemoved: z.array(z.string()).default([]),
  }),
]);
export type PresentationEvent = z.infer<typeof presentationEventSchema>;

export function applyPresentation(
  current: PublicScene | null,
  event: PresentationEvent,
): PublicScene | null {
  if (event.type === "presentation.snapshot") return event.scene;
  if (!current || current.id !== event.sceneId) return current;
  const objects = new Map(current.objects.map((o) => [o.id, o]));
  event.removed.forEach((id) => objects.delete(id));
  event.upserts.forEach((o) => objects.set(o.id, o));
  const content = new Map(
    (current.content ?? []).map((item) => [item.id, item]),
  );
  event.contentRemoved.forEach((id) => content.delete(id));
  event.contentUpserts.forEach((item) => content.set(item.id, item));
  const drawings = new Map((current.drawings ?? []).map((d) => [d.id, d]));
  event.drawingRemoved?.forEach((id) => drawings.delete(id));
  event.drawingUpserts?.forEach((d) => drawings.set(d.id, d));
  return {
    ...current,
    drawings: [...drawings.values()],
    backgroundAssetId: event.backgroundAssetId,
    gridEnabled: event.gridEnabled ?? current.gridEnabled,
    gridSize: event.gridSize ?? current.gridSize,
    gridColor: event.gridColor ?? current.gridColor,
    objects: [...objects.values()],
    content: [...content.values()],
  };
}
