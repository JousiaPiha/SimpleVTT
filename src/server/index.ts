import { resolve } from "node:path";
import { buildApp } from "./app.js";
import {
  adminPasswordPath,
  loadAdminPassword,
} from "./services/startup-password.js";

async function start() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");
  const passwordFile = adminPasswordPath();
  const password = await loadAdminPassword(
    passwordFile,
    process.env.ADMIN_PASSWORD,
  );
  const app = await buildApp({
    dataDir: resolve(process.env.DATA_DIR ?? "data"),
    mediaDir: process.env.MEDIA_DIR
      ? resolve(process.env.MEDIA_DIR)
      : undefined,
    sessionsRoot: process.env.SESSIONS_ROOT,
    adminPassword: password,
    adminPasswordFile: passwordFile,
    onlineAudio: {
      ytDlpPath: process.env.YT_DLP_PATH,
      ffmpegDirectory: process.env.FFMPEG_DIRECTORY,
    },
    secureCookie: process.env.COOKIE_SECURE === "true",
  });
  try {
    await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
void start().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Server startup failed.",
  );
  process.exitCode = 1;
});
