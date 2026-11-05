import type { z } from "zod";

let sessionGeneration: string | null = null;
export const getSessionGeneration = () => sessionGeneration;
export function setSessionGeneration(generation: string | null) {
  sessionGeneration = generation;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const scoped =
    path.startsWith("/api/admin/") &&
    !/^\/api\/admin\/session(?:[/?]|$)/.test(path);
  const generation = sessionGeneration;
  const response = await fetch(path, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      ...(generation && path.startsWith("/api/admin/")
        ? { "X-SimpleVTT-Session": generation }
        : {}),
      ...(options.body == null || options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const checkGeneration = () => {
    if (scoped && generation !== sessionGeneration)
      throw new ApiError(
        "The active session changed. Reload before continuing.",
        409,
      );
  };
  checkGeneration();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      details?: string[];
    };
    throw new ApiError(
      body.details?.join("; ") ??
        body.error ??
        `Request failed (${response.status})`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const value: unknown = await response.json();
  checkGeneration();
  return schema ? schema.parse(value) : (value as T);
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const mediaUrl = (id: string) =>
  `/media/${encodeURIComponent(id)}${sessionGeneration ? `?session=${encodeURIComponent(sessionGeneration)}` : ""}`;
