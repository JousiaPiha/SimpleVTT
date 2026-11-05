import { access, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { FolderListing } from "../../shared/sessions.js";
export function createFolderBrowser(options: {
  sessionsRoot?: string;
  currentPath: () => string | null;
}) {
  async function directory(path: string) {
    const canonical = await realpath(resolve(path));
    if (!(await stat(canonical)).isDirectory())
      throw new Error("Select an existing directory");
    await access(canonical, constants.R_OK);
    return canonical;
  }
  async function locations() {
    const result = [
      { name: "Home", path: homedir() },
      { name: "Server folder", path: process.cwd() },
    ];
    if (process.platform === "win32") {
      for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const path = `${letter}:\\`;
        if (await directory(path).catch(() => null))
          result.push({ name: path, path });
      }
    } else {
      result.push({ name: "Filesystem", path: "/" });
      for (const mounts of ["/Volumes", "/media", "/mnt"]) {
        for (const entry of await readdir(mounts, {
          withFileTypes: true,
        }).catch(() => [])) {
          if (entry.isDirectory())
            result.push({ name: entry.name, path: join(mounts, entry.name) });
        }
      }
    }
    return result;
  }
  async function list(path?: string): Promise<FolderListing> {
    let chosen: string | undefined;
    let warning: string | null = null;
    if (path !== undefined) chosen = await directory(path);
    else {
      const candidates = [
        options.sessionsRoot,
        options.currentPath(),
        process.cwd(),
        homedir(),
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        try {
          chosen = await directory(candidate);
          break;
        } catch {
          if (candidate === options.sessionsRoot)
            warning = `Configured SESSIONS_ROOT is unavailable: ${candidate}. Showing a fallback folder.`;
        }
      }
    }
    if (!chosen)
      return {
        path: null,
        parent: null,
        folders: [],
        locations: await locations(),
        warning:
          "No readable starting directory. Enter an existing server path.",
        empty: false,
      };
    const entries = await readdir(chosen, { withFileTypes: true });
    const folders: FolderListing["folders"] = [];
    for (const entry of entries) {
      const target = join(chosen, entry.name);
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (await stat(target).catch(() => null))?.isDirectory())
      )
        folders.push({ name: entry.name, path: target });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(chosen);
    return {
      path: chosen,
      parent: parent === chosen ? null : parent,
      folders,
      locations: await locations(),
      warning,
      empty: entries.length === 0,
    };
  }
  return {
    list,
    async create(parent: string, name: string) {
      if (
        !name ||
        name.trim() !== name ||
        name === "." ||
        name === ".." ||
        /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
        Buffer.byteLength(name) > 240 ||
        basename(name) !== name
      )
        throw new Error(
          "Use a portable folder name without separators or reserved characters",
        );
      const path = await directory(parent);
      await mkdir(join(path, name));
      return list(path);
    },
  };
}
