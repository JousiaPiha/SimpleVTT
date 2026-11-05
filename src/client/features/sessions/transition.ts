import { draftWarning } from "./drafts.js";

interface TransitionGuard {
  drafts: () => Record<string, string>;
  pending: () => number;
  saveFailed: () => boolean;
  audioBusy: () => boolean;
  saveAudio: () => Promise<boolean>;
}

/** Wait only for acknowledged autosaves; never publish explicit form drafts. */
export async function prepareSessionTransition(guard: TransitionGuard) {
  const assertNoDrafts = () => {
    const warning = draftWarning(guard.drafts());
    if (warning) throw new Error(warning);
  };
  assertNoDrafts();
  const limit = Date.now() + 15000;
  while (guard.pending() > 0 || guard.audioBusy()) {
    if (Date.now() >= limit)
      throw new Error(
        "Edits are still saving. Wait for uploads, scans and saves to finish, then try again.",
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (guard.saveFailed())
    throw new Error(
      "Some edits are unsaved. Resolve the save error before changing sessions.",
    );
  if (!(await guard.saveAudio()))
    throw new Error(
      "Audio settings could not be saved. Retry saving them before changing sessions.",
    );
  assertNoDrafts();
}
