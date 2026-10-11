import { expect, it } from "vitest";
import { runTool } from "../src/server/services/run-tool.js";

it("passes arguments literally and reads line output", async () => {
  const lines: string[] = [];
  await runTool(
    process.execPath,
    [
      "-e",
      "console.log(process.argv[1])",
      "https://example.com/$(test);foo&bar",
    ],
    { signal: AbortSignal.timeout(5000), onLine: (line) => lines.push(line) },
  );
  expect(lines).toEqual(["https://example.com/$(test);foo&bar"]);
});
it("stops a long-running tool when cancelled", async () => {
  await expect(
    runTool(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      signal: AbortSignal.timeout(100),
    }),
  ).rejects.toThrow("Import stopped");
});
it("reports executable launch errors", async () => {
  await expect(
    runTool("/nonexistent/simple-vtt-downloader", [], {
      signal: AbortSignal.timeout(5000),
    }),
  ).rejects.toThrow();
});
