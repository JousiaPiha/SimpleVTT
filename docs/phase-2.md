# Phase 2: GM audio

## Design

Implement the audio milestone in AGENTS.md, continuing the user's approved development sequence. Preserve Phase 1 scenes and media. Audio plays exclusively through an application-level browser engine in the GM view; no playback commands, track references, or playlists enter player synchronization.

Use native HTMLAudioElement + MediaElementAudioSourceNode for music and ambience, category GainNodes and a master GainNode. Decode only bounded short effects into a cached AudioBuffer; new source nodes allow overlapping/repeated effects. A user gesture enables AudioContext. Reload and sign-out stop playback; scene/panel changes do not. Crossfades remain optional future work.

Extend the existing asset library with music, ambience and effect categories; allow MP3/WAV/Ogg/FLAC/M4A by verified signatures with browser codec errors surfaced. Stream large uploads to disk, enforce 256 MiB audio / 32 MiB images, and support single HTTP byte ranges for seeking. Directory scanning infers categories from music/ambience/effects subfolders. Audio assets must never be usable as a scene background or sprite, including through direct API calls, and media remains admin-only.

Persist playlists with ordered track references and audio preferences in SQLite migrations. A playlist accepts any audio asset but is used in the music player. Preferences contain master/category volumes, music loop/shuffle and per-ambience levels. Persist settings only, never restore audible playback. A compact collapsible bottom panel keeps the scene editor and transport accessible. Keep image library controls and the audio library distinct views of the same assets.

## Contracts

Shared `audio.ts`: Playlist { id, name, trackIds }, PlaylistInput { name, trackIds }; AudioPreferences { volumes: { master, music, ambience, effects }, musicLoop, shuffle, ambienceVolumes }. Each volume is 0..1. Audio asset categories: music, ambience, effect.

Admin endpoints: GET/POST /api/admin/playlists; PUT/DELETE /api/admin/playlists/:id; GET/PUT /api/admin/audio-preferences. Assets API accepts the expanded categories and rejects mismatched media. GET /media/:id supports ranges after authorization. No changes to public presentation contracts.

## Plan

1. [x] Extend shared contracts; write tests for playlist/settings validation.
2. [x] Backend: additive migrations, playlist/preferences persistence, streamed imports, scanning, private ranged audio, image-only scene validation. Regression tests include restart/migration and unauthenticated access.
3. [x] Browser engine: enable gesture, music transport/queue/loop/shuffle, independent ambience, overlapping cached effects, volume routing, cancellation and resource cleanup. Tests cover races, failures, and independence.
4. [x] UI: bottom audio panel, private asset browser/import, playlist editing and persistence, volume controls, errors and feedback. No playback on load or panel expansion.
5. [x] Full tests, strict typecheck, production build, real browser audio-state workflow, independent review, documentation and updated preview with existing data preserved.

## Review focus

Slow media loads must not restart stopped playback. Multiple rapid effects must overlap without unbounded caching. Scene changes and collapsed panels must not destroy the engine. Sign-out must stop every category. Failed settings/playlist saves must remain visible and not claim persistence. Hidden/private audio must not be retrievable by player devices.

## Verification

50 Vitest tests and both Chromium end-to-end workflows pass, alongside strict TypeScript checking and the production build. Audio checks cover real native media playback state, concurrent music/ambience, overlapping effects, scene/panel independence, saved playlists/volumes, no autoplay on reload, sign-out cleanup, and denied player audio requests. Backend tests cover additive migration/restart persistence, signatures, upload limits, byte ranges, private assets, and atomic playlist validation.

Independent review found premature shuffle termination and a preferences-save/sign-out race. Both were reproduced and fixed with regression tests; a focused follow-up review confirmed resolution. Browser checks also caught missing slider thumb labels, now fixed. Screenshots were inspected at 1440×900 and 1280×720.

Actual speaker output, other browsers/codecs, and physical LAN devices remain manual checks. No crossfade implementation is claimed. The existing preview database was backed up before applying the additive audio migration.
