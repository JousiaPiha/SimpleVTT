import { resolve } from "node:path";
import { buildApp } from "./app.js";

const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error(
    "Set ADMIN_PASSWORD to a non-empty password. A longer password is recommended. See README.md.",
  );
  process.exit(1);
}
const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  mediaDir: process.env.MEDIA_DIR ? resolve(process.env.MEDIA_DIR) : undefined,
  adminPassword: password,
  onlineAudio: {
    ytDlpPath: process.env.YT_DLP_PATH,
    ffmpegDirectory: process.env.FFMPEG_DIRECTORY,
  },
  secureCookie: process.env.COOKIE_SECURE === "true",
});
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer from 1 to 65535");
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
