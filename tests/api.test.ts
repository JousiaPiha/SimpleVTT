import { afterEach, expect, test, vi } from "vitest";
import { api, json } from "../src/client/api.js";
afterEach(() => vi.unstubAllGlobals());
test("bodyless mutations do not advertise a JSON body", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await api("/delete", json("DELETE"));
  await api("/logout", json("POST"));
  for (const [, options] of fetch.mock.calls)
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
});
