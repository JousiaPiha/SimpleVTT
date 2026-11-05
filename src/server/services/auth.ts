import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { loginSchema, passwordSetupSchema } from "../../shared/contracts.js";
import { resolvePasswordHash, type PasswordHash } from "./password.js";
import { loadAdminPassword, saveAdminPassword } from "./startup-password.js";

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
  password: string | PasswordHash | null,
  secureCookie: boolean,
  passwordFile?: string,
) {
  let credential = password === null ? null : resolvePasswordHash(password);
  let settingUp = false;
  const sessions = new Map<string, number>();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const authenticated = (req: FastifyRequest) => {
    if (!credential) return false;
    const token = req.cookies.session;
    if (!token) return false;
    const key = digest(token);
    const expiry = sessions.get(key);
    if (expiry && expiry > Date.now()) return true;
    sessions.delete(key);
    return false;
  };
  const signIn = (req: FastifyRequest, reply: FastifyReply) => {
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
    return { authenticated: true, setupRequired: false };
  };
  app.post(
    "/api/auth/setup",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!sameOrigin(req))
        return reply.code(403).send({ error: "Same-origin request required" });
      if (credential)
        return reply
          .code(409)
          .send({
            error:
              "An administrator password is already configured. Sign in instead.",
          });
      if (settingUp)
        return reply
          .code(409)
          .send({
            error: "Password setup is already in progress. Please wait.",
          });
      if (!passwordFile)
        return reply
          .code(503)
          .send({ error: "Password setup is not configured on the server." });
      const { password: chosen } = passwordSetupSchema.parse(req.body);
      settingUp = true;
      try {
        credential = await saveAdminPassword(passwordFile, chosen);
        return reply.code(201).send(signIn(req, reply));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          // Another server may have completed setup against the same machine file.
          credential = await loadAdminPassword(passwordFile);
          return reply
            .code(409)
            .send({
              error:
                "An administrator password is already configured. Sign in instead.",
            });
        }
        req.log.error(
          error,
          "Could not save administrator password configuration",
        );
        return reply
          .code(500)
          .send({
            error:
              "Could not save the administrator password. Check configuration folder permissions on the server and try again.",
          });
      } finally {
        settingUp = false;
      }
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!sameOrigin(req))
        return reply.code(403).send({ error: "Same-origin request required" });
      if (!credential)
        return reply
          .code(409)
          .send({ error: "Set an administrator password first." });
      const { password: candidate } = loginSchema.parse(req.body);
      const salt = Buffer.from(credential.salt, "hex");
      const hash = Buffer.from(credential.hash, "hex");
      if (!timingSafeEqual(hash, scryptSync(candidate, salt, 64)))
        return reply.code(401).send({ error: "Incorrect password" });
      return signIn(req, reply);
    },
  );
  app.get("/api/auth/session", async (req) => ({
    authenticated: authenticated(req),
    setupRequired: credential === null,
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
