import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "finds user-installed yt-dlp with the restricted PATH of an existing desktop entry",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "simple-vtt-launcher-"));
    try {
      const bin = join(root, "bin");
      const localBin = join(root, "home/.local/bin");
      const config = join(root, "config");
      const share = join(root, "share");
      await Promise.all([
        mkdir(bin, { recursive: true }),
        mkdir(localBin, { recursive: true }),
        mkdir(join(config, "simple-vtt"), { recursive: true }),
        mkdir(join(share, "applications"), { recursive: true }),
        mkdir(join(root, "dist/server"), { recursive: true }),
        mkdir(join(root, "dist/client"), { recursive: true }),
        mkdir(join(root, "node_modules")),
      ]);
      await copyFile(resolve("start-debian.sh"), join(root, "start-debian.sh"));
      const desktop = join(share, "applications/simple-vtt.desktop");
      await writeFile(desktop, "Existing menu entry\n");
      await writeFile(join(config, "simple-vtt/launcher.conf"), "export ADMIN_PASSWORD=x\n");
      await writeFile(join(root, "dist/client/index.html"), "test");
      await writeFile(join(root, "dist/server/index.js"), `
        const { execFileSync } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        writeFileSync('tool-version', execFileSync('yt-dlp', ['--version']));
        setTimeout(() => {}, 1500);
      `);
      const shim = async (name: string, body: string, directory = bin) =>
        writeFile(join(directory, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      await shim("yt-dlp", "printf 'user-local-test-version\\n'", localBin);
      // Isolate desktop/network/Linux tools; execute the server's subprocess lookup for real.
      for (const name of ["npm", "curl", "flock", "xdg-open"])
        await shim(name, "exit 0");
      await shim("node", '[[ "$1" == --input-type=module ]] && exit 0\nexec "$TEST_NODE" "$@"');
      await exec("/bin/bash", [join(root, "start-debian.sh")], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: join(root, "home"),
          XDG_CONFIG_HOME: config,
          XDG_DATA_HOME: share,
          TEST_NODE: process.execPath,
        },
        timeout: 10000,
      });
      expect(await readFile(join(root, "tool-version"), "utf8"))
        .toBe("user-local-test-version\n");
      expect(await readFile(desktop, "utf8")).toBe("Existing menu entry\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
