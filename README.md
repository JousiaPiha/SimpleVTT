# SimpleVTT

A small, local-first presentation workspace for tabletop RPG sessions. The GM prepares scenes in `/admin`; player browsers see a synchronized, read-only display at `/player`.

**Current milestone: Phase 3 — scenes, audio, text, and loot.** Saved scenes, background images, transparent sprites, drag/resize/rotation, layers, reveal/hide, image importing and directory scanning, authenticated administration, and player synchronization are implemented. Music transport and playlists, independent ambient loops, overlapping sound effects, and persistent volume settings are implemented. Saved text overlays and loot lists can be positioned, styled, independently revealed, and copied between scenes.

## Requirements

- Node.js **22.13 or newer** (a current LTS release is recommended), npm, and a modern browser.
- Installation downloads npm dependencies. After installation and building, the application requires no internet connection.
- SQLite uses `better-sqlite3`. If your Node/platform combination has no prebuilt binary, installation requires native build tools (Xcode command line tools on macOS; a C++ compiler and Python on Linux; Visual Studio build tools and Python on Windows).

## Install and run

From this project directory:

```sh
npm install
npm run build
```

Set a non-empty administrator password, then start the server. A longer password is recommended, but there is no minimum length requirement beyond being non-empty:

```sh
# macOS / Linux — enter your own password; do not use a shared example password
export ADMIN_PASSWORD='replace-with-your-own-password'
npm start
```

PowerShell:

```powershell
$env:ADMIN_PASSWORD = 'replace-with-your-own-password'
npm start
```

