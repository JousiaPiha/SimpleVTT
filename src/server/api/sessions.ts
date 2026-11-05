import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionRequestSchema } from "../../shared/sessions.js";
import type { createSessionManager } from "../services/sessions.js";
import { createFolderBrowser } from "../services/session-folders.js";

export async function sessionRoutes(
  app: FastifyInstance,
  sessions: Awaited<ReturnType<typeof createSessionManager>>,
  sessionsRoot: string | undefined,
  requestsPending: () => boolean,
) {
  const browser = createFolderBrowser({
    sessionsRoot,
    currentPath: () => sessions.peek()?.path ?? null,
  });
  const browse = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const reason =
        code === "ENOENT" || code === "ENOTDIR"
          ? "Folder not found. Check the path and that the drive is mounted."
          : code === "EACCES" || code === "EPERM"
            ? "This folder is not accessible to the server user."
            : error instanceof Error
              ? error.message
              : "Folder is unavailable.";
      throw Object.assign(new Error(reason), { statusCode: 400 });
    }
  };
  app.get("/session", async () => {
    if (!sessions.status().busy)
      await sessions.checkStorage().catch(() => undefined);
    return sessions.status();
  });
  app.get("/session/folders", async (req) => {
    const { path } = z
      .object({ path: z.string().min(1).max(4096).optional() })
      .parse(req.query);
    return browse(() => browser.list(path));
  });
  app.post("/session/folders", async (req, reply) => {
    const { parent, name } = z
      .object({
        parent: z.string().min(1).max(4096),
        name: z.string().min(1).max(255),
      })
      .strict()
      .parse(req.body);
    return reply
      .code(201)
      .send(await browse(() => browser.create(parent, name)));
  });
  app.post("/session/operations", async (req, reply) => {
    const { action, path, force } = sessionRequestSchema.parse(req.body);
    if ((action === "save-as" || action === "open") && !path)
      return reply.code(400).send({ error: "Select a folder first." });
    if (requestsPending())
      return reply.code(409).send({
        error:
          "Wait for current saves and media operations to finish, then try again.",
      });
    return reply.code(202).send(sessions.start(action, path, force));
  });
}
