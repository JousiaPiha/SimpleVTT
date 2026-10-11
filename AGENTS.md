# AGENTS.md

# Project: LAN Virtual Tabletop Presentation System

## 1. Project Overview

This project is a lightweight, self-hosted web application for tabletop role-playing game sessions.

It provides a Game Master (GM) with tools to control visual presentations, character sprites, background images, text overlays, loot lists, music, ambient audio, and sound effects.

The application is conceptually similar to Foundry VTT, but intentionally much simpler.

**This is a presentation and atmosphere management tool, not a full virtual tabletop game engine.**

The GM operates the administrator interface on a PC. Players see a synchronized, read-only presentation in a web browser on a separate laptop, tablet, or external display.

Audio plays through the GM's PC, not through the player devices.

### Core principles

1. **Simplicity first.** Prefer straightforward implementations over elaborate frameworks and abstractions.
2. **Local-first.** All functionality must work without an internet connection.
3. **Self-hosted.** The application runs on the GM's PC and serves player devices over LAN.
4. **Single administrator.** Only one GM controls the presentation. Multi-user editing is unnecessary.
5. **No player interaction.** Player devices display information but cannot modify application state.
6. **Responsive presentation.** The player view must work on laptops, tablets, and external displays.
7. **Fast operation.** The GM must be able to reveal content, move objects, change scenes, and trigger sounds quickly during a session.
8. **Persistent preparation.** Scenes, media references, playlists, and prepared content must survive application restarts.
9. **Modular design.** Visual presentation, audio playback, and data management should remain independent.
10. **Minimal dependencies.** Do not introduce technologies that do not provide clear value.

The application should feel like a small, focused desktop presentation tool accessed through a browser.

---

## 2. Technology Stack

Use the following technologies unless there is a compelling technical reason to change them.

### Language

- TypeScript throughout the application.
- Enable TypeScript strict mode.
- Share type definitions between frontend and backend.

### Frontend

- React
- Vite
- Mantine UI
- React-Konva
- Zustand

Responsibilities:

- Administrator interface
- Player presentation
- Scene editing
- Sprite positioning
- Audio controls
- Media browsing
- Text and loot management

### Backend

- Node.js
- Fastify
- @fastify/websocket
- SQLite
- Drizzle ORM

Responsibilities:

- REST API
- WebSocket synchronization
- Persistent storage
- Media serving
- Media library indexing
- Scene management
- Authentication and authorization

### Audio

Use the browser's native audio capabilities:

- Web Audio API
- HTMLAudioElement
- AudioContext
- GainNode
- AudioBuffer
- AudioBufferSourceNode

Do not introduce an external audio processing server.

### Media storage

Store media files on the local filesystem.

Store metadata, references, and application state in SQLite.

### Deployment

The production application should run from a single Node.js server process.

The server must be capable of serving both the frontend and API.

Do not require Docker, PostgreSQL, Redis, cloud storage, or external services.

Docker support may be added later as an optional deployment method.

---

## 3. High-Level Architecture

The system consists of three primary components:

1. Backend server
2. Administrator browser
3. Player browser

```text
GM PC
│
├── Node.js application server
│   ├── REST API
│   ├── WebSocket server
│   ├── SQLite database
│   ├── Media library
│   └── Static frontend
│
└── Administrator browser
    ├── Scene editor
    ├── Asset browser
    ├── Audio engine
    ├── Music player
    ├── Ambient mixer
    ├── Soundboard
    ├── Text controls
    └── Loot controls
         │
         └── Audio output through GM PC

LAN
│
└── Player browser
    ├── Background image
    ├── Visible sprites and objects
    ├── Text overlays
    └── Revealed loot lists
```

Example URLs:

- `http://localhost:3000/admin`
- `http://192.168.1.100:3000/player`

The server should support binding to a configurable interface so that LAN devices can connect.

### Architectural boundaries

Keep the following systems separate:

**Scene definitions**

Persistent descriptions of prepared scenes and their objects.

