import { onlineAudioInputSchema } from "../../shared/online-audio.js";
import type { onlineAudioService } from "../services/online-audio.js";
import { drawingInputSchema } from "../../shared/drawing.js";
import type { FastifyInstance } from "fastify";
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
import type { Store } from "../database/store.js";
import {
  contentInputSchema,
  contentPatchSchema,
} from "../../shared/content.js";
import { MAX_FILE_SIZE, type mediaService } from "../services/media.js";

import { soundboardInputSchema } from "../../shared/soundboard.js";

type Params = { id: string; objectId: string };
export async function adminRoutes(
  app: FastifyInstance,
  store: Store,
  media: Awaited<ReturnType<typeof mediaService>>,
  publish: () => void,
  onlineAudio: Awaited<ReturnType<typeof onlineAudioService>>,
) {
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0, parts: 1 },
  });
  app.get("/online-audio/tools", async () => onlineAudio.tools());
  app.get("/online-audio/job", async () => onlineAudio.status());
  app.post("/online-audio/job", async (req, reply) =>
    reply
      .code(202)
      .send(onlineAudio.start(onlineAudioInputSchema.parse(req.body))),
  );
  app.delete<{ Params: { id: string } }>(
    "/online-audio/job/:id",
    async (req, reply) => {
      onlineAudio.cancel(req.params.id);
      return reply.code(204).send();
    },
  );
  app.get("/soundboard", async () => store.listSoundboard());
  app.put<{ Params: { id: string } }>("/soundboard/:id", async (req) =>
    store.saveSoundboard(req.params.id, soundboardInputSchema.parse(req.body)),
  );
  app.get("/playlists", async () => store.listPlaylists());
  app.post("/playlists", async (req, reply) =>
    reply
      .code(201)
      .send(store.createPlaylist(playlistInputSchema.parse(req.body))),
  );
  app.put<{ Params: Params }>("/playlists/:id", async (req) =>
    store.updatePlaylist(req.params.id, playlistInputSchema.parse(req.body)),
  );
  app.delete<{ Params: Params }>("/playlists/:id", async (req, reply) => {
    store.deletePlaylist(req.params.id);
    return reply.code(204).send();
  });
  app.get("/audio-preferences", async () => store.getAudioPreferences());
  app.put("/audio-preferences", async (req) =>
    store.saveAudioPreferences(audioPreferencesSchema.parse(req.body)),
  );
  app.get("/scenes", async () => store.listScenes());
  app.post("/scenes", async (req, reply) =>
    reply
      .code(201)
      .send(store.createScene(sceneCreateSchema.parse(req.body).name)),
  );
  app.get<{ Params: Params }>("/scenes/:id", async (req) =>
    store.getScene(req.params.id),
  );
  app.patch<{ Params: Params }>("/scenes/:id", async (req) => {
    const result = store.patchScene(
      req.params.id,
      scenePatchSchema.parse(req.body),
    );
    publish();
    return result;
  });
  app.delete<{ Params: Params }>("/scenes/:id", async (req, reply) => {
    store.deleteScene(req.params.id);
    publish();
    return reply.code(204).send();
  });
  app.post<{ Params: Params }>("/scenes/:id/objects", async (req, reply) => {
    const result = store.createObject(
      req.params.id,
      objectCreateSchema.parse(req.body),
    );
    publish();
    return reply.code(201).send(result);
  });
  app.patch<{ Params: Params }>(
    "/scenes/:id/objects/:objectId",
    async (req) => {
      const result = store.patchObject(
        req.params.id,
        req.params.objectId,
        objectPatchSchema.parse(req.body),
      );
      publish();
      return result;
    },
  );
  app.delete<{ Params: Params }>(
    "/scenes/:id/objects/:objectId",
    async (req, reply) => {
      store.deleteObject(req.params.id, req.params.objectId);
      publish();
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/content",
    async (req, reply) => {
      const result = store.createContent(
        req.params.id,
        contentInputSchema.parse(req.body),
      );
      publish();
      return reply.code(201).send(result);
    },
  );
  app.patch<{ Params: { id: string; contentId: string } }>(
    "/scenes/:id/content/:contentId",
    async (req) => {
      const result = store.patchContent(
        req.params.id,
        req.params.contentId,
        contentPatchSchema.parse(req.body),
      );
      publish();
      return result;
    },
  );
  app.delete<{ Params: { id: string; contentId: string } }>(
    "/scenes/:id/content/:contentId",
    async (req, reply) => {
      store.deleteContent(req.params.id, req.params.contentId);
      publish();
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/drawings",
    async (req, reply) => {
      const result = store.createDrawing(
        req.params.id,
        drawingInputSchema.parse(req.body),
      );
      publish();
      return reply.code(201).send(result);
    },
  );
  app.delete<{ Params: { id: string; drawingId: string } }>(
    "/scenes/:id/drawings/:drawingId",
    async (req, reply) => {
      store.deleteDrawing(req.params.id, req.params.drawingId);
      publish();
      return reply.code(204).send();
    },
  );
  app.get("/presentation", async () => ({ sceneId: store.activeId() }));
  app.put("/presentation", async (req) => {
    store.present(presentationInputSchema.parse(req.body).sceneId);
    publish();
    return { sceneId: store.activeId() };
  });
  app.get("/assets", async () => store.listAssets());
  app.get<{ Params: Params }>("/assets/:id/usage", async (req) =>
    store.assetUsage(req.params.id),
  );
  app.delete<{ Params: Params }>("/assets/:id", async (req, reply) => {
    await media.delete(req.params.id);
    publish();
    return reply.code(204).send();
  });
  app.post<{ Querystring: { category?: string } }>(
    "/assets",
    async (req, reply) => {
      const category = categorySchema.parse(req.query.category ?? "image");
      const file = await req.file();
      if (!file)
        return reply.code(400).send({ error: "A media file is required" });
      const result = await media.upload(file.file, file.filename, category);
      return reply.code(201).send({
        id: result.id,
        name: result.name,
        category: result.category,
        mimeType: result.mimeType,
      });
    },
  );
  app.post("/assets/scan", async () => media.scan());
}
