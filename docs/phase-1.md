# Phase 1: basic presentation

The design brief is AGENTS.md. The first vertical slice delivers saved image scenes, a private GM editor, and a read-only player display. Audio, text, and loot remain subsequent phases.

## Design decisions

- One Fastify server serves the production Vite build, REST, media, and WebSockets. Development uses Vite's proxy. Bind to loopback by default; opt into LAN explicitly.
- SQLite with Drizzle tables and versioned SQL migrations stores scenes, objects, assets, and the active scene. Object transforms and visibility save immediately; UI selection never persists. Selecting a prepared scene does not put it on air; Present does.
- A configured GM password is scrypt-hashed in memory at startup. Random expiring session tokens use HttpOnly, SameSite=Strict cookies; tokens are stored as hashes and cleared on restart. Authenticated mutations require a same-origin Origin header. Login attempts are rate limited.
- Public snapshots and incremental object updates are constructed from a strict public projection. Hidden objects and scene names never enter player messages. Media requests recheck whether the asset is currently public. Sockets are read-only; authenticated REST mutations are authoritative.
- A 1920 × 1080 shared Konva stage fits each viewport. Hidden sprites are half opacity in the editor. Transform handles preserve image proportions. Drag requests are throttled to 20 Hz and serialized, with final coordinates saved.
- Uploaded PNG/JPEG/WebP/GIF images retain original bytes and use server-generated filenames. Directory scans only access the configured media directory, skip symbolic links, and validate file signatures. No arbitrary paths are accepted from the browser.
- Compact dark Mantine controls follow the requested left library / center canvas / right inspector arrangement. No generated decoration or external assets are needed for this functional development milestone.

## Implementation plan

1. [x] Shared validated contracts, SQLite migration, and public projection. Tests: hidden data omitted, coordinates validated, restart persistence.
2. [x] Authentication, scene/object API, media upload and scanning. Tests: authorization, cross-origin rejection, file validation, hidden asset access, invalid IDs.
3. [x] Public WebSocket snapshots and incremental updates. Tests: reveal, movement, hide, multiple observers, reconnect, no mutation channel.
4. [x] Mantine editor, shared canvas, Zustand state, player reconnection. Browser tests: login, scene creation, image import, background, add/transform/reveal/hide sprite, refresh, player sizing.
5. [x] Production build, README, final security and usability review. Run typecheck, all tests, build, and browser workflow.

## Review focus

Failed saves must show feedback without dropping queued work. Asset requests must remain private even when IDs are known. Symlinks and path traversal must not escape the media root. Reconnection must replace stale state. Prepared scene selection must not unexpectedly change the player display.

## Result

Phase 1 is implemented. Verification and remaining manual checks are recorded in `docs/verification.md`. No Git repository existed at the start; files were developed in place, with no branch or commit created.
