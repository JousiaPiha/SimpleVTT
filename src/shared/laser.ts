import { z } from "zod";
import { CANVAS, presentationEventSchema } from "./contracts.js";

export const LASER_TIMEOUT_MS = 1500;
export const LASER_INTERVAL_MS = 40;
export const laserPointerSchema = z
  .object({
    sceneId: z.string().min(1).max(100),
    x: z.number().finite().min(0).max(CANVAS.width),
    y: z.number().finite().min(0).max(CANVAS.height),
  })
  .strict();
export type LaserPointer = z.infer<typeof laserPointerSchema>;
export const laserCommandSchema = z
  .object({
    type: z.literal("laser.update"),
    pointer: laserPointerSchema.nullable(),
  })
  .strict();
export const laserEventSchema = z
  .object({
    type: z.literal("laser.updated"),
    pointer: laserPointerSchema.nullable(),
  })
  .strict();
export type LaserEvent = z.infer<typeof laserEventSchema>;
export const playerEventSchema = z.union([
  presentationEventSchema,
  laserEventSchema,
]);
