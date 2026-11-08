import { z } from "zod";
import { assetSchema } from "./contracts.js";

export const globalLibrarySchema = z.object({ assets: z.array(assetSchema) });
export const libraryTransferSchema = z.object({ asset: assetSchema, reused: z.boolean() });
export const libraryRenameSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
