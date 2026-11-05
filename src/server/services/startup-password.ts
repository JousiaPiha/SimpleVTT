import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { homedir } from "node:os";
import {
  passwordHashSchema,
  resolvePasswordHash,
  type PasswordHash,
} from "./password.js";

export function adminPasswordPath(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const paths = platform === "win32" ? win32 : posix;
  const directory =
    platform === "win32"
      ? env.APPDATA || paths.join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? paths.join(home, "Library", "Application Support")
        : env.XDG_CONFIG_HOME || paths.join(home, ".config");
  return paths.join(directory, "simple-vtt", "admin-password.json");
}

export async function loadAdminPassword(
  file: string,
  environmentPassword?: string,
): Promise<PasswordHash | null> {
  if (environmentPassword) return resolvePasswordHash(environmentPassword);
  try {
    return passwordHashSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Cannot read administrator password configuration at ${file}. Restore it, or remove it to choose a new password. ADMIN_PASSWORD can override it.`,
    );
  }
}

export async function saveAdminPassword(
  file: string,
  password: string,
): Promise<PasswordHash> {
  const credential = resolvePasswordHash(password);
  let openingFile = false;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    // Exclusive creation preserves a password saved by a concurrent launch.
    openingFile = true;
    const handle = await open(file, "wx", 0o600);
    openingFile = false;
    try {
      await handle.writeFile(`${JSON.stringify(credential)}\n`);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(file).catch(() => undefined);
      throw error;
    }
    await handle.close();
  } catch (error) {
    if (openingFile && (error as NodeJS.ErrnoException).code === "EEXIST")
      throw error;
    throw new Error(
      `Cannot save administrator password configuration at ${file}. Check folder permissions, then try again.`,
    );
  }
  return credential;
}
