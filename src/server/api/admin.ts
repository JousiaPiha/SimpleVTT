import { onlineAudioInputSchema } from "../../shared/online-audio.js";
import { drawingInputSchema } from "../../shared/drawing.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SessionContext } from "../services/sessions.js";
import multipart from "@fastify/multipart";
import {
  categorySchema,
  objectCreateSchema,
  objectPatchSchema,
  presentationInputSchema,
  sceneCreateSchema,
  scenePatchSchema,
} from "../../shared/contracts.js";
import {
  audioPreferencesSchema,
  playlistInputSchema,
} from "../../shared/audio.js";
import {
  contentInputSchema,
  contentPatchSchema,
} from "../../shared/content.js";
import { MAX_FILE_SIZE } from "../services/media.js";

import { soundboardInputSchema } from "../../shared/soundboard.js";

type Params = { id: string; objectId: string };
export async function adminRoutes(
  app: FastifyInstance,
  context: (request: FastifyRequest) => SessionContext,
  publish: (context: SessionContext) => void,
) {
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0, parts: 1 },
  });
  app.get("/online-audio/tools", async (req) =>
    context(req).onlineAudio.tools(),
  );
  app.get("/online-audio/job", async (req) =>
    context(req).onlineAudio.status(),
  );
  app.post("/online-audio/job", async (req, reply) =>
    reply
      .code(202)
      .send(
        context(req).onlineAudio.start(onlineAudioInputSchema.parse(req.body)),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/online-audio/job/:id",
    async (req, reply) => {
      context(req).onlineAudio.cancel(req.params.id);
      return reply.code(204).send();
    },
  );
  app.get("/soundboard", async (req) => context(req).store.listSoundboard());
  app.put<{ Params: { id: string } }>("/soundboard/:id", async (req) =>
    context(req).store.saveSoundboard(
      req.params.id,
      soundboardInputSchema.parse(req.body),
    ),
  );
  app.get("/playlists", async (req) => context(req).store.listPlaylists());
  app.post("/playlists", async (req, reply) =>
    reply
      .code(201)
      .send(
        context(req).store.createPlaylist(playlistInputSchema.parse(req.body)),
      ),
  );
  app.put<{ Params: Params }>("/playlists/:id", async (req) =>
    context(req).store.updatePlaylist(
      req.params.id,
      playlistInputSchema.parse(req.body),
    ),
  );
  app.delete<{ Params: Params }>("/playlists/:id", async (req, reply) => {
    context(req).store.deletePlaylist(req.params.id);
    return reply.code(204).send();
  });
  app.get("/audio-preferences", async (req) =>
    context(req).store.getAudioPreferences(),
  );
  app.put("/audio-preferences", async (req) =>
    context(req).store.saveAudioPreferences(
      audioPreferencesSchema.parse(req.body),
    ),
  );
  app.get("/scenes", async (req) => context(req).store.listScenes());
  app.post("/scenes", async (req, reply) =>
    reply
      .code(201)
      .send(
        context(req).store.createScene(sceneCreateSchema.parse(req.body).name),
      ),
  );
  app.get<{ Params: Params }>("/scenes/:id", async (req) =>
    context(req).store.getScene(req.params.id),
  );
  app.patch<{ Params: Params }>("/scenes/:id", async (req) => {
    const result = context(req).store.patchScene(
      req.params.id,
      scenePatchSchema.parse(req.body),
    );
    publish(context(req));
    return result;
  });
  app.delete<{ Params: Params }>("/scenes/:id", async (req, reply) => {
    context(req).store.deleteScene(req.params.id);
    publish(context(req));
    return reply.code(204).send();
  });
  app.post<{ Params: Params }>("/scenes/:id/objects", async (req, reply) => {
    const result = context(req).store.createObject(
      req.params.id,
      objectCreateSchema.parse(req.body),
    );
    publish(context(req));
    return reply.code(201).send(result);
  });
  app.patch<{ Params: Params }>(
    "/scenes/:id/objects/:objectId",
    async (req) => {
      const result = context(req).store.patchObject(
        req.params.id,
        req.params.objectId,
        objectPatchSchema.parse(req.body),
      );
      publish(context(req));
      return result;
    },
  );
  app.delete<{ Params: Params }>(
    "/scenes/:id/objects/:objectId",
    async (req, reply) => {
      context(req).store.deleteObject(req.params.id, req.params.objectId);
      publish(context(req));
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/content",
    async (req, reply) => {
      const result = context(req).store.createContent(
        req.params.id,
        contentInputSchema.parse(req.body),
      );
      publish(context(req));
      return reply.code(201).send(result);
    },
  );
  app.patch<{ Params: { id: string; contentId: string } }>(
    "/scenes/:id/content/:contentId",
    async (req) => {
      const result = context(req).store.patchContent(
        req.params.id,
        req.params.contentId,
        contentPatchSchema.parse(req.body),
      );
      publish(context(req));
      return result;
    },
  );
  app.delete<{ Params: { id: string; contentId: string } }>(
    "/scenes/:id/content/:contentId",
    async (req, reply) => {
      context(req).store.deleteContent(req.params.id, req.params.contentId);
      publish(context(req));
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/drawings",
    async (req, reply) => {
      const result = context(req).store.createDrawing(
        req.params.id,
        drawingInputSchema.parse(req.body),
      );
      publish(context(req));
      return reply.code(201).send(result);
    },
  );
  app.delete<{ Params: { id: string; drawingId: string } }>(
    "/scenes/:id/drawings/:drawingId",
    async (req, reply) => {
      context(req).store.deleteDrawing(req.params.id, req.params.drawingId);
      publish(context(req));
      return reply.code(204).send();
    },
  );
  app.get("/presentation", async (req) => ({
    sceneId: context(req).store.activeId(),
  }));
  app.put("/presentation", async (req) => {
    context(req).store.present(presentationInputSchema.parse(req.body).sceneId);
    publish(context(req));
    return { sceneId: context(req).store.activeId() };
  });
  app.get("/assets", async (req) => context(req).store.listAssets());
  app.get<{ Params: Params }>("/assets/:id/usage", async (req) =>
    context(req).store.assetUsage(req.params.id),
  );
  app.delete<{ Params: Params }>("/assets/:id", async (req, reply) => {
    await context(req).media.delete(req.params.id);
    publish(context(req));
    return reply.code(204).send();
  });
  app.post<{ Querystring: { category?: string } }>(
    "/assets",
    async (req, reply) => {
      const category = categorySchema.parse(req.query.category ?? "image");
      const file = await req.file();
      if (!file)
        return reply.code(400).send({ error: "A media file is required" });
      const result = await context(req).media.upload(
        file.file,
        file.filename,
        category,
      );
      return reply.code(201).send({
        id: result.id,
        name: result.name,
        category: result.category,
        mimeType: result.mimeType,
      });
    },
  );
  app.post("/assets/scan", async (req) => context(req).media.scan());
}