**Live presentation state**

The currently active scene and the information revealed to players.

**Audio engine**

The client-side subsystem responsible for playback and mixing on the GM's computer.

**Media library**

The filesystem-backed repository of images, music, ambient sounds, and effects.

**UI state**

Temporary interface details such as selected objects, open panels, and editing tools.

Do not mix these concerns unnecessarily.

---

## 4. Scene System

A scene is a prepared visual composition consisting of a background and optional foreground elements.

### Scene properties

Each scene should support:

- Unique identifier
- Name
- Background image
- Collection of scene objects
- Optional associated text overlays
- Optional associated loot lists
- Persistent object positions
- Persistent visibility settings

### Scene objects

Supported object types should initially include:

- Character sprites
- Generic image objects
- Text elements
- Loot presentation elements

Additional object types may be introduced later.

### Image objects

Each image object should support:

- Asset reference
- X coordinate
- Y coordinate
- Scale
- Rotation
- Layer order
- Visibility
- Optional display name

Support transparent PNG and WebP files.

Preserve transparency when rendering.

### Coordinate system

Use a logical reference canvas of 1920 × 1080.

Scale the rendered scene to fit the available viewport while preserving its aspect ratio.

The reference canvas dimensions should be configurable internally if necessary.

Object coordinates must remain independent of the actual browser window dimensions.

The same scene must look consistent on different display sizes.

Implement coordinate conversion correctly when editing a scaled canvas.

### Scene rendering

Use React-Konva for the scene canvas.

Create reusable rendering components shared between administrator and player views.

Avoid duplicating scene rendering logic.

### Administrator rendering

The administrator sees:

- Background image
- All scene objects
- Visible objects at normal opacity
- Hidden objects at 50% opacity
- Selection indicators
- Transformation controls when applicable

Hidden object opacity is an editor-only visual effect. It must not modify the original media asset or its stored transparency.

The administrator must be able to:

- Select objects
- Drag objects
- Resize image objects
- Rotate image objects
- Change layer order
- Show or hide objects
- Delete objects
- Add objects from the media library

Prefer direct manipulation on the canvas.

### Player rendering

The player sees:

- Background image
- Only visible scene objects
- Revealed text
- Revealed loot

The player view must not display:

- Hidden objects
- Selection handles
- Editing controls
- Administrative UI
- Unrevealed text or loot
- Debugging information

The player canvas should fill the available display area while preserving the scene's aspect ratio.

A neutral background may appear around the canvas when display aspect ratios differ.

The player view must remain read-only.

---

## 5. Visibility and Presentation State

Visibility is a fundamental concept.

The administrator must be able to prepare content before revealing it.

### Requirements

- Objects may exist in a scene without being visible to players.
- Hidden objects remain visible to the administrator at 50% opacity.
- Visibility changes should update the player view immediately.
- Text overlays and loot lists must support equivalent reveal/hide behavior.
- A scene may contain multiple independently visible elements.

### State separation

Maintain separate concepts for:

1. Prepared scene data
2. Current live presentation state
3. Temporary administrator UI state

Avoid automatically changing saved scene definitions when modifying temporary UI state.

The implementation should clearly define which presentation changes are persisted.

For the initial version, visibility and object positioning changes may be saved directly to the active scene, provided this behavior is consistent and understandable.

### Important security invariant

**Never send hidden scene objects, unrevealed loot, or other private GM data to the player client.**

Do not merely hide private information using CSS or frontend filtering.

The backend must construct a public presentation state containing only information currently intended for players.

This also applies to WebSocket messages.

The player must not receive references to unrevealed assets through scene synchronization.

---

## 6. Real-Time Synchronization

Use WebSockets to synchronize the administrator's presentation changes with connected player browsers.

### Backend authority

The backend maintains the authoritative live presentation state.

The administrator sends commands to the backend.

The backend validates and applies changes, then broadcasts the appropriate public state changes to connected players.

