import { afterEach, expect, test, vi } from "vitest";
import {
  api,
  json,
  setSessionGeneration,
  mediaUrl,
} from "../src/client/api.js";
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionGeneration(null);
});
test("bodyless mutations do not advertise a JSON body", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await api("/delete", json("DELETE"));
  await api("/logout", json("POST"));
  for (const [, options] of fetch.mock.calls)
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
});
test("tags requests and media and rejects a response from an old session", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(
    (_path: string, _options: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  setSessionGeneration("first");
  const pending = api("/api/admin/scenes");
  const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
  expect(
    new Headers(fetch.mock.calls[0][1]?.headers).get("X-SimpleVTT-Session"),
  ).toBe("first");
  expect(mediaUrl("same-id")).toBe("/media/same-id?session=first");
  setSessionGeneration("second");
  finish(new Response("[]"));
  await rejected;
  expect(mediaUrl("same-id")).toBe("/media/same-id?session=second");
});
