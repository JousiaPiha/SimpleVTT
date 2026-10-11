# Phase 3: Text and loot implementation plan

> Execute tasks with the existing native workflow and focused parallel agents. The approved project brief is AGENTS.md; the user requested continuing basic functionality before soundboard icons.

**Goal:** Prepare, persist, position, edit and independently reveal text overlays and loot lists in scenes, with reusable content across scenes.
**Architecture:** Add typed scene content alongside image objects. Store validated JSON payloads in a scene-owned SQLite table with cascading deletion; use explicit public projections and incremental content patches. Use the shared Konva renderer for both displays and an editor panel for content. No new dependencies, player interactions, or audio changes.
**Spec:** AGENTS.md sections 5, 9, 10, 19.

## Contracts and ownership

- Root: `src/shared/content.ts`, contracts integration, editor store/UI, browser tests, documentation.
- Backend worker: server storage/routes/projection, additive migration, tests. REST `/api/admin/scenes/:id/content` POST and `/:contentId` PATCH/DELETE. All return validated content. GET scene includes content. A content-copy UI uses normal creation with copied properties, hidden by default.
- Canvas worker: shared canvas content rendering/direct positioning, mixed object/content layer order. Props `selectedContentId`, `onSelectContent`, `onPatchContent`. Text/loot remain separate from image objects to preserve existing references.

## Tasks

- [x] Shared discriminated text/loot contracts and validation tests. Admin items contain id, sceneId, name, visible and presentation fields; public projection omits administrative fields and all hidden entries.
- [x] Additive content table, CRUD, runtime validation, persistence, public snapshots/diffs and authorization. Tests: hidden secrets never in HTTP/socket messages, reveal/update/hide/delete, scene cascade and restart, invalid payloads, no regression to images/audio.
- [x] Shared canvas: text styling, panel option, bounded loot with GM-controlled pages of four items; hidden content half opacity, draggable logical coordinates, selection feedback, consistent z-order. Text is plain text, never HTML. Long text fits a bounded box; editor warns on overflow.
- [x] Editor: Text & loot panel; create/edit/delete, explicit save for drafts; immediate saved reveal/hide, position controls and canvas drag. Loot item name/quantity/description, pagination, copy saved content from another scene. Preserve drafts while toggling panels; show failed saves without claiming success.
- [x] Verify unit/integration tests, strict build, complete browser workflows, independent review. Back up persistent `data` before restart and preserve existing content. Update README.

## Review focus

Never leak unrevealed content. Incremental removal and reconnect must converge. Late requests must not overwrite newer edits or the selected scene. Draft text must not reach players until saved; hiding must not publish an unsaved draft. Long loot lists must remain bounded and pageable. Audio must keep playing while editing content.

## Verification

Final checks: **66 Vitest tests passed**, **3 Chromium browser workflows passed**, strict typecheck and production build passed. New coverage includes schema bounds, scene-owned CRUD, hidden text/loot absent from HTTP and WebSocket data, incremental convergence/reconnection, persistence and additive migration, coalesced content movement, failed-save recovery, fresh-source copying and target-scene races. Browser checks exercised drafts versus saved reveals, logical-canvas dragging, rendered player pixels, four-item loot pages, stale-page correction, reuse, refresh, and deletion. Existing sprite and audio workflows still pass. Screenshots were inspected at 1440×900 and 1280×720.

Independent review found stale loot page controls and cached-source copies; regression checks cover both fixes. Browser testing also exposed an existing shared request helper that labeled bodyless DELETE/POST requests as JSON. It now omits that header when there is no body; browser verification includes deletion and actual sign-out.

Before preview migration, the persistent database was backed up to `data/backups/before-phase-3.sqlite`. Existing media and scene data are preserved. Actual speaker output, additional browser engines/codecs, and physical LAN devices remain manual checks. Unsaved editor drafts are not persisted across browser sessions. Soundboard icons are deliberately deferred in `docs/roadmap.md`.
