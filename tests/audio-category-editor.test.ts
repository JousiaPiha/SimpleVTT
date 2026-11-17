import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetEditorForSession, useEditor } from "../src/client/stores/editor.js";
import { setSessionGeneration } from "../src/client/api.js";
import type { Asset } from "../src/shared/contracts.js";

const track: Asset = { id: "track", name: "Storm", category: "music", mimeType: "audio/wav" };
beforeEach(() => {
  resetEditorForSession();
  setSessionGeneration("original");
  useEditor.setState({ assets: [track] });
});
afterEach(() => {
  resetEditorForSession();
  setSessionGeneration(null);
  vi.unstubAllGlobals();
});

it("keeps the saved category until the server accepts an update and exposes failures", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const changing = useEditor.getState().changeAudioCategory(track.id, "effect");
  expect(useEditor.getState().assets).toEqual([track]);
  expect(useEditor.getState().pending).toBe(1);
  finish(new Response(JSON.stringify({ ...track, category: "effect" })));
  expect(await changing).toBe(true);
  expect(useEditor.getState().assets[0].category).toBe("effect");
  const failing = useEditor.getState().changeAudioCategory(track.id, "ambience");
  finish(new Response(JSON.stringify({ error: "Storage unavailable" }), { status: 503 }));
  expect(await failing).toBe(false);
  expect(useEditor.getState()).toMatchObject({ pending: 0, error: "Storage unavailable", assets: [{ ...track, category: "effect" }] });
});

it("discards an old category response after switching to a same-ID session copy", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const changing = useEditor.getState().changeAudioCategory(track.id, "effect");
  resetEditorForSession();
  setSessionGeneration("new-session");
  useEditor.setState({ assets: [track] });
  finish(new Response(JSON.stringify({ ...track, category: "effect" })));
  expect(await changing).toBe(false);
  expect(useEditor.getState()).toMatchObject({ assets: [track], pending: 0, error: null });
});