The administrator may update its interface optimistically when appropriate.

### Synchronized events

Support at least:

- Scene changes
- Background changes
- Object visibility changes
- Object position changes
- Object transformations
- Layer order changes
- Text updates
- Text visibility changes
- Loot visibility changes
- Loot content updates

Do not synchronize audio playback to player browsers.

### Connection behavior

When a player connects:

1. Establish a WebSocket connection.
2. Receive the current public presentation snapshot.
3. Render the scene.
4. Apply subsequent updates.

When the connection is interrupted:

1. Attempt automatic reconnection.
2. Retrieve a fresh presentation snapshot.
3. Restore the correct display state.

Do not rely on clients receiving every individual event during a disconnection.

### Performance

Avoid unnecessary full-scene broadcasts.

Use incremental updates where appropriate.

Throttle high-frequency drag updates to approximately 15–30 updates per second.

Persist final positions when dragging finishes.

Maintain a consistent ordering of updates.

Use stable IDs for scenes and objects.

Avoid complicated synchronization frameworks unless genuinely necessary.

---

## 7. Audio System

Audio playback occurs exclusively on the GM's PC through the administrator browser.

**The backend must not be responsible for mixing or playing audio.**

The player browser must not reproduce audio.

### Audio engine

Implement a dedicated audio subsystem separate from React UI components.

The audio engine should remain active while the administrator navigates between interface panels.

Use a shared application-level instance rather than creating playback objects inside individual UI components.

### Audio categories

Support three primary categories:

1. Music
2. Ambience
3. Sound effects

Each category should have independent volume control.

Provide master volume control.

### Music player

Support:

- Play
- Pause
- Stop
- Next track
- Previous track
- Volume
- Playlists
- Individual tracks on demand
- Looping
- Shuffle
- Optional fade-in and fade-out

Playlists reference tracks from the media library.

The GM must be able to start any library track without first adding it to a playlist.

### Music transitions

Design the music player so that smooth transitions can be implemented.

Prefer a two-player architecture when implementing crossfades.

Do not make crossfading a prerequisite for basic music playback.

### Ambience mixer

Support multiple simultaneously playing ambient tracks.

Example:

- Fireplace crackling
- Rain
- Wind
- Forest sounds

Each ambient sound must support:

- Play
- Stop
- Looping
- Independent volume

Multiple ambience sounds must be able to play alongside music.

Stopping one ambient sound must not interrupt other audio.

### Soundboard

Provide a simple soundboard for one-off effects.

Examples:

- Door opening
- Sword impact
- Thunder
- Footsteps
- Bell

Requirements:

- Immediate playback
- Multiple effects may overlap
- Effects must not interrupt music or ambience
- Effects can be triggered repeatedly
- Provide volume controls
- Support categories or folders

Frequently used effects should be easily accessible.

### Audio implementation

For long music and ambience tracks:

Use HTMLAudioElement connected to the Web Audio API through MediaElementAudioSourceNode.

For short sound effects:

Use cached AudioBuffer objects and create new AudioBufferSourceNode instances for playback.

Use GainNode objects for volume control and mixing.

Suggested logical routing:

```text
Music sources ─────── Music gain ───────┐
                                       │
Ambient sources ───── Ambient gain ─────┤
                                       ├── Master gain ── Audio output
Effect sources ────── Effects gain ─────┤
                                       │
```

Individual sources may have their own gain nodes before reaching their category gain node.

Avoid loading entire long music tracks into decoded AudioBuffers.

### Browser restrictions

Browsers restrict autoplay.

Provide a clear "Enable Audio" interaction when the administrator first opens the application.

Initialize or resume AudioContext following an appropriate user gesture.

Do not attempt to bypass browser autoplay restrictions.

### Audio lifecycle

Audio playback is tied to the administrator browser session.

Reloading or closing the browser may stop playback.

Do not automatically resume audible playback after a reload without appropriate user interaction.

Persist playlists, preferences, and relevant audio settings, but do not assume playback itself can survive browser termination.

