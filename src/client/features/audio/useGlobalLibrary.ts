import { useCallback, useEffect, useRef, useState } from "react";
import { assetSchema, type Asset } from "../../../shared/contracts.js";
import { globalLibrarySchema, libraryTransferSchema } from "../../../shared/global-library.js";
import { api, getSessionGeneration, json } from "../../api.js";
import { useEditor } from "../../stores/editor.js";
import { useSessionDraft } from "../sessions/drafts.js";
import { audioEngine } from "./store.js";

export function useGlobalLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const working = useRef(false);
  useSessionDraft("audio library update (wait for it to finish)", !!busy && busy !== "load");

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    working.current = false;
    return () => controller.abort();
  }, []);

  // A transfer can include large audio and custom icon files. Keep one operation at
  // a time, and discard responses after a session transition or component unmount.
  const run = useCallback(async (
    action: string,
    operation: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) => {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || working.current) return false;
    const generation = getSessionGeneration();
    const current = () => !controller.signal.aborted && generation === getSessionGeneration();
    working.current = true;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(action === "load" ? 15_000 : 300_000),
      ]);
      await operation(signal, current);
      return current();
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : "Could not update the global library.");
      return false;
    } finally {
      if (current()) {
        working.current = false;
        setBusy(null);
      }
    }
  }, []);

  const load = useCallback(() => run("load", async (signal, current) => {
    const result = await api("/api/admin/global-library", { signal }, globalLibrarySchema);
    if (current()) {
      setAssets(result.assets);
      setLoaded(true);
    }
  }), [run]);

  const transfer = (asset: Asset, destination: "session" | "global") => run(
    `transfer:${asset.id}`,
    async (signal, current) => {
      const path = destination === "global"
        ? `/api/admin/global-library/from-session/${encodeURIComponent(asset.id)}`
        : `/api/admin/global-library/${encodeURIComponent(asset.id)}/add-to-session`;
      const result = await api(path, { ...json("POST"), signal }, libraryTransferSchema);
      if (!current()) return;
      if (destination === "session") {
        // Soundboard reloads its group/icon metadata when this asset list refreshes.
        await useEditor.getState().refreshAssets();
      } else {
        setAssets((old) => [...old.filter((entry) => entry.id !== result.asset.id), result.asset]);
      }
      if (current()) setNotice(result.reused
        ? `“${result.asset.name}” is already in the ${destination === "session" ? "session" : "global library"}.`
        : `Added “${result.asset.name}” to the ${destination === "session" ? "session" : "global library"}.`);
    },
  );

  const rename = (asset: Asset, name: string) => run(`rename:${asset.id}`, async (signal, current) => {
    const renamed = await api(
      `/api/admin/global-library/${encodeURIComponent(asset.id)}`,
      { ...json("PATCH", { name }), signal },
      assetSchema,
    );
    if (current()) {
      setAssets((old) => old.map((entry) => entry.id === renamed.id ? renamed : entry));
      setNotice(`Renamed global sound to “${renamed.name}”.`);
    }
  });

  const remove = (asset: Asset) => run(`delete:${asset.id}`, async (signal, current) => {
    await api(`/api/admin/global-library/${encodeURIComponent(asset.id)}`, { ...json("DELETE"), signal });
    if (current()) {
      if (audioEngine.getSnapshot().preview?.asset.id === asset.id) audioEngine.stopPreview();
      setAssets((old) => old.filter((entry) => entry.id !== asset.id));
      setNotice(`Deleted “${asset.name}” from the global library.`);
    }
  });

  return { assets, loaded, busy, error, notice, load, transfer, rename, remove };
}
