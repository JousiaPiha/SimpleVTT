import type { FastifyInstance, FastifyRequest } from "fastify";
import { libraryRenameSchema } from "../../shared/global-library.js";
import type { createGlobalLibrary } from "../services/global-library.js";
import type { SessionContext } from "../services/sessions.js";

export async function globalLibraryRoutes(
  app: FastifyInstance,
  context: (request: FastifyRequest) => SessionContext,
  library: ReturnType<typeof createGlobalLibrary>,
) {
  app.get("/global-library", (req) => library.list(context(req)));
  app.post<{ Params: { id: string } }>(
    "/global-library/from-session/:id",
    (req) => library.promote(context(req), req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/global-library/:id/add-to-session",
    (req) => library.addToSession(context(req), req.params.id),
  );
  app.patch<{ Params: { id: string } }>(
    "/global-library/:id",
    (req) => library.rename(context(req), req.params.id, libraryRenameSchema.parse(req.body).name),
  );
  app.delete<{ Params: { id: string } }>("/global-library/:id", async (req, reply) => {
    await library.delete(context(req), req.params.id);
    return reply.code(204).send();
  });
}
