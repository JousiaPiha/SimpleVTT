import { expect, test } from "vitest";
import {
  contentDefaults,
  contentInputSchema,
  contentPatchSchema,
} from "../src/shared/content.js";
test("content defaults validate and start hidden", () => {
  for (const type of ["text", "loot"] as const)
    expect(contentInputSchema.parse(contentDefaults(type)).visible).toBe(false);
});
test("content rejects invalid styles, item quantities and oversized inputs", () => {
  expect(contentPatchSchema.safeParse({ color: "url(x)" }).success).toBe(false);
  expect(
    contentPatchSchema.safeParse({
      items: [{ name: "Gold", quantity: -1, description: "" }],
    }).success,
  ).toBe(false);
  expect(contentPatchSchema.safeParse({ text: "x".repeat(4001) }).success).toBe(
    false,
  );
  expect(contentPatchSchema.safeParse({ id: "overwrite" }).success).toBe(false);
  expect(
    contentInputSchema.safeParse({ ...contentDefaults("text"), items: [] })
      .success,
  ).toBe(false);
});
