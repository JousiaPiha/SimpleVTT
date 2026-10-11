import { spawn } from "node:child_process";

export interface ToolOptions {
  signal: AbortSignal;
  onLine?: (line: string) => void;
  cwd?: string;
}
export type RunTool = (
  file: string,
  args: string[],
  options: ToolOptions,
) => Promise<void>;

// No shell, bounded output, and terminate the whole tree (including FFmpeg).
export const runTool: RunTool = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let force: ReturnType<typeof setTimeout> | undefined;
    let tail = "";
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* Already exited. */
        }
        force = setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            /* Already exited. */
          }
        }, 2000);
        force.unref();
      }
    };
    const read = (stream: typeof child.stdout) => {
      let buffer = "";
      stream?.setEncoding("utf8");
      stream?.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/[\r\n]+/);
        buffer = (lines.pop() ?? "").slice(-16384);
        for (const line of lines) {
          tail = (tail + line + "\n").slice(-2048);
          options.onLine?.(line);
        }
      });
      stream?.on("end", () => {
        if (buffer) {
          tail = (tail + buffer).slice(-2048);
          options.onLine?.(buffer);
        }
      });
    };
    read(child.stdout);
    read(child.stderr);
    const clean = () => {
      clearTimeout(force);
      options.signal.removeEventListener("abort", kill);
    };
    options.signal.addEventListener("abort", kill, { once: true });
    if (options.signal.aborted) kill();
    child.on("error", (error) => {
      clean();
      reject(error);
    });
    child.on("close", (code) => {
      clean();
      if (options.signal.aborted) reject(new Error("Import stopped"));
      else if (code === 0) resolve();
      else reject(new Error(tail.trim() || `Tool exited with code ${code}`));
    });
  });
