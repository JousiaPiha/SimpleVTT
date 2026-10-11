import { z } from "zod";

const base = {
  id: z.string(),
  sceneId: z.string(),
  name: z.string().trim().min(1).max(120),
  visible: z.boolean(),
  x: z.number().finite().min(-19200).max(19200),
  y: z.number().finite().min(-10800).max(10800),
  width: z.number().finite().min(160).max(1920),
  height: z.number().finite().min(80).max(1080),
  fontSize: z.number().finite().min(16).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  align: z.enum(["left", "center", "right"]),
  panel: z.boolean(),
  zIndex: z.number().int().min(-10000).max(10000),
};
export const lootItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(1).max(999999),
    description: z.string().max(300),
  })
  .strict();
export const textContentSchema = z
  .object({ ...base, type: z.literal("text"), text: z.string().max(4000) })
  .strict();
export const lootContentSchema = z
  .object({
    ...base,
    type: z.literal("loot"),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(600),
    items: z.array(lootItemSchema).max(100),
    page: z.number().int().min(0).max(24),
  })
  .strict();
export const sceneContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  lootContentSchema,
]);
export type SceneContent = z.infer<typeof sceneContentSchema>;
export const contentInputSchema = z.discriminatedUnion("type", [
  textContentSchema.omit({ id: true, sceneId: true }),
  lootContentSchema.omit({ id: true, sceneId: true }),
]);
export type ContentInput = z.infer<typeof contentInputSchema>;
// The merged discriminated item is validated again by the server before persistence.
export const contentPatchSchema = z
  .object({
    ...base,
    text: z.string().max(4000),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(600),
    items: z.array(lootItemSchema).max(100),
    page: z.number().int().min(0).max(24),
  })
  .omit({ id: true, sceneId: true })
  .partial()
  .strict();
export type ContentPatch = z.infer<typeof contentPatchSchema>;
export const publicContentSchema = z.discriminatedUnion("type", [
  textContentSchema.omit({ sceneId: true, name: true, visible: true }),
  lootContentSchema.omit({ sceneId: true, name: true, visible: true }),
]);
export type PublicContent = z.infer<typeof publicContentSchema>;
export const LOOT_PAGE_SIZE = 4;
export function contentDefaults(type: "text" | "loot"): ContentInput {
  const common = {
    name: type === "text" ? "New text" : "New loot",
    visible: false,
    x: 100,
    y: 100,
    width: 800,
    height: type === "text" ? 260 : 820,
    fontSize: type === "text" ? 48 : 28,
    color: "#ffffff",
    align: "left" as const,
    panel: true,
    zIndex: 100,
  };
  return type === "text"
    ? { ...common, type, text: "Your text here" }
    : {
        ...common,
        type,
        title: "Discovered loot",
        description: "",
        items: [],
        page: 0,
      };
}
