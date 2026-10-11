import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  laserCommandSchema,
  LASER_INTERVAL_MS,
  LASER_TIMEOUT_MS,
  type LaserEvent,
} from "../../shared/laser.js";
import { sameOrigin } from "./auth.js";

// Ephemeral only: pointer traffic must never touch prepared scenes or SQLite.
export function registerLaser(
  app: FastifyInstance,
  authenticated: (request: FastifyRequest) => boolean,
  liveSceneId: () => string | undefined,
  broadcast: (event: LaserEvent) => void,
) {
  const controllers = new Set<WebSocket>();
  let owner: WebSocket | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(expiry);
    if (owner) broadcast({ type: "laser.updated", pointer: null });
    owner = null;
  };
  app.get(
    "/ws/admin/laser",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!authenticated(req))
          return reply.code(401).send({ error: "Sign in to use the pointer" });
        if (!sameOrigin(req))
          return reply
            .code(403)
            .send({ error: "Same-origin connection required" });
      },
    },
    (socket, request) => {
      controllers.add(socket);
      let lastUpdate = 0;
      socket.on("message", (data) => {
        if (!authenticated(request)) {
          if (owner === socket) clear();
          socket.close(1008, "Sign in again");
          return;
        }
        let parsed;
        try {
          parsed = laserCommandSchema.safeParse(JSON.parse(data.toString()));
        } catch {
          socket.close(1008, "Invalid pointer");
          return;
        }
        if (
          !parsed.success ||
          (parsed.data.pointer && parsed.data.pointer.sceneId !== liveSceneId())
        ) {
          socket.close(1008, "Invalid pointer or inactive scene");
          return;
        }
        const pointer = parsed.data.pointer;
        if (!pointer) {
          if (owner === socket) clear();
          lastUpdate = 0;
          return;
        }
        const now = Date.now();
        if (now - lastUpdate < LASER_INTERVAL_MS) return;
        lastUpdate = now;
        owner = socket;
        clearTimeout(expiry);
        expiry = setTimeout(clear, LASER_TIMEOUT_MS);
        broadcast({ type: "laser.updated", pointer });
      });
      const remove = () => {
        controllers.delete(socket);
        if (owner === socket) clear();
      };
      socket.on("close", remove);
      socket.on("error", remove);
    },
  );
  app.addHook("preClose", async () => {
    clear();
    for (const socket of controllers) socket.terminate();
  });
  return { clear };
}