A native desktop audio backend is outside the initial project scope.

---

## 8. Media Library

Provide a unified media library for reusable assets.

### Asset categories

- Backgrounds
- Character sprites
- Generic images and objects
- Music
- Ambient audio
- Sound effects

### Storage

Store media on the local filesystem.

Store asset metadata in SQLite.

Use stable asset identifiers rather than embedding filesystem paths directly into scene definitions.

### Initial functionality

Support:

- Browsing assets
- Searching by filename or display name
- Filtering by category
- Selecting assets
- Adding image assets to scenes
- Playing audio assets
- Referencing audio assets in playlists

Support importing files through the administrator interface.

Also support scanning existing filesystem directories.

Do not require users to upload every existing asset individually.

### File handling

- Support common browser-compatible image and audio formats.
- Handle unsupported formats gracefully.
- Preserve original media files.
- Do not unnecessarily transcode assets.
- Generate image thumbnails if useful.
- Avoid storing binary media in SQLite.
- Prevent directory traversal and arbitrary filesystem access.
- Validate uploads and imported file paths.
- Handle missing or moved media files without crashing.

Prefer configurable media and data directories.

Do not hardcode absolute paths tied to one operating system.

### Media privacy

Do not expose directory listings or private asset metadata through player-accessible endpoints.

The player must be able to retrieve assets required by the public presentation.

Asset access rules should remain consistent with presentation visibility.

A previously displayed asset may remain in browser cache, so hiding an object should not be treated as revocation of previously disclosed content.

---

## 9. Text Presentation

The administrator must be able to display arbitrary text to players.

Examples:

- Character names
- Place names
- Narration
- Signs
- Chapter titles
- Short descriptions

### Requirements

Support:

- Creating text elements
- Editing text
- Positioning text
- Showing and hiding text
- Removing text
- Saving reusable text elements

At minimum, provide:

- Font size
- Text color
- Alignment
- Optional background or panel

Text must remain readable at different player display sizes.

Prefer simple visual styles and presets rather than a complicated rich-text editor.

Text overlays should work independently of character sprites.

---

## 10. Loot Presentation

The GM must be able to prepare and reveal loot lists.

A loot list is a structured collection of items intended for display.

### Suggested properties

- Unique ID
- Title
- Optional description
- Collection of items
- Visibility state

### Loot items

Each item may contain:

- Name
- Quantity
- Optional description

Do not implement a full inventory management system.

There is no need for:

- Player inventory ownership
- Character statistics
- Item weight calculations
- Trading
- Equipment mechanics

### Administrator functionality

Support:

- Creating loot lists
- Editing loot lists
- Adding and removing items
- Saving loot lists
- Revealing or hiding loot lists

Loot lists may be associated with scenes.

### Player presentation

When revealed, loot should appear as a readable overlay or panel.

Use responsive sizing.

Avoid allowing large loot lists to obscure the entire scene unintentionally.

The GM should be able to hide a loot panel immediately.

---

## 11. User Interfaces

There are exactly two primary application views.

### Administrator view

Route:

`/admin`

The administrator interface should prioritize speed and usability during live sessions.

Suggested layout:

**Left sidebar**

- Scene selection
- Media library
- Asset search
- Prepared content

**Center**

- Scene canvas
- Direct manipulation of objects

**Right sidebar**

- Selected object properties
- Visibility controls
- Layer ordering
- Text controls
- Loot controls

**Bottom panel**

- Music player
- Playlist controls
- Ambient mixer
- Soundboard

Panels may be collapsible or resizable.

The exact layout can evolve based on usability.

### Administrator interaction principles

- Common actions should require few clicks.
- Showing or hiding an object should be immediate.
- Triggering sound effects should be immediate.
- Controls must provide clear feedback.
- Avoid unnecessary confirmation dialogs.
- Use confirmation for genuinely destructive operations.
- Support keyboard shortcuts where useful.
- Do not interrupt audio when changing scenes or panels.
- Keep visual editing and audio controls accessible during play.

