import { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { homedir } from "node:os";
import { loginSchema } from "../../shared/contracts.js";
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

type TerminalInput = Readable & { isTTY?: boolean };
type TerminalOutput = Writable & { isTTY?: boolean };

function hiddenLine(
  input: TerminalInput,
  output: TerminalOutput,
  label: string,
): Promise<string> {
  // readline owns raw mode and editing; its output is discarded so passwords
  // and cursor-control sequences never reach the terminal or a log file.
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const line = createInterface({
    input,
    output: muted,
    terminal: true,
    historySize: 0,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (answer?: string) => {
      if (settled) return;
      settled = true;
      process.removeListener("SIGTERM", cancel);
      line.close();
      muted.end();
      output.write("\n");
      if (answer === undefined) reject(new Error("Password setup cancelled."));
      else resolve(answer);
    };
    const cancel = () => finish();
    line.once("SIGINT", cancel);
    line.once("close", cancel);
    process.once("SIGTERM", cancel);
    line.question("", finish);
    output.write(label);
  });
}

export async function promptForAdminPassword(
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<string> {
  if (!input.isTTY || !output.isTTY)
    throw new Error(
      "No admin password is configured. Run npm start in a terminal once to choose one, or set ADMIN_PASSWORD for unattended startup.",
    );
  output.write(
    "Choose an administrator password for this computer. A longer password is recommended, but not required.\n",
  );
  for (;;) {
    const password = await hiddenLine(
      input,
      output,
      "Choose an admin password: ",
    );
    if (!loginSchema.safeParse({ password }).success) {
      output.write(
        "Please enter a non-empty password (up to 1024 characters).\n",
      );
      continue;
    }
    const confirmation = await hiddenLine(
      input,
      output,
      "Repeat the password: ",
    );
    if (password === confirmation) return password;
    output.write("Passwords did not match. Try again.\n");
  }
}

export async function loadAdminPassword(
  file: string,
  environmentPassword?: string,
  prompt: () => Promise<string> = promptForAdminPassword,
): Promise<PasswordHash> {
  if (environmentPassword) return resolvePasswordHash(environmentPassword);
  try {
    return passwordHashSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `Cannot read administrator password configuration at ${file}. Restore it, or remove it to choose a new password. ADMIN_PASSWORD can override it.`,
      );
  }
  const credential = resolvePasswordHash(await prompt());
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    // Exclusive creation preserves a password saved by a concurrent launch.
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(credential)}\n`);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(file).catch(() => undefined);
      throw error;
    }
    await handle.close();
  } catch {
    throw new Error(
      `Cannot save administrator password configuration at ${file}. Check folder permissions or whether another launch created it, then restart.`,
    );
  }
  return credential;
}
