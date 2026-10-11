# Media and content deletion

The user requested deleting sounds, images, and text. Build on existing content deletion; add clear row actions for all three.

- Authenticated GET `/api/admin/assets/:id/usage` returns `{sceneCount,backgroundCount,objectCount,playlistCount,trackCount}` for confirmation.
- Authenticated DELETE `/api/admin/assets/:id` removes the library file and metadata, clears background references, removes image objects and playlist entries transactionally, then publishes the changed public scene. Return 204. Missing files may still be removed from the library. Reject unsafe/symlink paths. Stage file rename out of scan visibility before the DB transaction; rollback on failure. Serialize media mutations to prevent scan/import races. If final staged-file cleanup fails, keep it hidden and log it without implying deletion failed after metadata was committed.
- A reusable modal shows usage counts, irreversible effects, and explicit confirmation; cancel makes no change. User media in `data` must not be touched by development tests.
- Editor state removes deleted asset references after success without replacing unrelated pending edits. Audio engine forgets the deleted asset, stops only its playback/loads/effects, removes queue entries and cached buffers. Saved/draft playlists drop the removed ID while preserving other preparation.
- Add Delete actions next to text/loot entries; confirmation captures the intended ID so changing selection cannot delete a different entry. Preserve drafts if deletion fails.
- Tests cover authorization, active/player cleanup, all scene/playlist references, missing file, traversal/symlink denial, failure consistency, no reimport by scan, audio cancellation and independence, and browser cancellation/confirmation/deletion workflows.
- Verify tests/build and independent review, back up persistent data and restart the same preview. Keep soundboard icons deferred.

## Result and verification

Implemented all controls and cleanup. **94 tests pass**, including 16 server deletion regressions and nine audio deletion regressions. **All four Chromium workflows pass**, alongside strict typechecking and the production build. Browser deletion covers usage confirmation, cancel, injected failure/retry, live image/background cleanup, no reimport on scan, text deletion, playlist cleanup, and unrelated ambience continuing after music removal. Existing presentation/content/audio workflows still pass. The confirmation screenshot was visually inspected.

Independent read-only review found no remaining actionable issues. A filesystem regression ensures POSIX literal backslashes cannot alias a different file. Tests cover symlinks, traversal, missing files, database failure restoration, scan/deletion serialization and hidden cleanup remainders. No user media was deleted during development; all destructive tests use temporary test data. The existing persistent database was backed up to `data/backups/before-media-deletion.sqlite` before preview restart. Physical audio output and non-Chromium browsers remain manual checks.