### Player view

Route:

`/player`

The player view is a clean presentation display.

It should contain:

- Active background
- Visible objects
- Visible text
- Revealed loot

It should not contain normal application navigation.

No login or player account is required.

The view must adapt to tablets and laptops.

It should support browser fullscreen presentation when initiated through normal browser mechanisms.

Avoid requiring player interaction after initial page loading.

No player-facing audio controls are necessary.

---

## 12. Database and Persistence

Use SQLite with Drizzle ORM.

Keep the data model simple and normalized where useful.

Suggested initial entities:

### Scene

- id
- name
- backgroundAssetId
- createdAt
- updatedAt

### SceneObject

- id
- sceneId
- type
- assetId (nullable)
- positionX
- positionY
- scale
- rotation
- zIndex
- visible
- properties

The properties field may contain type-specific JSON validated against an appropriate schema.

### Asset

- id
- name
- category
- relativePath
- mimeType
- metadata

### Playlist

- id
- name

### PlaylistTrack

- playlistId
- assetId
- position

### LootList

- id
- sceneId (nullable)
- title
- description
- items
- visible

### PresentationState

Represent the current active scene and any transient presentation settings.

Persist sufficient information to restore the current visual presentation after a server restart.

The player should not return to an unrelated or empty scene simply because the server restarted.

### Database guidelines

- Use migrations.
- Use stable IDs.
- Define foreign keys where appropriate.
- Avoid unnecessary tables.
- Validate structured JSON fields.
- Avoid persisting temporary editor UI state unless there is a clear benefit.

Do not introduce database abstractions that merely duplicate Drizzle functionality.

---

## 13. State Management

Use Zustand for frontend application state.

Separate stores or modules by responsibility where appropriate.

Possible responsibilities:

- Scene editor state
- Live presentation state
- Media library state
- Audio controller state
- Interface preferences

Do not duplicate the entire backend database inside Zustand unnecessarily.

The server is authoritative for persistent and shared presentation data.

The audio engine remains local to the administrator browser.

Keep temporary UI state out of WebSocket synchronization.

Use shared TypeScript definitions and runtime validation for API and WebSocket payloads.

Zod is an acceptable choice for validation.

---

## 14. API Design

Use REST endpoints for conventional CRUD operations.

Examples:

- Scenes
- Scene objects
- Assets
- Playlists
- Loot lists
- Prepared text

Use WebSockets for live presentation updates.

### API principles

- Validate incoming data.
- Return meaningful error messages.
- Use predictable response structures.
- Keep administrative endpoints protected.
- Do not allow player connections to perform mutations.
- Separate public presentation endpoints from administrative endpoints.

Use typed request and response contracts where practical.

Avoid building a generic API framework around the application.

### WebSocket events

Define clear event types.

Examples:

- `presentation.snapshot`
- `scene.changed`
- `object.updated`
- `object.visibilityChanged`
- `object.removed`
- `text.updated`
- `loot.updated`

These names are illustrative.

Choose a consistent naming convention.

Do not create separate event types for every minor property unless there is a practical reason.

---

## 15. Authentication and Security

The application operates on a trusted local network, but basic security remains necessary.

### Authentication

Support one administrator account or a single configured administrator password.

Use secure password hashing.

Use appropriately protected sessions.

Avoid introducing multi-user account management.

The player interface must be accessible without authentication.

### Authorization

- Only administrators may modify application state.
- Only administrators may upload or manage media.
- Only administrators may access private prepared content.
- Player connections may only access public presentation state.

Apply authorization to both HTTP and WebSocket operations.

Do not trust frontend visibility controls as security boundaries.

### Network security

- Do not expose the application to the public internet by default.
- Avoid external network dependencies.
- Do not introduce telemetry or analytics.
- Do not send application data to third-party services.
- Validate uploaded files and asset paths.
- Prevent path traversal.
- Validate WebSocket origins and authentication where applicable.
- Do not expose arbitrary local files.

