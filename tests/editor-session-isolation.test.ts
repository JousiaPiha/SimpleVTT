import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  resetEditorForSession,
  useEditor,
} from "../src/client/stores/editor.js";
import { setSessionGeneration } from "../src/client/api.js";
import type { Asset, Scene } from "../src/shared/contracts.js";

const original: Scene = {
  id: "scene",
  name: "Original",
  backgroundAssetId: null,
  gridEnabled: false,
  gridSize: 80,
  gridColor: "#ffffff",
  drawings: [],
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
const asset: Asset = {
  id: "asset",
  name: "Hero",
  category: "sprite",
  mimeType: "image/png",
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function switchSession(changeGeneration = true) {
  resetEditorForSession();
  if (changeGeneration) setSessionGeneration("new-runtime");
  useEditor.setState({
    scene: { ...structuredClone(original), name: "Copied session" },
  });
}
beforeEach(() => {
  resetEditorForSession();
  setSessionGeneration("old-runtime");
  useEditor.setState({ scene: structuredClone(original) });
});
afterEach(() => {
  resetEditorForSession();
  setSessionGeneration(null);
  vi.unstubAllGlobals();
});

test("an image decode started in the old session cannot add an object to a same-ID copy", async () => {
  const decode = deferred<void>();
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 100;
      naturalHeight = 100;
      src = "";
      decode() {
        return decode.promise;
      }
    },
  );
  const fetch = vi.fn(async () => response(original.objects[0]));
  vi.stubGlobal("fetch", fetch);
  const adding = useEditor.getState().addObject(asset);
  expect(useEditor.getState().pending).toBe(1);
  switchSession();
  decode.resolve();
  await adding;
  expect(fetch).not.toHaveBeenCalled();
  expect(useEditor.getState().scene?.objects).toHaveLength(1);
  expect(useEditor.getState()).toMatchObject({ pending: 0, error: null });
});

test.each([
  ["update scene", () => useEditor.getState().updateScene({ name: "Stale" })],
  ["delete scene", () => useEditor.getState().deleteScene()],
  ["delete object", () => useEditor.getState().deleteObject("object")],
  ["delete content", () => useEditor.getState().deleteContent("content")],
  ["delete asset", () => useEditor.getState().deleteAsset("asset")],
  ["present", () => useEditor.getState().present("scene")],
  ["copy content", () => useEditor.getState().copyContent("source", "content")],
  ["select scene", () => useEditor.getState().selectScene("scene")],
] as const)(
  "queued %s cannot issue a request after the editor session resets",
  async (_name, action) => {
    const patch = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => patch.promise)
      .mockImplementation(async () => response(original));
    vi.stubGlobal("fetch", fetch);
    useEditor.getState().patchObject("object", { x: 20 });
    const waiting = action();
    switchSession();
    patch.resolve(response(original.objects[0]));
    await waiting;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useEditor.getState()).toMatchObject({
      pending: 0,
      error: null,
      saveFailed: false,
      loading: false,
    });
    expect(useEditor.getState().scene?.name).toBe("Copied session");
  },
);

test("old initialization results cannot replace current state after reset", async () => {
  const scenes = deferred<Response>();
  const fetch = vi.fn(async (path: string) => {
    if (path === "/api/admin/scenes") return scenes.promise;
    return response(path === "/api/admin/assets" ? [] : { sceneId: null });
  });
  vi.stubGlobal("fetch", fetch);
  const initializing = useEditor.getState().initialize();
  switchSession(false);
  useEditor.setState({
    scenes: [{ id: "new", name: "Current", backgroundAssetId: null }],
    activeId: "new",
  });
  scenes.resolve(response([original]));
  await initializing;
  expect(useEditor.getState().scenes.map((scene) => scene.id)).toEqual(["new"]);
  expect(useEditor.getState()).toMatchObject({
    activeId: "new",
    pending: 0,
    error: null,
  });
});

test("an old failed initialization cannot overwrite current errors or pending counters", async () => {
  const scenes = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/admin/scenes") return scenes.promise;
      return response(path === "/api/admin/assets" ? [] : { sceneId: null });
    }),
  );
  const initializing = useEditor.getState().initialize();
  switchSession(false);
  useEditor.setState({ error: "Current session error", pending: 2 });
  scenes.resolve(response({ error: "Old storage failed" }, 503));
  await initializing;
  expect(useEditor.getState()).toMatchObject({
    pending: 2,
    error: "Current session error",
  });
});

test("an old upload cannot continue its file loop or refresh the new library", async () => {
  const uploading = deferred<Response>();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => uploading.promise)
    .mockResolvedValue(response([]));
  vi.stubGlobal("fetch", fetch);
  const importing = useEditor
    .getState()
    .importImages(
      [new File(["first"], "first.png"), new File(["second"], "second.png")],
      "image",
    );
  switchSession();
  uploading.resolve(response({}));
  await importing;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(useEditor.getState()).toMatchObject({
    assets: [],
    pending: 0,
    error: null,
  });
});

test("an old write completion cannot drain or change ownership of the new write queue", async () => {
  const oldPatch = deferred<Response>();
  const newPatch = deferred<Response>();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => oldPatch.promise)
    .mockImplementationOnce(() => newPatch.promise)
    .mockResolvedValue(response({ ...original.objects[0], x: 2 }));
  vi.stubGlobal("fetch", fetch);
  useEditor.getState().patchObject("object", { x: 99 });
  switchSession(false);
  useEditor.getState().patchObject("object", { x: 1 });
  useEditor.getState().patchObject("object", { x: 2 });
  oldPatch.resolve(response(original.objects[0]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(useEditor.getState().pending).toBe(2);
  newPatch.resolve(response({ ...original.objects[0], x: 1 }));
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(0));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(useEditor.getState().scene?.objects[0].x).toBe(2);
});

test("current-session selection still loads the scene normally", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(original)),
  );
  await useEditor.getState().selectScene("scene");
  expect(useEditor.getState()).toMatchObject({
    scene: original,
    loading: false,
    pending: 0,
    error: null,
  });
});

test("old write-recovery snapshots cannot reconcile a new same-ID scene", async () => {
  const recovery = deferred<Response>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({ error: "Disk unavailable" }, 503))
    .mockImplementationOnce(() => recovery.promise);
  vi.stubGlobal("fetch", fetch);
  useEditor.getState().patchObject("object", { x: 20 });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  switchSession(false);
  recovery.resolve(response(original));
  await vi.waitFor(() => expect(useEditor.getState().pending).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useEditor.getState().scene?.name).toBe("Copied session");
  expect(useEditor.getState()).toMatchObject({
    error: null,
    saveFailed: false,
  });
});
