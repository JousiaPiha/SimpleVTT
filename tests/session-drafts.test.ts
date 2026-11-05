import { afterEach, expect, test } from "vitest";
import {
  draftWarning,
  useSessionDrafts,
} from "../src/client/features/sessions/drafts.js";

afterEach(() => useSessionDrafts.setState({ drafts: {} }));

test("draft guards track independent forms and clear only their own flags", () => {
  const state = useSessionDrafts.getState();
  state.set("text", "text and loot");
  state.set("playlist", "playlist");
  expect(draftWarning(useSessionDrafts.getState().drafts)).toContain(
    "text and loot, playlist",
  );
  state.set("text", null);
  expect(draftWarning(useSessionDrafts.getState().drafts)).toContain(
    "playlist",
  );
  state.set("playlist", null);
  expect(draftWarning(useSessionDrafts.getState().drafts)).toBeNull();
});

test("draft labels are deduplicated without dropping separately owned drafts", () => {
  useSessionDrafts.getState().set("one", "grid");
  useSessionDrafts.getState().set("two", "grid");
  expect(
    draftWarning(useSessionDrafts.getState().drafts)?.match(/grid/g),
  ).toHaveLength(1);
  useSessionDrafts.getState().set("one", null);
  expect(draftWarning(useSessionDrafts.getState().drafts)).toContain("grid");
});