For LAN deployment, document appropriate firewall and network configuration.

Do not claim that HTTP over LAN provides transport encryption.

HTTPS may be supported as an optional deployment configuration.

---

## 16. Project Structure

Prefer a straightforward repository layout.

Suggested structure:

```text
project/
├── AGENTS.md
├── README.md
├── package.json
├── src/
│   ├── client/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── scenes/
│   │   │   ├── audio/
│   │   │   ├── media/
│   │   │   ├── text/
│   │   │   └── loot/
│   │   ├── pages/
│   │   │   ├── AdminPage.tsx
│   │   │   └── PlayerPage.tsx
│   │   └── stores/
│   ├── server/
│   │   ├── api/
│   │   ├── websocket/
│   │   ├── database/
│   │   ├── services/
│   │   └── index.ts
│   └── shared/
│       ├── types/
│       └── schemas/
├── data/
│   ├── media/
│   └── thumbnails/
├── drizzle/
├── tests/
└── docs/
```

This structure is illustrative, not mandatory.

Adapt it when necessary.

The SQLite database should reside in the configurable application data directory.

Keep generated files, databases, caches, and user media out of version control.

Do not introduce a monorepo unless the project grows enough to justify it.

---

## 17. Coding Guidelines

### TypeScript

- Use strict typing.
- Avoid `any` unless justified.
- Prefer explicit domain types.
- Use discriminated unions for scene object types where appropriate.
- Validate external data at runtime.
- Avoid unnecessary type assertions.

### React

- Use functional components.
- Keep components focused.
- Extract reusable behavior into hooks where appropriate.
- Avoid large components handling unrelated concerns.
- Do not place persistent application logic directly inside visual components.

### State management

- Keep state ownership clear.
- Avoid redundant state.
- Avoid unnecessary global state.
- Ensure asynchronous operations handle errors correctly.

### Backend

- Separate routes from business logic.
- Validate request payloads.
- Handle filesystem failures safely.
- Keep database access predictable.
- Avoid unnecessary abstraction layers.

### Audio

- Keep audio playback logic independent of UI rendering.
- Clean up temporary audio resources.
- Reuse persistent audio nodes appropriately.
- Avoid audio glitches caused by React rerenders.
- Handle missing or unsupported audio files gracefully.

### General

- Favor readable code over clever code.
- Keep dependencies minimal.
- Follow existing project conventions.
- Avoid premature optimization.
- Avoid speculative features.
- Do not introduce abstractions for hypothetical future requirements.

Use comments to explain non-obvious behavior and important constraints, not to restate what the code already says.

---

## 18. Testing and Verification

Testing should focus on core application behavior and synchronization correctness.

Use an appropriate lightweight testing setup.

Vitest is suitable for unit tests.

Playwright may be used for browser integration and end-to-end tests.

### Important test cases

**Scene rendering**

- Background images render correctly.
- Transparent sprites preserve alpha.
- Object positioning is correct.
- Canvas scaling preserves proportions.
- Layer order is respected.

**Visibility**

- Hidden objects appear at 50% opacity in the administrator view.
- Hidden objects do not appear in the player view.
- Hidden objects are absent from player-facing API and WebSocket payloads.
- Revealing an object updates the player view.

**Synchronization**

- Scene changes propagate correctly.
- Object movement propagates correctly.
- Player reconnection restores the current state.
- Multiple player displays can observe the same presentation.
- Browser refresh does not corrupt presentation state.

**Audio**

- Music and ambient audio can play simultaneously.
- Multiple ambient sounds can play simultaneously.
- Sound effects do not interrupt music.
- Independent volume controls work.
- Stopping one audio source does not stop unrelated sources.
- Audio resources are cleaned up correctly.

Automated browser tests may verify audio engine state, but actual audio output should also be checked manually.

**Persistence**

- Scenes survive application restarts.
- Object positions are restored.
- Playlists are restored.
- Media references remain valid.
- The active visual presentation can be restored.

