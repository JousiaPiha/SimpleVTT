import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { loginSchema } from "../../shared/contracts.js";

const SESSION_SECONDS = 12 * 60 * 60;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sameOrigin(request: FastifyRequest): boolean {
  if (!request.headers.origin) return false;
  try {
    const origin = new URL(request.headers.origin);
    return (
      origin.origin ===
      new URL(`${request.protocol}://${request.headers.host}`).origin
    );
  } catch {
    return false;
  }
}
export async function registerAuth(
  app: FastifyInstance,
  password: string,
  secureCookie: boolean,
) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  const sessions = new Map<string, number>();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const authenticated = (req: FastifyRequest) => {
    const token = req.cookies.session;
    if (!token) return false;
    const key = digest(token);
    const expiry = sessions.get(key);
    if (expiry && expiry > Date.now()) return true;
    sessions.delete(key);
    return false;
  };
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!sameOrigin(req))
        return reply.code(403).send({ error: "Same-origin request required" });
      const { password: candidate } = loginSchema.parse(req.body);
      if (!timingSafeEqual(hash, scryptSync(candidate, salt, 64)))
        return reply.code(401).send({ error: "Incorrect password" });
      for (const [key, expiry] of sessions)
        if (expiry <= Date.now()) sessions.delete(key);
      if (req.cookies.session) sessions.delete(digest(req.cookies.session));
      const token = randomBytes(32).toString("hex");
      sessions.set(digest(token), Date.now() + SESSION_SECONDS * 1000);
      reply.setCookie("session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: secureCookie,
        maxAge: SESSION_SECONDS,
      });
      return { authenticated: true };
    },
  );
  app.get("/api/auth/session", async (req) => ({
    authenticated: authenticated(req),
  }));
  app.post("/api/auth/logout", async (req, reply) => {
    if (!sameOrigin(req))
      return reply.code(403).send({ error: "Same-origin request required" });
    if (req.cookies.session) sessions.delete(digest(req.cookies.session));
    reply.clearCookie("session", { path: "/" });
    return { authenticated: false };
  });
  return authenticated;
}
