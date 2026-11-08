# Global audio library

Approved behavior: a server-owned collection of music, ambience and effects; explicit
Add to session creates independent local copies. Preview plays without saving or
changing music/ambience. Session media can be added to the global library. Copies
include soundboard groups, built-in icons and custom image icons. Repeated copies
reuse identical existing assets and preserve existing local metadata. Global deletes
and renames do not affect sessions. Save As includes only session-owned media.

Implementation decisions:
- Separate SQLite catalog and media directory, default sibling `global-library` next
  to DATA_DIR. GLOBAL_LIBRARY_DIR overrides it; custom roots must already exist.
  Lazily open it so unavailable global storage does not prevent session startup/playback.
- Reuse current asset/soundboard schemas in a separate two-table database with its own
  migration. No session migrations or external references in session records.
- Validate and copy original bytes; hash for duplicate recognition, publish files
  exclusively, then commit metadata together. Serialize transfers with session media
  edits. Reject overlapping session/global roots and symlinks.
- Authenticated, generation-scoped admin endpoints below. Preview files are private,
  support byte ranges, and streams close at session switches/server shutdown.

API contract (shared/global-library.ts):
- GET /api/admin/global-library -> { assets: Asset[] }
- POST /api/admin/global-library/from-session/:id -> { asset: Asset, reused: boolean }
- POST /api/admin/global-library/:id/add-to-session -> same response
- PATCH /api/admin/global-library/:id with { name } -> Asset
- DELETE /api/admin/global-library/:id -> 204
- GET /global-media/:id?session=<generation> -> authenticated media stream

Tasks:
1. Backend/storage tests: repeated and concurrent transfers, original-session reuse,
   independence on delete/rename/clear, group/icon copies, preview privacy/ranges,
   portable Save As and reopen with missing global storage, unavailable-path recovery.
   Implement global catalog, service, routes and app wiring.
2. Frontend/audio: Session and Global library selector; Add to global library,
   Preview/Stop preview, Add to session, Rename/Delete global with deletion confirmation,
   errors/retry and loading feedback. Preview uses existing enable/volume/Stop all/dispose
   lifecycle; only one preview, no music/ambience interference. Refresh local assets
   after adding. Guard late responses/session transitions. Add audio engine tests.
3. Integration: isolated Playwright workflow for promote, preview without import,
   explicit add, repeated-add dedup, soundboard metadata, and session switch cleanup.
   Document storage/configuration/portability. Run build, unit suite and E2E; visually
   inspect desktop layout. Review portability, private media and transfer failures.

No publishing/merge is requested for this feature yet. Preserve all user data.

Completed verification (2026-11-08): production build/typecheck, 220 unit/API
tests, and all 12 Playwright workflows pass on macOS. Desktop screenshot inspected.
Browser tests use isolated temporary sessions/global storage. Review fixes included
the development preview proxy and fresh local IDs after deletion (existing copies
still deduplicate by content). Native Windows and speaker-output checks remain manual.
