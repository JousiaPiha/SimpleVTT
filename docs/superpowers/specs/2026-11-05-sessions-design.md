# Portable Sessions

Status: approved for implementation on 2026-11-05, including recovery when Default Session is unavailable.

## Intent and agreed behavior

The DM can prepare a session on one computer, close it, copy its folder via a thumb drive or cloud storage, and open it in another SimpleVTT installation. Linux, macOS, and Windows must share one session format. A Session contains multiple scenes; the existing Scene concept remains unchanged.

The user has agreed to:

- Start the application in the persistent **Default Session** every time. Restarting does not reopen the last named session or clear the default draft.
- **Save Session As** copies the current session into an empty folder and makes that copy active. The previous session retains its last saved contents.
- Refuse Save As into any non-empty destination. This restriction does not apply to autosaving edits in the active session.
- **Open Session** validates an existing session folder and switches to it. Edits persist automatically in that folder.
- **Close Session** finishes pending saves, releases the named session, and returns to Default Session.
- Allow clearing Default Session and saving a draft from it into a named session.
- Use a folder browser inside SimpleVTT, with a path field, browsing the server computer's filesystem.
- Keep the player display blank after opening a session until the DM explicitly presents a scene.
- Provide a server-specific environment setting for the picker's default location; handle missing/moved folders and unmounted drives.

## Approaches and chosen direction

The folder-selection alternatives discussed were an in-app folder browser with a path field and a path field alone. The user chose the browser plus path field for convenience. The browser talks to the Node server; it does not depend on native browser filesystem permissions or a desktop GUI bridge.

Direct operation in the chosen folder follows the agreed autosave behavior. Keep the existing SQLite/filesystem architecture and switch the active storage context. An import/export-only working copy would not provide the agreed in-place editing semantics. No desktop wrapper, cloud service, or second database technology is needed.

The following sections propose concrete defaults to complete that design. They are implementation recommendations, not additional decisions already made by the user.

## Session contents and format

A named session owns:

- Every scene, image object, text/loot entry, drawing, grid, transformation, visibility setting, and layer order.
- The entire indexed media library, including assets currently unused by scenes, downloaded audio, and custom soundboard icons.
- Playlists, soundboard assignments/groups/icons, and saved audio preferences.

Passwords, login tokens, listening address/port, tool executable locations, the default-session location, and folder-browser preferences stay on the server computer. Audio playback position, active playback, laser pointers, and temporary editor state do not travel with the session.

Proposed folder layout:

```text
The Sunken Temple/
  session.json
  simple-vtt.sqlite
  media/
```

The manifest identifies SimpleVTT, the session ID, display name, and session format version. The folder name supplies the initial display name. Save As creates a new session ID while retaining scene/asset IDs and relationships. A copied closed folder retains its identity; runtime isolation must not rely on the persistent ID being globally unique among copies.

Store only relative media references. Named sessions use portable managed filenames derived from stable IDs and verified media extensions, with a consistent relative-path representation. Preserve file bytes and user-facing asset names. Save As copies and normalizes the entire indexed library, including legacy scanned files and files in an external MEDIA_DIR, into the destination's own media folder. Do not copy unrelated files, backups, secrets, unfinished imports, or installation files.

The existing directory-scan feature must continue to work. When scanning into a named session, incorporate files into its managed portable naming scheme, keeping IDs/references consistent and avoiding repeated indexing. Changes to files already inside the session's owned media directory may rename them without altering bytes; never rename or delete external source files as a side effect of Save As. Unindexed files are not promised to transfer through Save As.

Reject unsupported newer session versions with an actionable message. Version 1 need not upgrade arbitrary legacy data folders through Open Session: current installations become Default Session, and Save As produces the portable format. Future supported upgrades must validate and retain a recoverable pre-upgrade database before mutation.

## Default Session and configuration

The existing DATA_DIR remains the Default Session's storage location, preserving current user data without moving or clearing it on upgrade. A legacy default folder without a manifest is recognized only through this configured startup location, not as an arbitrary valid folder in Open Session.

MEDIA_DIR can continue serving the legacy/default session. Named sessions always use their own media directory and ignore this machine-specific override. Clear Default Session removes session records and owned media after confirmation, but never recursively erases DATA_DIR, unrelated files, backups, or an external MEDIA_DIR. An external media collection remains on disk; clearing removes its library references. Make this distinction visible in the clear confirmation when relevant.

Use **SESSIONS_ROOT** for the new picker preference. The name refers to Sessions, which contain Scenes.

