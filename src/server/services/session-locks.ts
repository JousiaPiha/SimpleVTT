import { open, readFile, unlink, lstat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// A disconnected folder may retain our lock even after all of its context's
// handles were closed. Remember only the exact path/token pairs released by
// this process; a matching PID alone never grants permission to steal a lock.
const releasedTokens = new Set<string>();
const ownershipKey = (path: string, token: string) =>
  JSON.stringify([path, token]);

export async function lockSession(path: string) {
  const file = join(path, ".simple-vtt.lock");
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ host: hostname(), pid: process.pid, token }),
        );
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(file).catch(() => undefined);
        throw error;
      }
      await handle.close();
      return async () => {
        // Callers release only after their database/media handles are closed.
        const key = ownershipKey(path, token);
        releasedTokens.add(key);
        try {
          const owner = JSON.parse(await readFile(file, "utf8"));
          if (owner.token === token) {
            await unlink(file);
            releasedTokens.delete(key);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(file);
      if (info.isSymbolicLink())
        throw new Error("Unsafe session ownership lock");
      let owner: { host?: string; pid?: number; token?: string };
      try {
        owner = JSON.parse(await readFile(file, "utf8"));
      } catch {
        throw new Error(
          "Session has an unreadable ownership lock. Verify no other server is using it before removing the lock.",
        );
      }
      if (
        owner.host !== hostname() ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid! <= 0
      )
        throw new Error(
          "Session is already open on another computer or has an invalid lock",
        );
      const releasedKey =
        typeof owner.token === "string"
          ? ownershipKey(path, owner.token)
          : null;
      const releasedHere =
        owner.pid === process.pid &&
        releasedKey !== null &&
        releasedTokens.has(releasedKey);
      if (!releasedHere) {
        try {
          process.kill(owner.pid!, 0);
          throw new Error("Session is already open by another server");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      const latest = await lstat(file);
      if (latest.dev === info.dev && latest.ino === info.ino) {
        await unlink(file);
        if (releasedKey) releasedTokens.delete(releasedKey);
      }
    }
  }
  throw new Error("Session ownership changed; retry opening it");
}
