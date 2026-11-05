import { afterEach, expect, test, vi } from "vitest";
import { prepareSessionTransition } from "../src/client/features/sessions/transition.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  const state = {
    drafts: {} as Record<string, string>,
    pending: 0,
    saveFailed: false,
    audioBusy: false,
  };
  const saveAudio = vi.fn(async () => true);
  return {
    state,
    saveAudio,
    guard: {
      drafts: () => state.drafts,
      pending: () => state.pending,
      saveFailed: () => state.saveFailed,
      audioBusy: () => state.audioBusy,
      saveAudio,
    },
  };
}

test("explicit drafts block switching without attempting to save or discarding them", async () => {
  const { state, saveAudio, guard } = fixture();
  state.drafts = { content: "text and loot" };
  await expect(prepareSessionTransition(guard)).rejects.toThrow(
    "text and loot",
  );
  expect(saveAudio).not.toHaveBeenCalled();
  expect(state.drafts.content).toBe("text and loot");
});

test("switching waits for queued writes, then flushes the latest audio settings", async () => {
  vi.useFakeTimers();
  const { state, saveAudio, guard } = fixture();
  state.pending = 2;
  let finished = false;
  const pending = prepareSessionTransition(guard).then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  expect(saveAudio).not.toHaveBeenCalled();
  state.pending = 0;
  await vi.advanceTimersByTimeAsync(50);
  await pending;
  expect(finished).toBe(true);
  expect(saveAudio).toHaveBeenCalledOnce();
});

test("failed autosaves or preference saves prevent switching", async () => {
  const { state, saveAudio, guard } = fixture();
  state.saveFailed = true;
  await expect(prepareSessionTransition(guard)).rejects.toThrow(
    "Some edits are unsaved",
  );
  expect(saveAudio).not.toHaveBeenCalled();
  state.saveFailed = false;
  saveAudio.mockResolvedValue(false);
  await expect(prepareSessionTransition(guard)).rejects.toThrow(
    "Audio settings could not be saved",
  );
});

test("drafts appearing while autosaves flush are checked again", async () => {
  const { state, saveAudio, guard } = fixture();
  saveAudio.mockImplementation(async () => {
    state.drafts = { grid: "grid settings" };
    return true;
  });
  await expect(prepareSessionTransition(guard)).rejects.toThrow(
    "grid settings",
  );
});
