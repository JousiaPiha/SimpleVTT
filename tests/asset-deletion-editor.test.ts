import { afterEach, expect, test, vi } from "vitest";
import { useEditor } from "../src/client/stores/editor.js";
import type { Asset, Scene } from "../src/shared/contracts.js";
const asset: Asset = {
  id: "image",
  name: "image.png",
  category: "image",
  mimeType: "image/png",
};
const scene: Scene = {
  gridEnabled: false,
  drawings: [],
  gridSize: 80,
  gridColor: "#ffffff",
  id: "scene",
  name: "Scene",
  backgroundAssetId: "image",
  content: [],
  objects: [
    {
      id: "object",
      sceneId: "scene",
      assetId: "image",
      name: "Sprite",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      scale: 1,
      rotation: 0,
      zIndex: 0,
      visible: true,
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
test("asset deletion removes references without replacing unrelated scene edits", async () => {
  useEditor.setState({
    assets: [asset],
    scene: structuredClone(scene),
    scenes: [scene],
    selectedId: "object",
    pending: 0,
    error: null,
  });
  let finish!: () => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(new Response(null, { status: 204 }));
      }),
  );
  const deleting = useEditor.getState().deleteAsset("image");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  useEditor.setState({ scene: { ...scene, name: "Renamed while waiting" } });
  finish();
  expect(await deleting).toBe(true);
  expect(useEditor.getState().assets).toEqual([]);
  expect(useEditor.getState().scene).toMatchObject({
    name: "Renamed while waiting",
    backgroundAssetId: null,
    objects: [],
  });
  expect(useEditor.getState().scenes[0].backgroundAssetId).toBe(null);
  expect(useEditor.getState().selectedId).toBe(null);
});
test("failed deletion retains the library, scene and selection", async () => {
  useEditor.setState({
    assets: [asset],
    scene: structuredClone(scene),
    selectedId: "object",
    pending: 0,
    error: null,
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "Cannot delete file" }), {
        status: 500,
      }),
  );
  expect(await useEditor.getState().deleteAsset("image")).toBe(false);
  expect(useEditor.getState().assets).toEqual([asset]);
  expect(useEditor.getState().scene).toEqual(scene);
  expect(useEditor.getState().selectedId).toBe("object");
});
