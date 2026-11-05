import type { OnlineAudioOptions } from "./services/online-audio.js";
import Fastify, { type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ReadStream } from "node:fs";
import { ZodError } from "zod";
import type { WebSocket } from "ws";
import {
  createSessionManager,
  type SessionContext,
} from "./services/sessions.js";
import { sessionRoutes } from "./api/sessions.js";
import { registerAuth, sameOrigin } from "./services/auth.js";
import { resolvePasswordHash, type PasswordHash } from "./services/password.js";
import { diffPresentation, publicScene } from "./services/presentation.js";
import { byteRange } from "./services/byte-range.js";
import { registerLaser } from "./services/laser.js";
import { adminRoutes } from "./api/admin.js";

export interface AppOptions {
  dataDir: string;
  mediaDir?: string;
  adminPassword: string | PasswordHash | null;
  adminPasswordFile?: string;
  secureCookie?: boolean;
  logger?: boolean;
  staticDir?: string;
  onlineAudio?: OnlineAudioOptions;
  sessionsRoot?: string;
}
export async function buildApp(options: AppOptions) {
  if (options.adminPassword === "" || options.adminPassword === undefined)
    throw new Error("ADMIN_PASSWORD must not be empty");
  if (options.adminPassword === null && !options.adminPasswordFile)
    throw new Error("Password setup requires a machine configuration file");
  const credential =
    options.adminPassword === null
      ? null
      : resolvePasswordHash(options.adminPassword);
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
  });
  const sessions = await createSessionManager({
    dataDir: options.dataDir,
    mediaDir: options.mediaDir,
    sessionsRoot: options.sessionsRoot,
    onlineAudio: options.onlineAudio,
    logger: app.log,
  });
  const initialGeneration = sessions.status().generation;
  const requestContexts = new WeakMap<FastifyRequest, SessionContext>();
  const activeRequests = new Set<FastifyRequest>();
  const streams = new Map<SessionContext, Set<ReadStream>>();
  const closing = new WeakSet<SessionContext>();
  sessions.setBeforeClose(async (context) => {
    closing.add(context);
    await Promise.all(
      [...(streams.get(context) ?? [])].map(
        (stream) =>
          new Promise<void>((done) => {
            if (stream.closed) return done();
            stream.once("close", done);
            stream.destroy();
          }),
      ),
    );
    streams.delete(context);
  });
  app.addHook("onClose", async () => sessions.shutdown());
  const authenticated = await registerAuth(
    app,
    credential,
    options.secureCookie ?? false,
    options.adminPasswordFile,
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin");
    if (req.url.startsWith("/api/") || req.url.startsWith("/media/"))
      reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, req, reply) => {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (
      requestContexts.has(req) &&
      !["GET", "HEAD"].includes(req.method) &&
      /^(SQLITE_(IOERR|FULL|READONLY|CANTOPEN)|ENOSPC|EIO|EROFS|ENODEV|ESTALE|ENOENT|EACCES|EPERM)/.test(
        code,
      )
    )
      sessions.markStorageError(error);
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
  let current: ReturnType<typeof publicScene> = null;
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
  const publish = (context: SessionContext) => {
    if (sessions.peek() !== context || closing.has(context)) return;
    const next = publicScene(context.store.liveScene(), (id) =>
      context.store.getAsset(id).mimeType.startsWith("image/"),
    );
    const event = diffPresentation(current, next);
    if (current?.id !== next?.id) laser.clear();
    current = next;
    if (event) broadcast(event);
  };
  await app.register(websocket, { options: { maxPayload: 1024 } });
  const laser = registerLaser(
    app,
    authenticated,
    () => current?.id,
    broadcast,
    () => sessions.status().generation,
  );
  let lastGeneration = initialGeneration;
  sessions.setOnChange(() => {
    const generation = sessions.status().generation;
    if (generation === lastGeneration) return;
    lastGeneration = generation;
    laser.reset();
    current = null;
    broadcast({ type: "presentation.snapshot", scene: null, generation });
  });
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
        JSON.stringify({
          type: "presentation.snapshot",
          scene: current,
          generation: sessions.status().generation,
        }),
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
    generation: sessions.status().generation,
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
        const management = /^\/api\/admin\/session(?:[/?]|$)/.test(req.url);
        const generation = sessions.status().generation;
        const supplied = req.headers["x-simplevtt-session"];
        if (
          (!management ||
            req.url.split("?")[0] === "/api/admin/session/operations") &&
          ((supplied && supplied !== generation) ||
            (!management && !supplied && generation !== initialGeneration))
        )
          return reply.code(409).send({
            error:
              "The active session changed. Reload the session before continuing.",
          });
        if (management) return;
        if (sessions.status().busy)
          return reply.code(409).send({
            error: "A session operation is in progress. Please wait.",
          });
        const context = sessions.require();
        // Register before any await so a transition cannot overtake this request.
        activeRequests.add(req);
        requestContexts.set(req, context);
        reply.header("X-SimpleVTT-Session", generation);
        if (!["GET", "HEAD"].includes(req.method)) {
          if (sessions.status().error)
            return reply.code(503).send({
              error:
                "Saving has stopped. Use Sessions to retry storage or close without saving.",
            });
          await sessions.checkStorage();
        }
      });
      admin.addHook("onResponse", async (req) => {
        activeRequests.delete(req);
      });
      admin.addHook("onRequestAbort", async (req) => {
        activeRequests.delete(req);
      });
      await sessionRoutes(
        admin,
        sessions,
        options.sessionsRoot,
        () => activeRequests.size > 0,
      );
      await adminRoutes(
        admin,
        (request) => {
          const context = requestContexts.get(request);
          if (!context)
            throw Object.assign(new Error("No session is loaded."), {
              statusCode: 503,
            });
          return context;
        },
        publish,
      );
    },
    { prefix: "/api/admin" },
  );
  app.get<{ Params: { id: string }; Querystring: { session?: string } }>(
    "/media/:id",
    async (req, reply) => {
      const generation = sessions.status().generation;
      if (
        (req.query.session && req.query.session !== generation) ||
        (!req.query.session && generation !== initialGeneration)
      )
        return reply.code(409).send({ error: "The active session changed." });
      const context = sessions.peek();
      if (!context || closing.has(context))
        return reply.code(404).send({ error: "Media not found" });
      const id = req.params.id;
      const visible =
        current?.backgroundAssetId === id ||
        current?.objects.some((o) => o.assetId === id);
      if (!authenticated(req) && !visible)
        return reply.code(404).send({ error: "Media not found" });
      const asset = context.store.getAsset(id);
      if (!authenticated(req) && !asset.mimeType.startsWith("image/"))
        return reply.code(404).send({ error: "Media not found" });
      const file = await context.media.file(asset.relativePath);
      if (sessions.peek() !== context || closing.has(context))
        return reply.code(409).send({ error: "The active session changed." });
      const track = (stream: ReadStream) => {
        const entries = streams.get(context) ?? new Set<ReadStream>();
        streams.set(context, entries);
        entries.add(stream);
        stream.once("close", () => entries.delete(stream));
        return stream;
      };
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
          .send(track(file.stream(range)));
      }
      return reply
        .header("Content-Length", file.size)
        .send(track(file.stream()));
    },
  );
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
