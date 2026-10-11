import {
  onlineAudioService,
  type OnlineAudioOptions,
} from "./services/online-audio.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import type { WebSocket } from "ws";
import { openStore } from "./database/store.js";
import { registerAuth, sameOrigin } from "./services/auth.js";
import { diffPresentation, publicScene } from "./services/presentation.js";
import { mediaService } from "./services/media.js";
import { byteRange } from "./services/byte-range.js";
import { registerLaser } from "./services/laser.js";
import { adminRoutes } from "./api/admin.js";

export interface AppOptions {
  dataDir: string;
  mediaDir?: string;
  adminPassword: string;
  secureCookie?: boolean;
  logger?: boolean;
  staticDir?: string;
  onlineAudio?: OnlineAudioOptions;
}
export async function buildApp(options: AppOptions) {
  if (options.adminPassword.length < 12)
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
  });
  const store = openStore(options.dataDir);
  app.addHook("onClose", async () => store.close());
  const media = await mediaService(
    options.mediaDir ?? join(options.dataDir, "media"),
    store,
    app.log,
  );
  const onlineAudio = await onlineAudioService(
    options.dataDir,
    media,
    options.onlineAudio,
  );
  app.addHook("preClose", async () => onlineAudio.close());
  const authenticated = await registerAuth(
    app,
    options.adminPassword,
    options.secureCookie ?? false,
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin");
    if (req.url.startsWith("/api/") || req.url.startsWith("/media/"))
      reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "Invalid request",
        details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    const status =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status >= 500) {
      req.log.error(error);
      return reply
        .code(500)
        .send({ error: "The server could not complete the request" });
    }
    return reply.code(status).send({
      error: error instanceof Error ? error.message : "Request failed",
    });
  });
  const isPublicAsset = (id: string) =>
    store.getAsset(id).mimeType.startsWith("image/");
  let current = publicScene(store.liveScene(), isPublicAsset);
  const clients = new Set<WebSocket>();
  const broadcast = (event: unknown) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState !== 1) continue;
      if (client.bufferedAmount > 1024 * 1024) {
        client.close(1013, "Reconnect for fresh state");
        continue;
      }
      client.send(payload);
    }
  };
  const publish = () => {
    const next = publicScene(store.liveScene(), isPublicAsset);
    const event = diffPresentation(current, next);
    if (current?.id !== next?.id) laser.clear();
    current = next;
    if (event) broadcast(event);
  };
  await app.register(websocket, { options: { maxPayload: 1024 } });
  const laser = registerLaser(app, authenticated, () => current?.id, broadcast);
  app.get(
    "/ws/player",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!sameOrigin(req))
          return reply
            .code(403)
            .send({ error: "Same-origin connection required" });
      },
    },
    (socket) => {
      clients.add(socket);
      socket.send(
        JSON.stringify({ type: "presentation.snapshot", scene: current }),
      );
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
      socket.on("message", () => socket.close(1008, "Read-only connection"));
    },
  );
  // Heartbeats detect silent LAN drops so browsers reconnect to a fresh snapshot.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, 30000);
  app.addHook("onReady", async () => {
    app.websocketServer.on("connection", (socket) => {
      alive.add(socket);
      socket.on("pong", () => alive.add(socket));
    });
  });
  app.addHook("preClose", async () => {
    clearInterval(heartbeat);
    for (const client of clients) client.terminate();
  });
  app.get("/api/presentation", async () => ({
    type: "presentation.snapshot",
    scene: current,
  }));
  await app.register(
    async (admin) => {
      admin.addHook("onRequest", async (req, reply) => {
        if (!authenticated(req))
          return reply
            .code(401)
            .send({ error: "Sign in to manage the presentation" });
        if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req))
          return reply
            .code(403)
            .send({ error: "Same-origin request required" });
      });
      await adminRoutes(admin, store, media, publish, onlineAudio);
    },
    { prefix: "/api/admin" },
  );
  app.get<{ Params: { id: string } }>("/media/:id", async (req, reply) => {
    const id = req.params.id;
    const visible =
      current?.backgroundAssetId === id ||
      current?.objects.some((o) => o.assetId === id);
    if (!authenticated(req) && !visible)
      return reply.code(404).send({ error: "Media not found" });
    const asset = store.getAsset(id);
    if (!authenticated(req) && !asset.mimeType.startsWith("image/"))
      return reply.code(404).send({ error: "Media not found" });
    const file = await media.file(asset.relativePath);
    reply.type(asset.mimeType).header("Accept-Ranges", "bytes");
    if (req.headers.range !== undefined) {
      const range = byteRange(req.headers.range, file.size);
      if (!range)
        return reply
          .code(416)
          .header("Content-Range", `bytes */${file.size}`)
          .send();
      return reply
        .code(206)
        .header(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${file.size}`,
        )
        .header("Content-Length", range.end - range.start + 1)
        .send(file.stream(range));
    }
    return reply.header("Content-Length", file.size).send(file.stream());
  });
  const staticDir = options.staticDir ?? resolve("dist/client");
  if (existsSync(join(staticDir, "index.html"))) {
    await app.register(staticFiles, {
      root: staticDir,
      // Resolve build assets at request time; filenames change after a rebuild.
      wildcard: true,
      index: false,
      setHeaders: (reply, path) => {
        if (path.endsWith("/index.html"))
          reply.header("Cache-Control", "no-store");
      },
    });
    for (const route of ["/", "/admin", "/player"])
      app.get(route, async (_req, reply) => reply.sendFile("index.html"));
  } else {
    app.get("/", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(
          "SimpleVTT API is running. Start npm run dev:client and open http://localhost:5173/admin, or run npm run build.",
        ),
    );
  }
  return app;
}