- It is an initial browsing location, not a filesystem sandbox, default-session relocation, or automatic session selection.
- A configured usable SESSIONS_ROOT takes priority when a new picker dialog opens. Navigation within the open dialog remains at the location selected by the DM.
- If unset, start at the current session folder. If that is unavailable, try the server working directory, then the server user's home directory. If none is readable, leave the path field available with an explanatory error.
- If configured but missing, not a directory, or unreadable, show a non-blocking explanation and use the same fallback chain. Keep the configured value unchanged and recheck it next time so remounting a drive restores the preference.
- Never create a missing SESSIONS_ROOT automatically. In particular, do not create a directory where a missing drive used to be mounted.
- Recommend an absolute path. Relative configuration values resolve against the server working directory, matching other server path settings. Do not execute or interpolate shell expressions supplied through the browser.
- A read-only folder can be browsed; selection for Save As or Open must satisfy the operation's write requirements.

Examples: `SESSIONS_ROOT=/home/alex/RPG/Sessions`, `/Users/alex/RPG/Sessions`, or `D:\RPG\Sessions`, configured through the appropriate launcher/server environment. Configuration is read by the server, never stored in a portable session.

## Folder browser

Use authenticated administrative directory-listing endpoints. Return names, paths, folder status, and navigation information; do not provide a generic file-content endpoint. Players cannot use these endpoints. Mutations retain existing same-origin checks.

Provide an editable absolute path field, folder list, Up, Home, available-location shortcuts, and New Folder. Label the location as the server computer's filesystem. Linux/macOS mount points and Windows drives are the small platform-specific part; use Node path/filesystem APIs for normal navigation. Mount discovery is best-effort and must not prevent navigation by path. The app does not mount drives or log into network shares.

New Folder creates only the explicitly named child of an existing selected parent, without overwriting anything. A missing path entered by the user is an error, not permission to recursively create a directory tree. Folder selection validates again at execution time because a folder can change after being displayed. Treat hidden files as contents for Save As; an apparently empty folder containing hidden entries is not empty.

Canonicalize selected paths and handle symlinks consistently. Following a directory shortcut for navigation is allowed, but the canonical target must be displayed/validated. Session database, manifest, and media files may not redirect outside the session through symlinks. Reject a Save As destination inside the source session, its media tree, or an active temporary operation; avoid recursive copies and shared storage.

## Operation behavior

### Save Session As

Before copying, finish acknowledged client edits and server writes and verify the source assets are present. Reserve/recheck an empty destination and stage a consistent database snapshot plus the media files. Revalidate that the destination has not acquired unrelated entries before publishing the result. Do not overwrite anything another process created.

Use a SQLite-aware snapshot, not a raw copy of an open database file. Prevent session mutations while the combined database/media snapshot is being made, so copied metadata and bytes describe the same state. Provide progress for large libraries and use an operation-status mechanism that survives the existing 15-second HTTP request timeout and a dashboard reload.

Only mark the destination as a valid completed session after copying and validation finish. Do not switch until it can be opened. On failure retain the current session, explain the error, and remove only files demonstrably created by this operation when safe. If cleanup cannot finish, identify the incomplete destination; do not present it as a successful save or recursively delete the destination. Interrupted copies must not be accepted as valid sessions.

On success switch to the new session, reset client state, and leave the player display blank. The source's saved content remains unchanged. This brief presentation/audio interruption is an explicit proposed behavior for Save As, consistent with other session switches.

### Open Session

Open requires a recognized manifest/version, a valid application database and structured data, consistent references, and all indexed media present as contained readable regular files. Check filesystem permissions needed for editing. Do not auto-create a missing database or media tree while validating. Report actionable errors such as an incomplete transfer, missing asset, unsupported version, permission denial, or a session already open elsewhere.

Validate before changing the current session or player display. On success make the folder active, clear the old editor state, stop old audio and clear its media caches, and send players a blank snapshot. A previously presented scene must not automatically become live merely because its ID was saved in the database. The DM can select a scene privately, then explicitly present it.

Opening the exact active canonical folder is a no-op. Opening an independent folder copy is a real switch even if persistent IDs match.

### Close Session

Stop new edits, finish pending saves, stop audio, release media/file streams and the session database, checkpoint as needed, and release the session lock. Return to Default Session with a blank player display. Report completion only once the named folder's handles are released and its saved state is ready for transfer. Close while already on Default Session is disabled/no-op.

### Clear Default Session

Offer this action while Default Session is active. Require a confirmation identifying what will be cleared. Reset its scenes, indexed assets, playlists, soundboard, audio preferences, and live state. Preserve machine configuration, all named sessions, and files the application does not own. Use a failure-safe staged reset; errors must not be reported as a successful clear.

### Startup and reconnect

Startup always opens Default Session and starts with a blank player display. This intentionally changes the previous behavior of restoring the saved live scene on a server restart. Refreshing/reconnecting a player while the server remains running still restores the server's current public scene, so ordinary connectivity loss does not require presenting again.

