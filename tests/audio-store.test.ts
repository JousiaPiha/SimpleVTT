import { afterEach, expect, test, vi } from "vitest";
import {
  audioEngine,
  shutdownAudio,
  useAudioStore,
} from "../src/client/features/audio/store.js";

afterEach(() => {
  shutdownAudio();
  vi.unstubAllGlobals();
});

test("flushing an active save waits for newer preferences too", async () => {
  const requests: { body: string; resolve: (response: Response) => void }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) =>
          requests.push({ body: String(init.body), resolve }),
        ),
    ),
  );
  useAudioStore.setState({ ready: true });
  audioEngine.setVolume("master", 0.1);
  useAudioStore.getState().preferencesChanged();
  const saving = useAudioStore.getState().savePreferences();
  audioEngine.setVolume("master", 0.9);
  useAudioStore.getState().preferencesChanged();
  let flushed = false;
  const flush = useAudioStore
    .getState()
    .savePreferences()
    .then((result) => {
      flushed = true;
      return result;
    });
  await Promise.resolve();
  expect(flushed).toBe(false);
  requests[0]!.resolve(new Response(requests[0]!.body));
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(JSON.parse(requests[1]!.body).volumes.master).toBe(0.9);
  expect(flushed).toBe(false);
  requests[1]!.resolve(new Response(requests[1]!.body));
  expect(await flush).toBe(true);
  await saving;
  expect(useAudioStore.getState().settingsDirty).toBe(false);
});

test("failed flush reports failure and retains changes for retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Offline" }), { status: 503 }),
      )
      .mockImplementationOnce((_url: string, init: RequestInit) =>
        Promise.resolve(new Response(String(init.body))),
      ),
  );
  useAudioStore.setState({ ready: true });
  audioEngine.setVolume("master", 0.4);
  useAudioStore.getState().preferencesChanged();
  expect(await useAudioStore.getState().savePreferences()).toBe(false);
  expect(useAudioStore.getState().settingsDirty).toBe(true);
  expect(useAudioStore.getState().settingsError).toContain("Offline");
  expect(await useAudioStore.getState().savePreferences()).toBe(true);
  expect(useAudioStore.getState().settingsDirty).toBe(false);
});

test("forgetting an asset cleans prepared playlists without discarding other tracks", () => {
  useAudioStore.setState({
    ready: true,
    playlists: [
      {
        id: "list",
        name: "Soundtrack",
        trackIds: ["removed", "kept", "removed"],
      },
    ],
    deletedAssetIds: [],
  });
  useAudioStore.getState().forgetAsset("removed");
  expect(useAudioStore.getState().playlists[0]!.trackIds).toEqual(["kept"]);
  expect(useAudioStore.getState().deletedAssetIds).toEqual(["removed"]);
});
