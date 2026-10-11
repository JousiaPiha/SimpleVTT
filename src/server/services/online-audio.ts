import { mkdtemp, mkdir, rm, readdir, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  onlineAudioInputSchema,
  onlineAudioBusy,
  type OnlineAudioInput,
  type OnlineAudioJob,
} from "../../shared/online-audio.js";
import { MAX_FILE_SIZE, type mediaService } from "./media.js";
import { runTool, type RunTool } from "./run-tool.js";

export interface OnlineAudioOptions {
  ytDlpPath?: string;
  ffmpegDirectory?: string;
  run?: RunTool;
  timeoutMs?: number;
}
export async function onlineAudioService(
  dataDir: string,
  media: Awaited<ReturnType<typeof mediaService>>,
  options: OnlineAudioOptions = {},
) {
  const run = options.run ?? runTool;
  const executable = options.ytDlpPath ?? "yt-dlp";
  const ffmpegDirectory = options.ffmpegDirectory
    ? resolve(options.ffmpegDirectory)
    : undefined;
  const binary = (name: string) =>
    ffmpegDirectory
      ? join(
          ffmpegDirectory,
          name + (process.platform === "win32" ? ".exe" : ""),
        )
      : name;
  const root = resolve(dataDir, ".online-imports");
  // This service owns this directory; no incomplete download is a library asset.
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  let job: OnlineAudioJob | null = null;
  let controller: AbortController | undefined;
  let work: Promise<void> | undefined;
  let toolsCache: { ready: boolean; missing: string[] } | undefined;
  let checkedAt = 0;
  let checking: Promise<{ ready: boolean; missing: string[] }> | undefined;
  const tools = async () => {
    if (toolsCache && Date.now() - checkedAt < 30000) return toolsCache;
    if (checking) return checking;
    checking = (async () => {
      const missing: string[] = [];
      await Promise.all(
        [
          ["yt-dlp", executable, "--version"],
          ["FFmpeg", binary("ffmpeg"), "-version"],
          ["ffprobe", binary("ffprobe"), "-version"],
        ].map(async ([name, path, flag]) => {
          try {
            await run(path, [flag], { signal: AbortSignal.timeout(5000) });
          } catch {
            missing.push(name);
          }
        }),
      );
      toolsCache = { ready: !missing.length, missing };
      checkedAt = Date.now();
      return toolsCache;
    })();
    try {
      return await checking;
    } finally {
      checking = undefined;
    }
  };
  const start = (input: OnlineAudioInput) => {
    input = onlineAudioInputSchema.parse(input);
    if (onlineAudioBusy(job))
      throw Object.assign(new Error("An audio import is already running."), {
        statusCode: 409,
      });
    const current: OnlineAudioJob = {
      id: randomUUID(),
      status: "checking",
      category: input.category,
      title: input.name || "Online audio",
      progress: null,
      error: null,
      asset: null,
    };
    job = current;
    const currentController = new AbortController();
    controller = currentController;
    const signal = currentController.signal;
    work = (async () => {
      let directory: string | undefined;
      let watchdog: ReturnType<typeof setInterval> | undefined;
      let timedOut = false,
        tooLarge = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          currentController.abort();
        },
        options.timeoutMs ?? 30 * 60 * 1000,
      );
      try {
        const status = await tools();
        if (!status.ready)
          throw new Error(
            `Install ${status.missing.join(", ")} on the server, then retry. See README: Online audio imports.`,
          );
        signal.throwIfAborted();
        directory = await mkdtemp(join(root, "import-"));
        let measuring = false;
        watchdog = setInterval(() => {
          if (measuring || !directory) return;
          measuring = true;
          void readdir(directory)
            .then(async (names) => {
              const sizes = await Promise.all(
                names.map(
                  async (name) => (await lstat(join(directory!, name))).size,
                ),
              );
              if (sizes.reduce((a, b) => a + b, 0) > MAX_FILE_SIZE * 2) {
                tooLarge = true;
                currentController.abort();
              }
            })
            .catch(() => undefined)
            .finally(() => {
              measuring = false;
            });
        }, 1000);
        current.status = "downloading";
        const args = [
          "--ignore-config",
          "--no-plugin-dirs",
          "--no-playlist",
          "--playlist-items",
          "1",
          "--no-cache-dir",
          "--no-colors",
          "--newline",
          "--no-simulate",
          "--progress",
          "--socket-timeout",
          "20",
          "--retries",
          "2",
          "--fragment-retries",
          "2",
          "--max-filesize",
          String(MAX_FILE_SIZE),
          "--match-filters",
          "!is_live",
          "--format",
          "bestaudio/best",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "192K",
          "--output",
          join(directory, "audio.%(ext)s"),
          "--print",
          "before_dl:__TITLE__%(title)j",
          "--print",
          "post_process:__CONVERT__",
          "--progress-template",
          "download:__PROGRESS__%(progress._percent_str)s",
          // Use the application's existing Node runtime for supported extractors.
          "--js-runtimes",
          `node:${process.execPath}`,
        ];
        if (ffmpegDirectory) args.push("--ffmpeg-location", ffmpegDirectory);
        args.push("--", input.url);
        await run(executable, args, {
          cwd: directory,
          signal,
          onLine: (line) => {
            if (line.startsWith("__TITLE__") && !input.name) {
              try {
                const title: unknown = JSON.parse(line.slice(9));
                if (typeof title === "string")
                  current.title = title.slice(0, 120);
              } catch {
                /* Optional metadata. */
              }
            }
            if (line.startsWith("__PROGRESS__")) {
              const value = parseFloat(line.slice(12));
              if (Number.isFinite(value))
                current.progress = Math.max(0, Math.min(100, value));
              if (value >= 100) current.status = "converting";
            }
            if (line.startsWith("__CONVERT__")) current.status = "converting";
          },
        });
        signal.throwIfAborted();
        const path = join(directory, "audio.mp3");
        const info = await lstat(path).catch(() => null);
        if (!info || !info.isFile() || info.isSymbolicLink())
          throw new Error(
            "No audio was downloaded. Use a single media link; live streams and unavailable videos cannot be imported.",
          );
        if (info.size > MAX_FILE_SIZE)
          throw new Error("Audio exceeds the 256 MiB library limit.");
        current.status = "saving";
        clearTimeout(timeout);
        clearInterval(watchdog);
        const asset = await media.upload(
          createReadStream(path),
          `${current.title.replace(/[\\/]/g, "-").slice(0, 116)}.mp3`,
          input.category,
        );
        current.asset = {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          mimeType: asset.mimeType,
        };
        current.status = "complete";
        current.progress = 100;
      } catch (error) {
        if (signal.aborted && !timedOut && !tooLarge)
          current.status = "cancelled";
        else {
          current.status = "failed";
          current.error = timedOut
            ? "Import timed out after 30 minutes. Try a shorter source or a faster connection."
            : tooLarge
              ? "Download exceeds the import size limit."
              : error instanceof Error
                ? error.message.slice(-1200)
                : "Audio import failed.";
        }
      } finally {
        clearTimeout(timeout);
        clearInterval(watchdog);
        if (directory)
          await rm(directory, { recursive: true, force: true }).catch(
            () => undefined,
          );
      }
    })();
    return { ...current };
  };
  return {
    tools,
    start,
    status: () => (job ? { ...job } : null),
    cancel(id: string) {
      if (job?.id !== id)
        throw Object.assign(new Error("Import not found"), { statusCode: 404 });
      if (job.status === "saving")
        throw Object.assign(
          new Error("The downloaded file is already being saved."),
          { statusCode: 409 },
        );
      if (onlineAudioBusy(job)) controller?.abort();
    },
    async close() {
      if (job?.status !== "saving") controller?.abort();
      await work;
    },
  };
}
