import { describe, expect, it } from "vitest";
import {
  publicScene,
  diffPresentation,
} from "../src/server/services/presentation.js";
import {
  applyPresentation,
  presentationEventSchema,
  objectPatchSchema,
  type Scene,
} from "../src/shared/contracts.js";

const scene: Scene = {
  gridEnabled: false,
  drawings: [],
  gridSize: 80,
  gridColor: "#ffffff",
  id: "scene-1",
  name: "GM secret",
  backgroundAssetId: "background",
  content: [],
  objects: [
    {
      id: "shown",
      sceneId: "scene-1",
      assetId: "hero",
      name: "GM private label",
      x: 100,
      y: 200,
      scale: 1,
      rotation: 0,
      zIndex: 1,
      visible: true,
      width: 200,
      height: 300,
    },
    {
      id: "secret",
      sceneId: "scene-1",
      assetId: "secret-image",
      name: "Ambush",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      zIndex: 2,
      visible: false,
      width: 200,
      height: 300,
    },
  ],
};

describe("public presentation", () => {
  it("omits hidden objects, asset references, and GM labels entirely", () => {
    const result = publicScene(scene);
    expect(result?.objects.map((o) => o.id)).toEqual(["shown"]);
    expect(JSON.stringify(result)).not.toMatch(/secret|Ambush|GM/);
    expect(result?.backgroundAssetId).toBe("background");
  });
  it("sends only removals when hiding and upserts when revealing", () => {
    const before = publicScene(scene);
    const after = publicScene({
      ...scene,
      objects: scene.objects.map((o) => ({ ...o, visible: !o.visible })),
    });
    const diff = diffPresentation(before, after);
    expect(diff).toMatchObject({
      type: "presentation.patch",
      removed: ["shown"],
      upserts: [{ id: "secret", assetId: "secret-image" }],
    });
    expect(diff && JSON.stringify(diff)).not.toContain("Ambush");
  });
  it("does not broadcast invisible edits", () => {
    expect(
      diffPresentation(
        publicScene(scene),
        publicScene({
          ...scene,
          name: "changed",
          objects: scene.objects.map((o) => (o.visible ? o : { ...o, x: 900 })),
        }),
      ),
    ).toBeNull();
  });
  it("validates finite transforms and prohibits altering identity", () => {
    expect(objectPatchSchema.safeParse({ x: NaN }).success).toBe(false);
    expect(objectPatchSchema.safeParse({ scale: 0 }).success).toBe(false);
    expect(objectPatchSchema.safeParse({ id: "stolen" }).success).toBe(false);
    expect(objectPatchSchema.parse({ x: 1920, rotation: -90 })).toEqual({
      x: 1920,
      rotation: -90,
    });
  });
});

it("synchronizes grid-only edits with a patch, including turning it off", () => {
  const before = publicScene(scene)!;
  const after = publicScene({
    ...scene,
    gridEnabled: true,
    gridSize: 120,
    gridColor: "#ff0000",
  })!;
  const event = presentationEventSchema.parse(diffPresentation(before, after));
  expect(event).toMatchObject({
    type: "presentation.patch",
    upserts: [],
    removed: [],
    gridEnabled: true,
    gridSize: 120,
  });
  expect(applyPresentation(before, event)).toEqual(after);
  const off = publicScene({ ...scene, gridSize: 120, gridColor: "#ff0000" })!;
  expect(
    applyPresentation(
      after,
      presentationEventSchema.parse(diffPresentation(after, off)),
    ),
  ).toEqual(off);
});
