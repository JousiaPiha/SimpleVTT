import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditor } from "../src/client/stores/editor.js";
import type { Scene } from "../src/shared/contracts.js";
const original: Scene = {
  gridEnabled: false,
  drawings: [],
  gridSize: 80,
  gridColor: "#ffffff",
  id: "scene",
  name: "Scene",
  backgroundAssetId: null,
  content: [],
  objects: [
    {
      id: "object",
      sceneId: "scene",
      assetId: "asset",
      name: "Hero",
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
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  useEditor.setState({
    scene: structuredClone(original),
    pending: 0,
    error: null,
    saveFailed: false,
  });
});
afterEach(() => vi.unstubAllGlobals());

it("reconciles a failed hide with saved visibility even after dismissing feedback", async () => {
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) =>
    init.method === "PATCH"
      ? response({ error: "Save failed" }, 503)
      : response(original),
  );
  useEditor.getState().patchObject("object", { visible: false });
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(0));
  await vi.waitFor(() =>
    expect(useEditor.getState().scene?.objects[0].visible).toBe(true),
  );
  useEditor.getState().setError(null);
  expect(useEditor.getState().scene?.objects[0].visible).toBe(true);
});
it("keeps a persistent unsaved indicator when the server cannot be reached to recover", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("Offline");
  });
  useEditor.getState().patchObject("object", { visible: false });
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(0));
  useEditor.getState().setError(null);
  expect(useEditor.getState().saveFailed).toBe(true);
});
it("does not replace newer object edits with a delayed background response", async () => {
  let finishScene!: () => void;
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    if (path === "/api/admin/scenes/scene" && init.method === "PATCH")
      return new Promise<Response>((resolve) => {
        finishScene = () =>
          resolve(response({ ...original, backgroundAssetId: "background" }));
      });
    if (path === "/api/admin/scenes") return response([]);
    return response({ ...original.objects[0], x: 500 });
  });
  const update = useEditor
    .getState()
    .updateScene({ backgroundAssetId: "background" });
  await vi.waitFor(() => expect(finishScene).toBeTypeOf("function"));
  useEditor.getState().patchObject("object", { x: 500 });
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(1));
  finishScene();
  await update;
  expect(useEditor.getState().scene?.objects[0].x).toBe(500);
  expect(useEditor.getState().scene?.backgroundAssetId).toBe("background");
});
it("coalesces obsolete movement requests and carries the final visibility and position", async () => {
  let unblock!: () => void;
  let saved = structuredClone(original.objects[0]);
  let requests = 0;
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
    requests++;
    if (requests === 1)
      await new Promise<void>((resolve) => {
        unblock = resolve;
      });
    saved = { ...saved, ...JSON.parse(String(init.body)) };
    return response(saved);
  });
  useEditor.getState().patchObject("object", { x: 1 });
  await vi.waitFor(() => expect(unblock).toBeTypeOf("function"));
  for (let x = 2; x <= 200; x++)
    useEditor.getState().patchObject("object", { x });
  useEditor.getState().patchObject("object", { visible: false });
  unblock();
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(0));
  expect(saved).toMatchObject({ x: 200, visible: false });
  expect(requests).toBeLessThanOrEqual(3);
});
