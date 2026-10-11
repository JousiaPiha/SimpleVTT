import { z } from "zod";

export const drawingInputSchema = z
  .object({
    type: z.enum(["freehand", "oval", "rectangle"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: z.number().int().min(1).max(24),
    points: z.array(z.number().finite().min(0).max(1920)).min(4).max(4096),
  })
  .strict()
  .superRefine((drawing, ctx) => {
    if (
      drawing.points.length % 2 ||
      (drawing.type !== "freehand" && drawing.points.length !== 4)
    )
      ctx.addIssue({ code: "custom", message: "Invalid drawing points" });
    if (drawing.points.some((value, index) => index % 2 === 1 && value > 1080))
      ctx.addIssue({ code: "custom", message: "Drawing is outside the scene" });
  });
export type DrawingInput = z.infer<typeof drawingInputSchema>;
export const drawingSchema = drawingInputSchema.safeExtend({ id: z.string() });
export type Drawing = z.infer<typeof drawingSchema>;
export type DrawingTool = DrawingInput["type"] | "eraser";