Open [the administrator](http://localhost:3000/admin). The server listens only on `127.0.0.1` by default. Sessions last 12 hours and require signing in again after a server restart. Changing `ADMIN_PASSWORD` takes effect on restart. No password is saved in the database; startup derives a scrypt hash, and session tokens are stored as hashes in memory.

## Debian / KDE Plasma launcher

Install Node.js **22.13 or newer** and npm first. The launcher also uses `curl`, `flock` (from `util-linux`) and `xdg-open` (from `xdg-utils`). If needed, install these Debian packages with `sudo apt install curl util-linux xdg-utils`. Native dependency builds may also need `build-essential` and `python3`.

From the downloaded/cloned project folder, run once in a terminal as your normal user:

```sh
chmod +x start-debian.sh
./start-debian.sh
```

The launcher asks you to choose and confirm an admin password on first use. It saves it in `~/.config/simple-vtt/launcher.conf`, readable only by your user. If you already set `ADMIN_PASSWORD` in the environment, it uses that value without saving it; add it to the configuration yourself if you want menu launches to use it too. The configuration is a trusted Bash file; quote values containing spaces or shell characters.

On first launch, missing dependencies are installed with `npm ci` (internet required), and a missing production build is generated. Subsequent launches work offline. After pulling code updates, stop the server and run `npm ci && npm run build` before launching again.

The script adds **SimpleVTT** to KDE's application menu under Games, with a blue dice icon, if `~/.local/share/applications/simple-vtt.desktop` does not already exist. It opens a terminal for the server and launches your default browser at the admin dashboard once the server is ready. Keep the terminal open; **Ctrl+C** stops the server. Closing only the browser leaves the server running. Clicking the menu item again opens the dashboard for the existing launcher instead of starting another server for the same data folder.

Edit `launcher.conf` to enable LAN access (`export HOST=0.0.0.0`), change the port or set a data directory. Existing project data in `./data` is used by default. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` are respected. No sudo is needed to run the launcher or create the menu entry. Node/npm must be available in the terminal where you first run it; the menu entry preserves that PATH. If you move the project or change your Node installation, delete the desktop file and run the script again to recreate it.

## Connect a player over LAN

To listen on your LAN interface, set `HOST=0.0.0.0` (or a specific local interface address) before `npm start`. Allow inbound TCP port 3000 on your **private network** firewall. On the player device, open `http://<GM-PC-LAN-IP>:3000/player`; no account is needed. Do not configure router port forwarding or expose this server to the internet.

HTTP on a LAN is **not encrypted**. Use a trusted private network. The built-in server is HTTP; HTTPS/proxy configuration is not implemented in this milestone. Leave `COOKIE_SECURE` false for direct HTTP operation.

## Prepare and present

1. Sign in, enter a scene name, and select **+** to create it.
2. Choose an import category and **Import** one or more PNG, JPEG, WebP, or GIF images (up to 32 MiB each).
3. Use **Background** to fill the scene with an image, or **Add sprite** for a movable object. New sprites are hidden.
4. Drag a sprite to move it; use corner handles to scale and the rotation handle to rotate. Exact coordinates, scale, rotation, and layer order are available in the inspector. Hidden sprites appear at 50% opacity only in the editor.
5. Select **Present scene** to make the selected composition live. Selecting another scene for editing leaves the current live scene on the player display.
6. Toggle **Visible to players**, or use the layer list's **Reveal/Hide** controls. Changes to the active scene reach all connected player displays.
7. **Blank player display** clears the live presentation without deleting scenes.

Use **Grid** below the scene canvas to enable a square overlay, choose its color, and set spacing from 20–400 logical scene pixels (80 by default). Drag the spacing slider for an immediate editor preview, or enter an exact value. Color and visibility changes also preview locally. Click **Apply grid** to save and update players; closing the controls discards the preview. Each scene keeps its own settings; the live player view updates immediately. The grid sits above the background and beneath sprites/text, scales with the scene, and does not snap or restrict movement.

The compact drawing toolbar below the scene offers **Freehand**, **Oval**, **Rectangle**, and **Eraser**, plus color and line width. Drag to draw an outline; releasing saves it with the scene and updates players if the scene is live. Eraser removes a whole stroke or shape when you click or brush over its outline. Drawings sit above the scene; they do not alter images, sprites, or text. Use the arrow tool or **Esc** to return to object editing. Laser, grid and blank-display controls share this bottom row; the **Scene options** (⋯) menu beside Present scene contains Clear background and Delete scene. Private scene drawings remain private until that scene is presented.

Use **Laser pointer** below the canvas while a scene is live. Hold the primary mouse button (or press and hold on a touchscreen) and move on the scene to show a red pointer on every player display. Release or leave the canvas to hide it; press **Esc** or toggle the button off to return to editing. Pointing does not select or move scene objects. The pointer is temporary, clears on scene changes or connection loss, and is never saved with the scene. Refresh both administrator and player tabs after updating the application.


Transform and visibility changes save automatically. A save failure shows an error and attempts to restore the server’s saved state. If the server is unreachable, an unsaved warning remains even after dismissing the error; use **Reload saved state** after reconnecting. The selected object and other temporary interface state are not saved. Destructive scene/object removal asks for confirmation.

Asset and content rows use compact icons: person for **Add sprite**, landscape for **Set background**, eye / crossed-out eye for **Reveal / Hide**, and trash for **Delete**. Hover or focus a button with the keyboard to see its tooltip.

## Delete images, sounds, or text

- **Images:** choose **Delete** on an image in the media library.
- **Sounds:** open **Mixer & library → Library**, then choose **Delete** beside a music track, ambience, or sound effect.
- **Text and loot:** use **Delete** beside an entry in **Text & loot**, or the selected entry's **Remove content** button.

A confirmation appears before anything is removed. For media, it shows how many scenes, image objects, and playlist entries use the file. Confirming permanently deletes the file inside the configured media folder, removes the library entry and all its scene/playlist references, and updates the player display. Scenes and playlists themselves remain. Deleting a sound stops that sound and removes it from the current queue; unrelated audio continues. Deleting scene text/loot removes that entry and its unsaved draft, while copies in other scenes remain independent.

Deleting an asset imported by directory scanning also deletes that file from the configured media directory. Keep originals elsewhere if you need them. A missing media file can still be removed from the library. File permission errors are shown without removing its database references. A failed final filesystem cleanup leaves an unindexed hidden staging file and records the path in server logs; it cannot be served or reimported by scanning.

## Text and loot

1. Choose a scene and open **Text & loot** in the right panel. **Add text** and **Add loot** create saved, hidden entries.
2. Select an entry and edit its display text or loot title, description, and items. Loot items have a name, quantity, and optional description. The **GM content name** is private.
3. Set font size, color, alignment, panel background, and box size, then click **Save content**. Text/content edits are drafts until saved; the canvas and players show the saved version. Drafts remain while switching editor panels or scenes, but are not persisted across browser sessions.
4. Drag content on the canvas or edit its coordinates and layer order. Position, layer, visibility, and loot page changes save immediately. **Reveal/Hide** works on the saved version without publishing an unfinished draft.
5. Loot displays four items per page (up to 100 saved items). Use **Previous loot page / Next loot page** to choose the page on all player displays. Revealing a loot list discloses the whole list to the player client; paging is for readability, not item-level secrecy. Prepare separate hidden lists for separate reveals.
6. Use **Reuse prepared content** to copy saved text or loot from any scene into the current scene. Copies start hidden and can be edited independently.

Text and loot use the same logical canvas and layers as sprites. Hidden content appears at half opacity in the editor and is omitted from player HTTP/WebSocket data. Plain text only; no rich text or HTML. A clipping warning in the editor means the box should be enlarged, the font reduced, or the text shortened. Text/loot share the scene's save and restart behavior. Switching the scene being edited does not change the live player scene until **Present scene** is clicked.

## Audio on the GM computer

1. Expand **Mixer & library** at the bottom of the administrator view.
2. In **Library**, choose Music, Ambience, or Sound effect and **Import audio**. MP3, WAV, Ogg/Opus, FLAC, and M4A files are accepted (up to 256 MiB each); codec support depends on your browser.
3. Click **Enable Audio** once after opening/reloading the administrator. Then play music, start independent ambience loops, or trigger effects repeatedly. Use **Stop all audio** to silence everything immediately.
4. Use **Playlists** to name and save an ordered track list. Music supports pause, stop, previous/next, seeking, queue looping, and shuffle. Without looping, shuffle plays each queue entry once. Starting a library track replaces the current music queue.
5. Use **Ambience** for independent loop volumes and **Soundboard** for one-off effects. Master and category volumes, loop/shuffle preferences, and ambience volumes save automatically. Playlist edits require **Save playlist**.

In **Soundboard**, use the settings button on a sound tile to assign a group and icon, then **Save sound settings**. Type a new group name or select an existing one; clear it to return the sound to **Ungrouped**. Group headings, the group filter, and search help you find effects quickly. Groups disappear when no sounds use them.

Choose from 32 bundled [Lucide](https://lucide.dev/) icons (ISC licensed), select an image from the media library, or **Upload custom icon** (PNG, WebP, JPEG, GIF). Transparent square images work well. Uploaded icons remain in the library if you cancel. Deleting an icon image falls back to the sound's built-in icon. Groups and icons persist across restarts and stay private to the GM; neither editing settings nor filtering interrupts playback. Soundboard groups are assigned manually, independently of filesystem folders.

Audio continues across scene changes and panel navigation, exclusively in the GM browser. Reloading, closing, or signing out stops it; playback never automatically resumes after reload. Players receive no audio assets or playback messages. Browser playback tests check engine/media state; verify actual output through your speakers before a session.

Sound effects are limited to 16 MiB encoded, 120 seconds, and 64 MiB decoded per file; use music/ambience for longer clips. The effect cache, concurrent loading, and overlapping playback are bounded. Unsupported or missing audio produces a visible error. Crossfades are not implemented yet.

## Media and data

The default data directory is `./data`, containing `simple-vtt.sqlite` and `media/`. Uploaded media bytes are preserved with generated filenames. Metadata and stable IDs live in SQLite, not in the scene's filesystem paths.

To import existing collections, copy them into the media directory (including subfolders), then choose **Scan media folder**. Alternatively point `MEDIA_DIR` at a dedicated existing media library. Scanning is recursive, deduplicates paths, skips symbolic links and hidden files/directories, validates file signatures, and ignores unsupported formats. Paths containing `background` are categorized as backgrounds, `sprite` or `character` as sprites, and other images as generic images. For audio, folders named `ambient`/`ambience` select ambience, `effect`/`effects`/`sfx` select sound effects, and other audio defaults to music. Browser input cannot request arbitrary scan paths.

Do not put unrelated private files into the media directory. Missing files produce an unavailable-image indicator in the editor; choose a replacement or re-import the file. Moving an indexed file does not automatically repair its references. GIF imports render as still canvas frames; animation is not supported in Phase 1.

Players receive only the public scene projection and can request only images currently used by its background or visible objects. They receive no GM labels, library listings, hidden objects, or unrevealed asset IDs. Hiding content cannot erase anything a player has already seen or cached.

For a consistent backup, stop the server and copy the data and configured media directories together. Do not commit databases, uploaded media, or passwords to source control.

## Online audio imports

Open **Mixer & library → Library → Import from URL**, choose Music / Ambience / Sound effect with **Import as**, paste a media link, and click **Download audio**. An optional name overrides the source title. One import runs at a time. Progress, errors and cancellation are shown in the panel; closing the panel does not stop the download. Reopen it after a browser reload to see the current job. Completed files appear in the chosen library category and effects appear in the soundboard. Nothing auto-plays.

This optional feature requires [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation), FFmpeg and ffprobe on the server's PATH. FFmpeg distributions generally include ffprobe. Use current versions of these tools; service-side changes can require updating yt-dlp. You may instead set `YT_DLP_PATH` to an absolute executable path and `FFMPEG_DIRECTORY` to the folder containing ffmpeg and ffprobe, which is useful for portable Windows/Linux installations. The UI reports missing tools; check again after installation (dependency results are cached for 30 seconds). No npm dependencies or Python integration are required by SimpleVTT; the selected yt-dlp distribution may need its own runtime. The app supplies its Node runtime to yt-dlp for supported JavaScript-based extractors.

Imports use HTTP/HTTPS media links, download one item (the first entry for playlist-only links), and convert it to a local 192 kbps MP3. Downloads and finished files are limited to 256 MiB; temporary processing storage is capped at approximately 512 MiB and jobs time out after 30 minutes. Live streams are excluded. Support depends on the source service and installed yt-dlp version; login-required or DRM-protected media are not supported by this UI. It does not read browser cookies, user yt-dlp configurations or plugins. Internet is needed only during importing; saved files play offline.

Download jobs are temporary: server shutdown cancels unfinished imports and removes their temporary files. Completed files use the existing private media storage and database. Removing an imported sound uses the ordinary media deletion controls. Source URLs and service credentials are not persisted in the library.

## Configuration

Environment variables (resolved from the project working directory):

| Variable         | Default            | Purpose                                         |
| ---------------- | ------------------ | ----------------------------------------------- |
| `ADMIN_PASSWORD` | required           | Non-empty administrator password; longer is recommended |
| `HOST`           | `127.0.0.1`        | Interface to bind; `0.0.0.0` enables LAN access |
| `PORT`           | `3000`             | HTTP/WebSocket port                             |
| `DATA_DIR`       | `./data`           | SQLite data directory                           |
| `MEDIA_DIR`      | `<DATA_DIR>/media` | Image/audio library and upload directory        |
| `YT_DLP_PATH` | `yt-dlp` on PATH | Optional absolute path to yt-dlp executable |
| `FFMPEG_DIRECTORY` | PATH | Optional folder containing ffmpeg and ffprobe |
| `COOKIE_SECURE`  | `false`            | Secure cookie flag; direct HTTP needs false     |

Environment files are not loaded automatically. Run commands from the project directory so the server can find migrations and the frontend build.

## Development and verification

```sh
# Terminal 1: set ADMIN_PASSWORD, then run the API on port 3000
npm run dev

# Terminal 2: Vite on http://localhost:5173/admin, proxying API/media/WebSocket
npm run dev:client

npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start an isolated production server on port 3100 using temporary data. They never use the regular data directory. Tests cover authentication, public-state privacy, protected media and byte ranges, persistence and additive migrations, synchronization, the editing workflow, native browser audio playback state, and text/loot privacy, editing, paging, reuse, and rendering. A real second device and LAN/firewall setup still need verification on your network.

After schema changes, run `npm run db:generate`, review and commit the generated migration, then restart. Drizzle applies pending migrations at startup. An override updates Drizzle Kit's legacy esbuild dependency to a patched version; no esbuild development server is exposed.

The architecture and milestone checklists are in [docs/phase-1.md](docs/phase-1.md), [docs/phase-2.md](docs/phase-2.md), and [docs/phase-3.md](docs/phase-3.md). Completed and planned usability additions are tracked in [docs/roadmap.md](docs/roadmap.md). Shared runtime contracts live in `src/shared`; rendering is shared by both views. The player reconnects automatically and receives a fresh snapshot. There is no player audio or interaction. This release targets a single active GM editor tab; concurrent GM editing is not coordinated.
