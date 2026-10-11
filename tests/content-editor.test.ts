import { afterEach, expect, test, vi } from "vitest";
import { useEditor } from "../src/client/stores/editor.js";
import { contentDefaults } from "../src/shared/content.js";
const item = { ...contentDefaults("text"), id: "note", sceneId: "scene" };
const scene = {
  id: "scene",
  name: "Scene",
  gridEnabled: false,
  drawings: [],
  gridSize: 80,
  gridColor: "#ffffff",
  backgroundAssetId: null,
  objects: [],
  content: [item],
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
test("content movement coalesces and hiding only changes saved visibility", async () => {
  useEditor.setState({
    scene: structuredClone(scene),
    pending: 0,
    error: null,
    saveFailed: false,
  });
  let unblock!: () => void;
  let calls = 0;
  let saved = structuredClone(item);
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
    calls++;
    if (calls === 1)
      await new Promise<void>((resolve) => {
        unblock = resolve;
      });
    saved = { ...saved, ...JSON.parse(String(init.body)) };
    return response(saved);
  });
  const first = useEditor.getState().patchContent("note", { x: 10 });
  await vi.waitFor(() => expect(unblock).toBeTypeOf("function"));
  for (let x = 20; x < 200; x++)
    void useEditor.getState().patchContent("note", { x });
  const final = useEditor.getState().patchContent("note", { visible: false });
  unblock();
  expect(await first).toBe(true);
  expect(await final).toBe(true);
  expect(saved).toMatchObject({
    x: 199,
    visible: false,
    text: "Your text here",
  });
  expect(calls).toBeLessThanOrEqual(3);
});
test("failed content saves return failure and recover server state", async () => {
  useEditor.setState({
    scene: structuredClone(scene),
    pending: 0,
    error: null,
    saveFailed: false,
  });
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) =>
    init.method === "PATCH"
      ? response({ error: "Failed" }, 503)
      : response(scene),
  );
  expect(
    await useEditor.getState().patchContent("note", { text: "Draft secret" }),
  ).toBe(false);
  await vi.waitFor(() =>
    expect(useEditor.getState().scene?.content[0]).toEqual(item),
  );
  expect(useEditor.getState().error).toContain("could not be saved");
});
test("a late content creation cannot replace another scene or selection", async () => {
  useEditor.setState({
    scene: structuredClone(scene),
    pending: 0,
    error: null,
    selectedContentId: null,
  });
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const adding = useEditor.getState().addContent(contentDefaults("text"));
  useEditor.setState({ scene: { ...scene, id: "elsewhere", content: [] } });
  finish(response(item));
  await adding;
  expect(useEditor.getState().scene?.id).toBe("elsewhere");
  expect(useEditor.getState().scene?.content).toEqual([]);
  expect(useEditor.getState().selectedContentId).toBe(null);
});
test("reuse fetches the latest saved source and creates a hidden independent copy", async () => {
  useEditor.setState({
    scene: { ...scene, id: "target", content: [] },
    pending: 0,
    error: null,
  });
  const latest = { ...item, text: "Latest revision", visible: true };
  let posted: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
    if (init.method === "POST") {
      posted = JSON.parse(String(init.body));
      return response({ ...posted, id: "copy", sceneId: "target" });
    }
    return response({ ...scene, content: [latest] });
  });
  expect(await useEditor.getState().copyContent("scene", "note")).toBe(true);
  expect(posted).toMatchObject({ text: "Latest revision", visible: false });
  expect(posted).not.toHaveProperty("id");
  expect(useEditor.getState().scene?.content[0]).toMatchObject({
    id: "copy",
    sceneId: "target",
  });
});
test("reuse rejects removed entries and cannot copy into a scene selected during loading", async () => {
  useEditor.setState({
    scene: structuredClone(scene),
    pending: 0,
    error: null,
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({ ...scene, content: [] }));
  vi.stubGlobal("fetch", fetch);
  expect(await useEditor.getState().copyContent("scene", "note")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  let finish!: (r: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const copying = useEditor.getState().copyContent("scene", "note");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  useEditor.setState({ scene: { ...scene, id: "other", content: [] } });
  finish(response(scene));
  expect(await copying).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});