**Security**

- Player sessions cannot modify state.
- Player clients cannot retrieve hidden scene metadata.
- Administrative endpoints reject unauthorized requests.
- Invalid asset paths are rejected.

### Verification discipline

Run relevant tests and type checks after making changes.

Do not claim that functionality was tested if it was not.

Clearly distinguish between automated verification and behavior requiring manual testing.

---

## 19. Implementation Priorities

Develop the application incrementally.

Prefer complete, working vertical slices over implementing many disconnected components.

### Phase 1: Basic presentation

Implement:

1. Project setup
2. Backend server
3. SQLite persistence
4. Administrator and player routes
5. WebSocket connection
6. Scene background rendering
7. Adding sprites
8. Moving and scaling sprites
9. Sprite visibility
10. Player synchronization

**Milestone:** The GM can prepare a scene, open the player display on another device, move sprites, and reveal or hide them in real time.

### Phase 2: Audio

Implement:

1. Audio engine
2. Music playback
3. Music library integration
4. Playlists
5. Independent ambient sound loops
6. Volume controls
7. Soundboard

**Milestone:** The GM can play music, layer ambient sounds, and trigger sound effects through the PC speakers while operating the visual presentation.

### Phase 3: Presentation content

Implement:

1. Text overlays
2. Text editing
3. Text visibility
4. Loot list creation
5. Loot presentation
6. Scene switching
7. Reusable prepared content

**Milestone:** The GM can manage a complete presentation session using prepared scenes, sprites, audio, text, and loot.

### Phase 4: Usability improvements

Consider:

- Keyboard shortcuts
- Better media search
- Asset thumbnails
- Scene duplication
- Scene transitions
- Audio crossfading
- Favorite sound effects
- Improved panel layouts
- Configuration export/import
- Backup and restore

Do not implement Phase 4 features at the expense of getting the core application working.

---

## 20. Features Explicitly Outside Scope

Do not implement the following unless specifically requested:

- Character sheets
- Character statistics
- Combat automation
- Turn tracking
- Dice rolling
- Initiative systems
- Grid-based movement mechanics
- Fog of war
- Dynamic lighting
- Physics simulations
- Player-controlled tokens
- Player chat
- Player accounts
- Multiplayer editing
- Voice chat
- Video chat
- Audio streaming to players
- Internet matchmaking
- Cloud synchronization
- Plugin marketplaces
- Full inventory management
- Ruleset-specific game mechanics

This list is intentional.

The application is a GM-controlled presentation tool.

Do not gradually turn it into a full virtual tabletop platform.

---

## 21. User Experience and Visual Design

Aim for a clean, modern, functional interface.

The administrator interface should resemble a practical media production or presentation application rather than a game-themed website.

### Visual principles

- Clear typography
- Compact but readable controls
- Consistent spacing
- Minimal decoration
- Neutral colors
- Strong visual hierarchy
- Appropriate contrast
- Clear selection and visibility states

A dark interface is appropriate for the administrator view because it reduces distraction during gaming sessions.

Use Mantine components consistently.

Avoid unnecessary animations.

### Usability principles

The GM may operate the application while narrating and interacting with players.

Therefore:

- Keep essential controls readily available.
- Minimize navigation between screens.
- Avoid modal dialogs for routine actions.
- Make destructive actions distinguishable from routine actions.
- Show meaningful feedback for loading and errors.
- Preserve the current working context when switching panels.
- Avoid interrupting playback or presentation during ordinary editing.

Prioritize operational usability over visual novelty.

---

## 22. Documentation

Maintain a concise README.md containing:

- Project overview
- Requirements
- Installation
- Development commands
- Production build instructions
- How to start the server
- How to open the administrator interface
- How to connect a player device
- Media library location
- Configuration options
- Important browser limitations

Document architectural decisions when they are not obvious.

Avoid generating excessive documentation that duplicates code or existing instructions.

