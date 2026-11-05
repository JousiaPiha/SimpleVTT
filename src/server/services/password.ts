import { randomBytes, scryptSync } from "node:crypto";
import { z } from "zod";
import { loginSchema } from "../../shared/contracts.js";

export const passwordHashSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("scrypt"),
    salt: z.string().regex(/^[0-9a-f]{32}$/),
    hash: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict();
export type PasswordHash = z.infer<typeof passwordHashSchema>;

export function resolvePasswordHash(
  password: string | PasswordHash,
): PasswordHash {
  if (typeof password !== "string") return passwordHashSchema.parse(password);
  loginSchema.parse({ password });
  const salt = randomBytes(16);
  return {
    version: 1,
    algorithm: "scrypt",
    salt: salt.toString("hex"),
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
}
