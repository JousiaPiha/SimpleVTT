import type { z } from "zod";

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
  const response = await fetch(path, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      ...(options.body == null || options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
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
  return schema ? schema.parse(value) : (value as T);
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const mediaUrl = (id: string) => `/media/${encodeURIComponent(id)}`;
