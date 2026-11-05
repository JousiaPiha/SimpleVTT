import { DrawingToolbar } from "../features/drawing/DrawingToolbar.js";
import type { DrawingTool } from "../../shared/drawing.js";
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Menu,
  Tooltip,
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  ScanLine,
  MonitorOff,
  MoreHorizontal,
  Trash2,
  ImageOff,
} from "lucide-react";
import { useLaserPointer } from "../features/laser/useLaserPointer.js";
import { api, json, setSessionGeneration } from "../api.js";
import { resetEditorForSession, useEditor } from "../stores/editor.js";
import { useSessionStatus } from "../features/sessions/useSessionStatus.js";
import {
  SessionControls,
  SessionProgress,
} from "../features/sessions/SessionControls.js";
import {
  useSessionDraft,
  useSessionDrafts,
} from "../features/sessions/drafts.js";
import { useSessionAccess } from "../features/sessions/access.js";
import { SceneCanvas } from "../components/SceneCanvas.js";
import { GridControls, type GridPreview } from "../components/GridControls.js";
import { SceneLibrary } from "../components/SceneLibrary.js";
import { MediaLibrary } from "../components/MediaLibrary.js";
import { SceneInspector } from "../features/content/SceneInspector.js";

import { AudioPanel } from "../features/audio/AudioPanel.js";
import {
  audioEngine,
  shutdownAudio,
  useAudioStore,
} from "../features/audio/store.js";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [rename, setRename] = useState(false);
  const [newName, setNewName] = useState("");
  const [remove, setRemove] = useState(false);
  const [gridPreview, setGridPreview] = useState<GridPreview | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  const [drawingColor, setDrawingColor] = useState("#ffcc00");
  const [drawingWidth, setDrawingWidth] = useState(5);
  const state = useEditor();
  const session = useSessionStatus(authenticated);
  const [loadedGeneration, setLoadedGeneration] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [sessionWorking, setSessionWorking] = useState(false);
  const [reloadRequested, setReloadRequested] = useState(0);
  const allowReset = useRef<string | null>(null);
  const drafts = useSessionDrafts((s) => s.drafts);
  const audioDirty = useAudioStore((s) => s.settingsDirty);
  const mismatch =
    !!loadedGeneration &&
    !!session.status &&
    loadedGeneration !== session.status.generation;
  const editingDisabled =
    !session.status?.active ||
    !!session.error ||
    !!session.status?.error ||
    !!session.status?.busy ||
    sessionWorking ||
    mismatch;
  useEffect(() => {
    useSessionAccess.setState({ blocked: editingDisabled });
  }, [editingDisabled]);
  useSessionDraft("scene name", rename && newName !== state.scene?.name);
  useEffect(() => {
    if (
      session.status?.operation?.status === "failed" &&
      session.status.generation === loadedGeneration
    )
      allowReset.current = null;
  }, [session.status, loadedGeneration]);
  useEffect(() => {
    if (!Object.keys(drafts).length && !state.pending && !audioDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, state.pending, audioDirty]);
  useEffect(() => {
    const status = session.status;
    if (
      !authenticated ||
      !status ||
      status.busy ||
      loadedGeneration === status.generation
    )
      return;
    const localWork =
      Object.keys(drafts).length > 0 ||
      state.pending > 0 ||
      state.saveFailed ||
      audioDirty;
    if (
      loadedGeneration &&
      localWork &&
      allowReset.current !== status.generation &&
      allowReset.current !== "*"
    )
      return;
    allowReset.current = null;
    shutdownAudio();
    resetEditorForSession();
    setSessionGeneration(status.generation);
    setGridPreview(null);
    setDrawingTool(null);
    setLaserSceneId(null);
    setRename(false);
    setRemove(false);
    setLoadedGeneration(status.generation);
    setEditorReady(!!status.active);
    if (status.active) void useEditor.getState().initialize();
  }, [
    authenticated,
    session.status,
    loadedGeneration,
    drafts,
    state.pending,
    state.saveFailed,
    audioDirty,
    reloadRequested,
  ]);
  const [laserSceneId, setLaserSceneId] = useState<string | null>(null);
  const live = !!state.scene && state.activeId === state.scene.id;
  const laserMode = !!authenticated && live && laserSceneId === state.scene?.id;
  const laser = useLaserPointer(laserMode ? laserSceneId : null);
  useEffect(() => {
    if (mismatch) audioEngine.stopAll();
  }, [mismatch]);
  useEffect(() => {
    setLaserSceneId(null);
    setDrawingTool(null);
  }, [state.scene?.id, state.activeId, authenticated]);
  useEffect(() => {
    if (!laserMode && !drawingTool) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLaserSceneId(null);
        setDrawingTool(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [laserMode, drawingTool]);
  useEffect(() => {
    api<{ authenticated: boolean }>("/api/auth/session")
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => {
        setLoginError("Cannot reach the server. Try signing in again.");
        setAuthenticated(false);
      });
  }, []);
  if (authenticated === null)
    return (
      <div className="login-page">
        <Loader aria-label="Connecting" />
      </div>
    );
  if (!authenticated)
    return (
      <main className="login-page">
        <div className="login-panel">
          <div className="brand-mark">S</div>
          <Title order={1} size="h2" mb="xs">
            SimpleVTT
          </Title>
          <Text c="dimmed" mb="xl">
            Your table. Your presentation.
          </Text>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSigningIn(true);
              setLoginError(null);
              try {
                await api("/api/auth/login", json("POST", { password }));
                setPassword("");
                setAuthenticated(true);
              } catch (error) {
                setLoginError(
                  error instanceof Error ? error.message : "Sign in failed",
                );
              } finally {
                setSigningIn(false);
              }
            }}
          >
            <Stack>
              <PasswordInput
                label="Administrator password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {loginError ? <Alert color="red">{loginError}</Alert> : null}
              <Button type="submit" loading={signingIn}>
                Sign in
              </Button>
            </Stack>
          </form>
          <Anchor href="/player" className="player-link">
            Open player display
          </Anchor>
        </div>
      </main>
    );
  return (
    <div className="admin-shell">
      <header className="app-header">
        <Group gap="sm">
          <SessionControls
            status={session.status}
            disabled={mismatch}
            onWorking={setSessionWorking}
            onStatus={(status, discard) => {
              if (discard) allowReset.current = "*";
              session.accept(status);
            }}
          />
          <div className="brand-mark small">S</div>
          <Text fw={650}>SimpleVTT</Text>
          <span className="header-divider" />
          <Text size="sm" c="dimmed">
            GM workspace
          </Text>
        </Group>
        <Group gap="sm">
          <Button
            component="a"
            href="/player"
            target="_blank"
            rel="noopener noreferrer"
            variant="default"
            size="xs"
          >
            Open player display ↗
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            onClick={async () => {
              try {
                audioEngine.stopAll();
                if (!(await useAudioStore.getState().savePreferences())) {
                  throw new Error(
                    "Audio settings could not be saved. Retry saving them before signing out.",
                  );
                }
                await api("/api/auth/logout", json("POST"));
                shutdownAudio();
                resetEditorForSession();
                setSessionGeneration(null);
                setLoadedGeneration(null);
                setEditorReady(false);
                setAuthenticated(false);
              } catch (error) {
                state.setError(
                  error instanceof Error ? error.message : "Sign out failed",
                );
              }
            }}
          >
            Sign out
          </Button>
        </Group>
      </header>
      <SessionProgress status={session.status} />
      {session.error || session.status?.error ? (
        <Alert color="red" title="Session storage needs attention">
          {session.error ?? session.status?.error} Persistent edits are paused.
          {session.status?.active
            ? " Use Sessions to retry storage or close the unavailable session."
            : " Use Sessions to retry storage or open a valid session."}
        </Alert>
      ) : null}
      {mismatch && (
        <Alert color="yellow" title="Session changed in another tab">
          Local drafts and save errors have been kept here. The old session can
          no longer be edited. Reloading discards these local drafts.
          <Button
            size="xs"
            ml="sm"
            color="yellow"
            onClick={() => {
              if (
                window.confirm(
                  "Discard this tab's unsaved local edits and drafts, then load the current session?",
                )
              ) {
                allowReset.current = session.status!.generation;
                setReloadRequested((value) => value + 1);
              }
            }}
          >
            Discard local drafts and reload
          </Button>
        </Alert>
      )}
      {!editorReady && (
        <main className="welcome" style={{ flex: 1 }}>
          <Title order={2}>
            {session.status ? "No active session" : "Loading session…"}
          </Title>
          <Text c="dimmed">
            {session.status
              ? "Use Sessions to open a saved session or retry Default Session storage."
              : "Checking storage on the server computer."}
          </Text>
        </main>
      )}
      {editorReady && (
        <div
          key={loadedGeneration}
          style={{ display: "contents" }}
          inert={editingDisabled}
        >
          {state.error || state.saveFailed ? (
            <Alert
              color="red"
              title="Action needs attention"
              withCloseButton
              onClose={() => state.setError(null)}
              className="error-banner"
            >
              {state.error ??
                "Some edits are unsaved. Reload the saved state before continuing."}{" "}
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  if (state.scene) void state.selectScene(state.scene.id);
                  else void state.initialize();
                }}
              >
                Reload saved state
              </Button>
            </Alert>
          ) : null}
          <div className="workspace">
            <aside className="library panel">
              <SceneLibrary />
              <MediaLibrary />
            </aside>
            <main className="editor-area">
              <div className="scene-toolbar">
                <div>
                  <Group gap="sm">
                    <Title order={1} size="h4">
                      {state.scene?.name ?? "Prepare your first scene"}
                    </Title>
                    {live ? <span className="live-label">LIVE</span> : null}
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    {state.scene
                      ? live
                        ? "Changes to revealed objects are live."
                        : "Preparing privately. Present when you are ready."
                      : "Start with a scene, then bring in your images."}
                  </Text>
                </div>
                <Group gap="xs">
                  {state.scene ? (
                    <>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => {
                          setNewName(state.scene!.name);
                          setRename(true);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="xs"
                        disabled={live || state.pending > 0}
                        onClick={() => void state.present(state.scene!.id)}
                      >
                        Present scene
                      </Button>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label="Scene options"
                            title="Scene options"
                          >
                            <MoreHorizontal size={18} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {state.scene.backgroundAssetId && (
                            <Menu.Item
                              leftSection={<ImageOff size={16} />}
                              onClick={() =>
                                void state.updateScene({
                                  backgroundAssetId: null,
                                })
                              }
                            >
                              Clear background
                            </Menu.Item>
                          )}
                          <Menu.Item
                            color="red"
                            leftSection={<Trash2 size={16} />}
                            onClick={() => setRemove(true)}
                          >
                            Delete scene
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </>
                  ) : null}
                </Group>
              </div>
              <div className="canvas-region">
                {state.loading ? (
                  <div className="canvas-loading">
                    <Loader />
                  </div>
                ) : state.scene ? (
                  <SceneCanvas
                    scene={
                      gridPreview?.sceneId === state.scene.id
                        ? { ...state.scene, ...gridPreview }
                        : state.scene
                    }
                    editing
                    drawingTool={drawingTool}
                    drawingColor={drawingColor}
                    drawingWidth={drawingWidth}
                    onDraw={(drawing) =>
                      state.addDrawing(state.scene!.id, drawing)
                    }
                    onErase={(id) => state.eraseDrawing(state.scene!.id, id)}
                    laserMode={laserMode}
                    pointer={laser.pointer}
                    onPoint={laser.update}
                    selectedId={state.selectedId}
                    onSelect={state.selectObject}
                    onPatch={state.patchObject}
                    selectedContentId={state.selectedContentId}
                    onSelectContent={state.selectContent}
                    onPatchContent={(id, patch) =>
                      void state.patchContent(id, patch)
                    }
                  />
                ) : (
                  <div className="welcome">
                    <div className="welcome-line" />
                    <Title order={2}>Set the scene.</Title>
                    <Text c="dimmed" maw={340}>
                      Create a scene in the left panel, import your images, and
                      reveal them when the moment is right.
                    </Text>
                    <Text size="sm" c="dimmed" mt="md">
                      Everything stays on your computer.
                    </Text>
                  </div>
                )}
              </div>
              <div className="scene-actions">
                {state.scene && (
                  <DrawingToolbar
                    tool={drawingTool}
                    color={drawingColor}
                    width={drawingWidth}
                    onTool={(tool) => {
                      setLaserSceneId(null);
                      setDrawingTool(tool);
                    }}
                    onColor={setDrawingColor}
                    onWidth={setDrawingWidth}
                  />
                )}

                <Tooltip label="Laser pointer">
                  <ActionIcon
                    size="lg"
                    color="red"
                    variant={laserMode ? "filled" : "default"}
                    aria-label="Laser pointer"
                    aria-pressed={laserMode}
                    disabled={!live}
                    title={
                      live
                        ? "Hold on the canvas to point; Esc returns to editing"
                        : "Present this scene to use the laser pointer"
                    }
                    onClick={() => {
                      setDrawingTool(null);
                      setLaserSceneId(laserMode ? null : state.scene!.id);
                    }}
                  >
                    <ScanLine size={17} aria-hidden="true" />
                  </ActionIcon>
                </Tooltip>
                {state.scene && (
                  <GridControls
                    key={state.scene.id}
                    scene={state.scene}
                    onPreview={setGridPreview}
                  />
                )}
                {state.activeId ? (
                  <Tooltip label="Blank player display">
                    <ActionIcon
                      size="lg"
                      variant="default"
                      aria-label="Blank player display"
                      onClick={() => void state.present(null)}
                    >
                      <MonitorOff size={17} aria-hidden="true" />
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <Text size="xs" c="dimmed">
                    Player display is blank
                  </Text>
                )}
              </div>
              <div className="canvas-footer">
                <Text size="xs" c="dimmed">
                  {drawingTool
                    ? drawingTool === "eraser"
                      ? "Brush over a stroke or shape to erase it · Esc to exit"
                      : "Drag to draw · Release to save · Esc to exit"
                    : laserMode
                      ? laser.connected
                        ? "Hold and move on the scene to point · Release to hide · Esc to exit"
                        : "Connecting laser pointer…"
                      : "1920 × 1080 · Drag to move · Corner handles to resize"}
                </Text>
                <Text
                  size="xs"
                  c={
                    state.error || state.saveFailed
                      ? "red"
                      : state.pending
                        ? "yellow"
                        : "dimmed"
                  }
                  aria-live="polite"
                >
                  {session.status?.error
                    ? "Saving paused"
                    : state.error || state.saveFailed
                      ? "Check save status"
                      : state.pending
                        ? "Saving…"
                        : "All changes saved"}
                </Text>
              </div>
            </main>
            <SceneInspector />
          </div>
          <AudioPanel />
        </div>
      )}
      <footer className="app-footer">
        <Text size="xs" c="dimmed">
          Local presentation workspace
        </Text>
        <Text size="xs" c="dimmed">
          Scenes, audio and content · Phase 3
        </Text>
      </footer>
      <Modal
        withinPortal={false}
        opened={rename && !editingDisabled}
        onClose={() => setRename(false)}
        title="Rename scene"
        centered
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await state.updateScene({ name: newName })) setRename(false);
          }}
        >
          <Stack>
            <TextInput
              label="Scene name"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.currentTarget.value)}
              required
            />
            <Button
              type="submit"
              disabled={!newName.trim() || editingDisabled}
              loading={state.pending > 0}
            >
              Save name
            </Button>
          </Stack>
        </form>
      </Modal>
      <Modal
        withinPortal={false}
        opened={remove && !editingDisabled}
        onClose={() => setRemove(false)}
        title="Delete this scene?"
        centered
      >
        <Text size="sm" mb="lg">
          This removes the scene and its object placements. Images remain in
          your library. If this scene is live, the player display will go blank.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setRemove(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={state.pending > 0}
            onClick={async () => {
              await state.deleteScene();
              setRemove(false);
            }}
          >
            Delete permanently
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