If Default Session cannot be opened, keep authentication and the dashboard available in a no-active-session recovery state. Explain the error, keep players blank, and allow opening a valid named session. Closing a named session still releases it even if returning to Default Session fails. Never silently replace corrupt or unavailable default storage with a fresh session.

## Pending work and session isolation

Existing explicit Save/Apply controls for text, loot, playlists, and grid drafts remain. Session autosave means persisted edits always go to the active session; it does not silently publish unfinished form drafts. Before Open, Save As, Close, or Clear, require the DM to save/apply or discard those drafts. Wait for queued autosaves; a failed save prevents the switch and leaves the draft/error visible. Do not silently drop drafts or declare them saved.

Uploads, directory scans, and online imports must not finish into a different session. Version 1 blocks session-changing operations while these tasks are active and directs the DM to finish them or use their existing cancellation controls. Routine session switching does not introduce automatic downloading or audio playback.

Create a lightweight active-session owner around the current store, media service, and online-import service. Keep authentication and the Fastify server independent of the active session so switching does not require a process restart or change the password.

Serialize transitions and drain in-flight operations. Add an opaque runtime generation to administrative operations and media URLs so late requests, stale tabs, copied asset IDs, and browser/audio caches cannot cross session boundaries. Session changes must invalidate stale mutations before they can touch the new store. Reset client stores and accept only responses for the active generation. Player transitions use full snapshots and preserve the existing server-side privacy projection.

Hold an exclusive session ownership lock while using a folder. Refuse a second writer; release ownership on close and orderly shutdown. Crash recovery must distinguish a dead local owner from a live one and never silently steal an active lock. This is local ownership protection, not a distributed cloud lock.

## Unavailable drives and portability boundaries

There are two different situations:

1. **Picker preference becomes unavailable:** show the reason and fall back for browsing. The active session is unchanged.
2. **Active session storage becomes unavailable or writes fail:** report that saving has stopped, stop accepting further persistent mutations, and retain available UI/draft information. Never quietly switch the save target, recreate the old mount path, or claim edits were saved. Recovery is explicit after the original storage becomes available and is revalidated; do not automatically replay uncertain writes. The UI must also allow an explicit return to Default Session with an unsaved-changes warning if recovery is impossible. Do not claim the unavailable folder is safe to transfer after a failed flush.

Copy/sync a session after Close Session reports completion. Open and edit it on only one computer at a time. Cloud storage is a transfer mechanism in version 1, not concurrent synchronization or conflict merging. A local fully downloaded cloud-folder copy or mounted local removable drive is supported subject to normal filesystem capabilities; remote/network-backed live SQLite storage is not a supported deployment target. Detection may be best-effort, so document this limitation rather than pretending to identify every filesystem type.

## Verification required before shipping

- Save As copies complete default and named sessions, preserves source data, switches autosaves, and survives a restart with Default Session selected.
- Non-empty targets (including hidden entries), nested targets, missing drives, permission errors, full disk, interrupted copies, and destination races do not overwrite unrelated data or produce false success.
- Invalid manifests, newer versions, corrupt databases, broken references, missing files, and escaping links leave the current session and presentation untouched.
- Open, Save As, Close, Clear, and startup leave players blank; explicit Present works afterward; reconnect within a running session restores the current public snapshot.
- Late client requests, outstanding media work, stale tabs, and same-ID folder copies cannot write or serve media across contexts. Hidden assets and filesystem information remain inaccessible to players.
- Pending autosaves and explicit form drafts are handled without silent loss. Old audio/resources stop on a successful transition; failed validation does not disrupt the current session.
- SESSIONS_ROOT unset, usable, missing, moved, unreadable, read-only, and restored after remount. Existing data is never moved merely by configuring it; manual path navigation remains available.
- Close releases database/media handles and produces a complete portable folder. A second live writer is rejected and local stale locks are handled safely.
- Integration tests on Linux and macOS and a Windows test path/CI run, including drive roots, spaces, Unicode, filename rules, case differences, media imported by scanning, and direct folder transfer between platforms.

## Scope and builder discretion

No implementation begins until the user approves this design. Exact endpoint names, manifest field spelling, module layout, lock/staging mechanisms, progress presentation, and drive-discovery methods are left to the implementer within these behavioral guarantees. Keep dependencies minimal and prefer the existing stack.

Outside this feature: cloud APIs, automatic synchronization, collaboration/conflict merging, archive export, general file management, session deletion/rename tools, native desktop packaging, and changes to game mechanics.

## Technical references

- [SQLite backup API](https://www.sqlite.org/backup.html): database snapshot support for Save As.
- [SQLite WAL documentation](https://www.sqlite.org/wal.html): checkpoint/sidecar lifecycle and filesystem constraints.
- [Browser directory picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): browser-local handles and compatibility constraints behind the server-backed picker choice.
- [Node path documentation](https://nodejs.org/api/path.html#windows-vs-posix): platform-specific path handling.
