import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openGlobalLibraryStore } from "../src/server/database/global-library.js";

test("global catalog persists audio and soundboard metadata independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtt-global-catalog-"));
  let store: ReturnType<typeof openGlobalLibraryStore> | undefined;
  try {
    store = openGlobalLibraryStore(root);
    store.importAssets([
      { id: "sound", name: "Thunder", category: "effect", mimeType: "audio/wav", relativePath: "sound.wav", digest: "abc" },
    ], { assetId: "sound", group: "Weather", icon: "cloud-lightning", customIconAssetId: null });
    store.close();
    store = openGlobalLibraryStore(root);
    expect(store.listAssets()).toEqual([{ id: "sound", name: "Thunder", category: "effect", mimeType: "audio/wav" }]);
    expect(store.soundboard("sound")?.group).toBe("Weather");
    store.rename("sound", "Storm");
    expect(store.getAsset("sound").name).toBe("Storm");
    store.deleteAsset("sound");
    expect(store.listAssets()).toEqual([]);
    expect(store.soundboard("sound")).toBeNull();
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
