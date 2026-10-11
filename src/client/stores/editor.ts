import { drawingSchema, type DrawingInput } from "../../shared/drawing.js";
import { create } from "zustand";
import { z } from "zod";
import {
  assetSchema,
  sceneSchema,
  objectSchema,
  type Asset,
  type ObjectPatch,
  type Scene,
  type SceneObject,
  type ScenePatch,
} from "../../shared/contracts.js";
import {
  contentInputSchema,
  sceneContentSchema,
  type ContentInput,
  type ContentPatch,
} from "../../shared/content.js";
import { api, json, mediaUrl } from "../api.js";

type SceneSummary = Pick<Scene, "id" | "name" | "backgroundAssetId">;
interface EditorState {
  addDrawing: (sceneId: string, input: DrawingInput) => Promise<boolean>;
  eraseDrawing: (sceneId: string, id: string) => Promise<boolean>;
  scenes: SceneSummary[];
  assets: Asset[];
  scene: Scene | null;
  activeId: string | null;
  selectedId: string | null;
  selectedContentId: string | null;
  selectContent: (id: string | null) => void;
  addContent: (input: ContentInput) => Promise<boolean>;
  copyContent: (sourceId: string, id: string) => Promise<boolean>;
  patchContent: (id: string, patch: ContentPatch) => Promise<boolean>;
  deleteContent: (id: string) => Promise<boolean>;
  error: string | null;
  pending: number;
  loading: boolean;
  saveFailed: boolean;
  setError: (error: string | null) => void;
  initialize: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  selectScene: (id: string) => Promise<void>;
  selectObject: (id: string | null) => void;
  createScene: (name: string) => Promise<void>;
  deleteScene: () => Promise<void>;
  updateScene: (patch: ScenePatch) => Promise<boolean>;
  present: (id: string | null) => Promise<void>;
  addObject: (asset: Asset) => Promise<void>;
  patchObject: (id: string, patch: ObjectPatch) => void;
  deleteObject: (id: string) => Promise<void>;
  importImages: (files: File[], category: Asset["category"]) => Promise<void>;
  scan: () => Promise<void>;
  deleteAsset: (id: string) => Promise<boolean>;
}
let queue = Promise.resolve();
let selectionRequest = 0;
export const useEditor = create<EditorState>((set, get) => {
  const writes = new Map<
    string,
    {
      sceneId: string;
      id: string;
      kind: "objects" | "content";
      patch: ObjectPatch | ContentPatch;
      done: ((saved: boolean) => void)[];
    }
  >();
  const failedScenes = new Set<string>();
  let writing = false;
  async function flushObjects() {
    writing = true;
    try {
      while (writes.size || failedScenes.size) {
        while (writes.size) {
          const [key, write] = writes.entries().next().value!;
          writes.delete(key);
          try {
            const path = `/api/admin/scenes/${write.sceneId}/${write.kind}/${write.id}`;
            if (write.kind === "objects")
              await api(path, json("PATCH", write.patch), objectSchema);
            else
              await api(path, json("PATCH", write.patch), sceneContentSchema);
            write.done.forEach((resolve) => resolve(true));
          } catch (error) {
            write.done.forEach((resolve) => resolve(false));
            failedScenes.add(write.sceneId);
            set({
              saveFailed: true,
              error: `Changes could not be saved. ${error instanceof Error ? error.message : "Check connection."}`,
            });
          } finally {
            set((s) => ({ pending: s.pending - 1 }));
          }
        }
        for (const sceneId of failedScenes) {
          try {
            const saved = await api(
              `/api/admin/scenes/${sceneId}`,
              {},
              sceneSchema,
            );
            // A new gesture may have arrived during recovery. Drain it before reconciling.
            if ([...writes.values()].some((w) => w.sceneId === sceneId))
              continue;
            if (get().scene?.id === sceneId)
              set({ scene: saved, saveFailed: false });
          } catch {
            /* Keep the independent unsaved indicator until a successful reload. */
          }
          failedScenes.delete(sceneId);
        }
      }
    } finally {
      writing = false;
    }
  }
  async function tracked<T>(work: () => Promise<T>): Promise<T | undefined> {
    set((s) => ({ pending: s.pending + 1 }));
    try {
      return await work();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Request failed" });
    } finally {
      set((s) => ({ pending: s.pending - 1 }));
    }
  }
  const loadAssets = async () =>
    set({ assets: await api("/api/admin/assets", {}, z.array(assetSchema)) });
  const loadScenes = async () =>
    set({
      scenes: await api(
        "/api/admin/scenes",
        {},
        z.array(
          sceneSchema.pick({ id: true, name: true, backgroundAssetId: true }),
        ),
      ),
    });
  return {
    addDrawing: async (sceneId, input) => {
      return (
        (await tracked(async () => {
          const drawing = await api(
            `/api/admin/scenes/${sceneId}/drawings`,
            json("POST", input),
            drawingSchema,
          );
          if (get().scene?.id === sceneId)
            set((s) => ({
              scene: s.scene && {
                ...s.scene,
                drawings: [...s.scene.drawings, drawing],
              },
            }));
          return true;
        })) === true
      );
    },
    eraseDrawing: async (sceneId, id) => {
      return (
        (await tracked(async () => {
          await api(
            `/api/admin/scenes/${sceneId}/drawings/${id}`,
            json("DELETE"),
          );
          if (get().scene?.id === sceneId)
            set((s) => ({
              scene: s.scene && {
                ...s.scene,
                drawings: s.scene.drawings.filter((d) => d.id !== id),
              },
            }));
          return true;
        })) === true
      );
    },
    scenes: [],
    assets: [],
    scene: null,
    activeId: null,
    selectedId: null,
    selectedContentId: null,
    error: null,
    pending: 0,
    loading: false,
    saveFailed: false,
    setError: (error) => set({ error }),
    refreshAssets: async () => {
      await tracked(loadAssets);
    },
    initialize: async () => {
      await tracked(async () => {
        const [, , live] = await Promise.all([
          loadScenes(),
          loadAssets(),
          api(
            "/api/admin/presentation",
            {},
            z.object({ sceneId: z.string().nullable() }),
          ),
        ]);
        set({ activeId: live.sceneId });
        if (live.sceneId) await get().selectScene(live.sceneId);
      });
    },
    selectScene: async (id) => {
      const request = ++selectionRequest;
      set({ loading: true, selectedId: null, selectedContentId: null });
      await tracked(async () => {
        await queue;
        const scene = await api(`/api/admin/scenes/${id}`, {}, sceneSchema);
        if (request === selectionRequest) set({ scene, saveFailed: false });
      });
      if (request === selectionRequest) set({ loading: false });
    },
    selectObject: (selectedId) => set({ selectedId, selectedContentId: null }),
    selectContent: (selectedContentId) =>
      set({ selectedContentId, selectedId: null }),
    createScene: async (name) => {
      await tracked(async () => {
        const scene = await api(
          "/api/admin/scenes",
          json("POST", { name }),
          sceneSchema,
        );
        set({ scene, selectedId: null, selectedContentId: null });
        await loadScenes();
      });
    },
    deleteScene: async () => {
      await tracked(async () => {
        await queue;
        const scene = get().scene;
        if (!scene) return;
        await api(`/api/admin/scenes/${scene.id}`, json("DELETE"));
        set({
          scene: null,
          selectedId: null,
          selectedContentId: null,
          activeId: get().activeId === scene.id ? null : get().activeId,
        });
        await loadScenes();
      });
    },
    updateScene: async (patch) => {
      const scene = get().scene;
      if (!scene) return false;
      return (
        (await tracked(async () => {
          await queue;
          const result = await api(
            `/api/admin/scenes/${scene.id}`,
            json("PATCH", patch),
            sceneSchema,
          );
          if (get().scene?.id === scene.id)
            set((s) => ({
              scene: s.scene && {
                ...s.scene,
                ...(patch.name !== undefined ? { name: result.name } : {}),
                ...(patch.gridEnabled !== undefined
                  ? { gridEnabled: result.gridEnabled }
                  : {}),
                ...(patch.gridSize !== undefined
                  ? { gridSize: result.gridSize }
                  : {}),
                ...(patch.gridColor !== undefined
                  ? { gridColor: result.gridColor }
                  : {}),
                ...(patch.backgroundAssetId !== undefined
                  ? { backgroundAssetId: result.backgroundAssetId }
                  : {}),
              },
            }));
          await loadScenes();
          return true;
        })) ?? false
      );
    },
    present: async (id) => {
      await tracked(async () => {
        if (id) await queue;
        await api("/api/admin/presentation", json("PUT", { sceneId: id }));
        set({ activeId: id });
      });
    },
    addObject: async (asset) => {
      await tracked(async () => {
        const scene = get().scene;
        if (!scene) return;
        const image = new Image();
        image.src = mediaUrl(asset.id);
        await image.decode();
        const fit = Math.min(
          320 / image.naturalWidth,
          400 / image.naturalHeight,
          1,
        );
        const object = await api(
          `/api/admin/scenes/${scene.id}/objects`,
          json("POST", {
            assetId: asset.id,
            width: image.naturalWidth * fit,
            height: image.naturalHeight * fit,
          }),
          objectSchema,
        );
        if (get().scene?.id === scene.id)
          set((s) => ({
            scene: s.scene && {
              ...s.scene,
              objects: [...s.scene.objects, object],
            },
            selectedId: object.id,
            selectedContentId: null,
          }));
      });
    },
    patchObject: (id, patch) => {
      const sceneId = get().scene?.id;
      if (!sceneId) return;
      const key = `${sceneId}/objects/${id}`;
      const waiting = writes.get(key);
      writes.set(key, {
        sceneId,
        id,
        kind: "objects",
        patch: { ...waiting?.patch, ...patch },
        done: [],
      });
      set((s) => ({
        scene: s.scene && {
          ...s.scene,
          objects: s.scene.objects.map((o) =>
            o.id === id ? { ...o, ...patch } : o,
          ),
        },
        pending: s.pending + (waiting ? 0 : 1),
      }));
      // At most one in-flight and one pending patch per object; the final gesture wins.
      if (!writing) queue = flushObjects();
    },
    deleteObject: async (id) => {
      await tracked(async () => {
        await queue;
        const scene = get().scene;
        if (!scene) return;
        await api(
          `/api/admin/scenes/${scene.id}/objects/${id}`,
          json("DELETE"),
        );
        set((s) => ({
          scene: s.scene && {
            ...s.scene,
            objects: s.scene.objects.filter((o) => o.id !== id),
          },
          selectedId: null,
          selectedContentId: null,
        }));
      });
    },
    addContent: async (input) => {
      const sceneId = get().scene?.id;
      if (!sceneId) return false;
      const result = await tracked(async () => {
        const item = await api(
          `/api/admin/scenes/${sceneId}/content`,
          json("POST", input),
          sceneContentSchema,
        );
        if (get().scene?.id === sceneId)
          set((s) => ({
            scene: s.scene && {
              ...s.scene,
              content: [...s.scene.content, item],
            },
            selectedContentId: item.id,
            selectedId: null,
          }));
        return true;
      });
      return result === true;
    },
    copyContent: async (sourceId, id) => {
      const targetId = get().scene?.id;
      if (!targetId) return false;
      const result = await tracked(async () => {
        await queue;
        const source = await api(
          `/api/admin/scenes/${sourceId}`,
          {},
          sceneSchema,
        );
        const item = source.content.find((c) => c.id === id);
        if (!item)
          throw new Error(
            "This prepared content was removed. Choose another entry.",
          );
        if (get().scene?.id !== targetId) return false;
        const { id: _id, sceneId: _sceneId, ...input } = item;
        return get().addContent(
          contentInputSchema.parse({ ...input, visible: false }),
        );
      });
      return result === true;
    },
    patchContent: (id, patch) => {
      const scene = get().scene;
      const item = scene?.content.find((c) => c.id === id);
      if (!scene || !item) return Promise.resolve(false);
      const parsed = sceneContentSchema.safeParse({ ...item, ...patch });
      if (!parsed.success) {
        set({ error: parsed.error.issues.map((i) => i.message).join("; ") });
        return Promise.resolve(false);
      }
      const key = `${scene.id}/content/${id}`;
      const waiting = writes.get(key);
      const promise = new Promise<boolean>((resolve) => {
        writes.set(key, {
          sceneId: scene.id,
          id,
          kind: "content",
          patch: { ...waiting?.patch, ...patch },
          done: [...(waiting?.done ?? []), resolve],
        });
      });
      set((s) => ({
        scene: s.scene && {
          ...s.scene,
          content: s.scene.content.map((c) => (c.id === id ? parsed.data : c)),
        },
        pending: s.pending + (waiting ? 0 : 1),
      }));
      if (!writing) queue = flushObjects();
      return promise;
    },
    deleteContent: async (id) => {
      const sceneId = get().scene?.id;
      if (!sceneId) return false;
      const result = await tracked(async () => {
        await queue;
        await api(`/api/admin/scenes/${sceneId}/content/${id}`, json("DELETE"));
        if (get().scene?.id === sceneId)
          set((s) => ({
            scene: s.scene && {
              ...s.scene,
              content: s.scene.content.filter((c) => c.id !== id),
            },
            selectedContentId:
              s.selectedContentId === id ? null : s.selectedContentId,
          }));
        return true;
      });
      return result === true;
    },
    deleteAsset: async (id) => {
      set({ error: null });
      const result = await tracked(async () => {
        await queue;
        await api(`/api/admin/assets/${id}`, json("DELETE"));
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
          scenes: s.scenes.map((scene) =>
            scene.backgroundAssetId === id
              ? { ...scene, backgroundAssetId: null }
              : scene,
          ),
          scene: s.scene && {
            ...s.scene,
            backgroundAssetId:
              s.scene.backgroundAssetId === id
                ? null
                : s.scene.backgroundAssetId,
            objects: s.scene.objects.filter((o) => o.assetId !== id),
          },
          selectedId: s.scene?.objects.some(
            (o) => o.id === s.selectedId && o.assetId === id,
          )
            ? null
            : s.selectedId,
        }));
        return true;
      });
      return result === true;
    },
    importImages: async (files, category) => {
      await tracked(async () => {
        try {
          for (const file of files) {
            const data = new FormData();
            data.append("file", file);
            await api(`/api/admin/assets?category=${category}`, {
              method: "POST",
              body: data,
            });
          }
        } finally {
          await loadAssets();
        }
      });
    },
    scan: async () => {
      await tracked(async () => {
        await api("/api/admin/assets/scan", json("POST"));
        await loadAssets();
      });
    },
  };
});