If substantial architectural decisions are made, record their rationale in `docs/`.

Keep documentation consistent with actual implementation.

---

## 23. Instructions for AI Development Agents

These instructions apply to all development work in this repository.

### Before making changes

1. Inspect the existing repository.
2. Read the relevant source files and documentation.
3. Understand the current implementation before modifying it.
4. Preserve working functionality.
5. Check whether a similar feature already exists.
6. Prefer adapting existing components over creating duplicate implementations.

If the repository is empty, initialize it according to this document.

### When implementing features

- Prefer small, understandable changes.
- Keep the application runnable.
- Respect established architectural boundaries.
- Avoid unnecessary dependencies.
- Implement complete functionality rather than UI-only placeholders.
- Provide reasonable loading, empty, and error states.
- Do not invent unrelated features.
- Do not silently change fundamental requirements.

When requirements leave implementation details unspecified, choose the simplest reasonable solution consistent with the project goals.

Use established conventions and libraries rather than implementing complicated custom infrastructure.

### When making architectural decisions

Consider:

1. Does this make the application simpler?
2. Does it preserve the local-first approach?
3. Does it maintain the distinction between GM and player views?
4. Does it maintain correct visibility and synchronization?
5. Does it introduce unnecessary runtime dependencies?
6. Can it be maintained easily?

If a proposed design conflicts with these principles, prefer the simpler alternative.

### When modifying scene functionality

Always consider:

- Administrator rendering
- Player rendering
- Persistent storage
- WebSocket synchronization
- Visibility filtering

A change affecting scene objects may need changes in all five areas.

### When modifying audio functionality

Always consider:

- Audio engine lifecycle
- Concurrent playback
- Independent volume controls
- Resource cleanup
- Browser autoplay restrictions
- Interactions with existing playback

Do not couple audio playback to scene rendering.

### When modifying database structures

- Use migrations.
- Preserve existing user data.
- Avoid destructive schema changes.
- Update relevant shared types.
- Update API validation and tests.

### After making changes

1. Run appropriate type checks.
2. Run relevant automated tests.
3. Build the application when appropriate.
4. Review errors and warnings.
5. Verify the affected feature.
6. Update documentation if behavior or configuration changed.

Summarize the implemented changes and identify any important limitations that remain.

Do not present planned or partially implemented features as completed.

---

## 24. Acceptance Criteria

The initial application is functionally complete when the following scenario works:

1. The GM launches the application on a PC.
2. The GM opens the administrator interface.
3. A separate laptop or tablet opens the player view over LAN.
4. The GM selects a prepared scene.
5. The background appears on the player device.
6. The GM adds or selects character sprites.
7. The GM can position sprites on the scene.
8. Hidden sprites appear at 50% opacity to the GM but are absent from the player's presentation and its state payload.
9. The GM reveals a sprite and it immediately appears on the player device.
10. The GM moves a sprite and its position updates on the player device.
11. The GM starts background music through the PC speakers.
12. The GM starts a looping fireplace sound while the music continues.
13. The GM triggers a soundboard effect without interrupting existing audio.
14. The GM displays a text overlay.
15. The GM reveals a prepared loot list.
16. The GM hides the loot list and switches scenes.
17. The player display updates correctly throughout.
18. The GM can save the prepared content and use it again after restarting the application.
19. Reloading the player browser restores the current presentation.
20. The entire system functions without an internet connection.

This scenario represents the primary target for development.

---

## 25. Final Guiding Principle

**Build the smallest reliable application that makes it easy for a Game Master to control visuals and sound during a tabletop RPG session.**

The project should remain intentionally narrower than Foundry VTT.

Favor:

- Reliability over complexity
- Direct controls over elaborate workflows
- Native browser capabilities over unnecessary dependencies
- Reusable prepared content over complicated automation
- Simple architecture over speculative extensibility
- Fast, predictable operation over feature count

When uncertain, choose the implementation that best supports an uninterrupted tabletop gaming session.
