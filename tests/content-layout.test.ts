import { describe, expect, it } from "vitest";
import { contentDefaults, type PublicContent } from "../src/shared/content.js";
import { layoutContent } from "../src/client/components/contentLayout.js";

function loot(count: number, page = 0): PublicContent {
  return {
    ...contentDefaults("loot"),
    id: "loot",
    type: "loot",
    title: "Finds",
    description: "From the chest",
    items: Array.from({ length: count }, (_, i) => ({
      name: `Item ${i + 1}`,
      quantity: i + 1,
      description: "Useful",
    })),
    page,
  };
}

describe("bounded presentation content", () => {
  it("shows the requested four-item page and its quantities without earlier items", () => {
    const blocks = layoutContent(loot(9, 1));
    const text = blocks.map((block) => block.text).join("\n");
    expect(text).toContain("5 × Item 5");
    expect(text).toContain("8 × Item 8");
    expect(text).toContain("2 / 3");
    expect(text).not.toContain("Item 1");
    expect(text).not.toContain("Item 9");
  });

  it("clamps a stale page after items are removed and handles an empty list", () => {
    expect(layoutContent(loot(5, 24)).map((block) => block.text)).toContain(
      "5 × Item 5",
    );
    expect(layoutContent(loot(0, 24)).map((block) => block.text)).toContain(
      "No items",
    );
  });

  it("keeps every title, description, item, and counter within the smallest supported panel", () => {
    const content = { ...loot(9, 1), width: 160, height: 80, fontSize: 120 };
    for (const block of layoutContent(content)) {
      expect(block.x).toBeGreaterThanOrEqual(0);
      expect(block.y).toBeGreaterThanOrEqual(0);
      expect(block.width).toBeGreaterThan(0);
      expect(block.height).toBeGreaterThan(0);
      expect(block.x + block.width).toBeLessThanOrEqual(160);
      expect(block.y + block.height).toBeLessThanOrEqual(80);
    }
  });
});
