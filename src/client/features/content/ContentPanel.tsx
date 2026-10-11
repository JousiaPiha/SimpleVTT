import { CompactAction } from "../../components/CompactAction.js";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  ColorInput,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useEditor } from "../../stores/editor.js";
import {
  contentDefaults,
  contentInputSchema,
  LOOT_PAGE_SIZE,
  type SceneContent,
} from "../../../shared/content.js";
import { LootFields } from "./LootFields.js";
import { CopyContent } from "./CopyContent.js";

export function ContentPanel() {
  const state = useEditor();
  const { scene, selectedContentId, pending } = state;
  const item = scene?.content.find((i) => i.id === selectedContentId);
  const [drafts, setDrafts] = useState<Record<string, SceneContent>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SceneContent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  useEffect(() => setDeleteError(null), [deleting?.id]);
  const draft = item ? (drafts[item.id] ?? item) : null;
  const lootPage =
    item?.type === "loot"
      ? Math.min(
          item.page,
          Math.max(0, Math.ceil(item.items.length / LOOT_PAGE_SIZE) - 1),
        )
      : 0;
  const dirty = !!item && !!drafts[item.id];
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  useEffect(() => {
    setDeleting(null);
  }, [scene?.id]);
  function edit(patch: Partial<SceneContent>) {
    if (!item) return;
    setDrafts((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] ?? item), ...patch } as SceneContent,
    }));
    setError(null);
  }
  function discard(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  async function save() {
    if (!draft || !item) return;
    const { id, sceneId, ...input } = draft;
    const checked = contentInputSchema.safeParse(input);
    if (!checked.success) {
      setError(
        checked.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
      return;
    }
    // Visibility, positions and page controls are live and never come from a stale draft.
    const { type, visible, x, y, zIndex, ...fields } = checked.data;
    const { page: _page, ...patch } =
      type === "loot"
        ? (fields as typeof fields & { page: number })
        : { ...fields, page: undefined };
    setSaving(true);
    setError(null);
    if (await state.patchContent(id, patch)) discard(id);
    else
      setError(
        "Your draft is still here. Correct the error or connection and save again.",
      );
    setSaving(false);
  }
  return (
    <div className="content-panel">
      <Group gap="xs" mb="sm">
        <Button
          size="xs"
          disabled={!scene || pending > 0 || state.loading}
          onClick={() => void state.addContent(contentDefaults("text"))}
        >
          Add text
        </Button>
        <Button
          size="xs"
          variant="light"
          disabled={!scene || pending > 0 || state.loading}
          onClick={() => void state.addContent(contentDefaults("loot"))}
        >
          Add loot
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        New content starts hidden. Select a saved entry to edit or reveal it.
      </Text>
      {!scene ? (
        <Text size="sm" c="dimmed">
          Choose or create a scene first.
        </Text>
      ) : (
        scene.content.map((entry) => (
          <div
            className={`layer-row ${selectedContentId === entry.id ? "selected" : ""}`}
            key={entry.id}
          >
            <button
              className="layer-select"
              aria-label={`Edit content ${entry.name}`}
              onClick={() => {
                state.selectContent(entry.id);
                setError(null);
              }}
            >
              <span>
                {entry.name}
                {drafts[entry.id] ? " •" : ""}
              </span>
              <small>
                {entry.type} · {entry.visible ? "Visible" : "Hidden"}
              </small>
            </button>
            <CompactAction
              icon={entry.visible ? "eye-off" : "eye"}
              tooltip={
                entry.visible ? "Hide from players" : "Reveal to players"
              }
              label={`${entry.visible ? "Hide" : "Reveal"} content ${entry.name}`}
              active={entry.visible}
              onClick={() =>
                void state.patchContent(entry.id, { visible: !entry.visible })
              }
            />
            <CompactAction
              icon="trash"
              tooltip={
                entry.type === "loot" ? "Delete loot list" : "Delete text"
              }
              label={`Delete ${entry.type} ${entry.name}`}
              danger
              disabled={pending > 0 || saving}
              onClick={() => setDeleting(entry)}
            />
          </div>
        ))
      )}
      {item && draft ? (
        <Stack gap="sm" mt="md" key={item.id}>
          <Switch
            label="Content visible to players"
            checked={item.visible}
            onChange={(e) =>
              void state.patchContent(item.id, {
                visible: e.currentTarget.checked,
              })
            }
          />
          <Text size="xs" c="dimmed">
            Reveal uses the saved version. Save your draft to publish edits.
          </Text>
          <Group grow>
            <NumberInput
              label="Content X"
              value={item.x}
              min={-19200}
              max={19200}
              decimalScale={1}
              onChange={(x) => {
                if (typeof x === "number")
                  void state.patchContent(item.id, { x });
              }}
            />
            <NumberInput
              label="Content Y"
              value={item.y}
              min={-10800}
              max={10800}
              decimalScale={1}
              onChange={(y) => {
                if (typeof y === "number")
                  void state.patchContent(item.id, { y });
              }}
            />
          </Group>
          <NumberInput
            label="Content layer order"
            value={item.zIndex}
            min={-10000}
            max={10000}
            allowDecimal={false}
            onChange={(zIndex) => {
              if (typeof zIndex === "number")
                void state.patchContent(item.id, { zIndex });
            }}
          />
          {item.type === "loot" && item.items.length > LOOT_PAGE_SIZE ? (
            <Group justify="space-between" gap={4}>
              <Button
                size="compact-xs"
                variant="default"
                disabled={lootPage <= 0}
                onClick={() =>
                  void state.patchContent(item.id, { page: lootPage - 1 })
                }
              >
                Previous loot page
              </Button>
              <Text size="xs">
                {lootPage + 1} / {Math.ceil(item.items.length / LOOT_PAGE_SIZE)}
              </Text>
              <Button
                size="compact-xs"
                variant="default"
                disabled={
                  lootPage >= Math.ceil(item.items.length / LOOT_PAGE_SIZE) - 1
                }
                onClick={() =>
                  void state.patchContent(item.id, { page: lootPage + 1 })
                }
              >
                Next loot page
              </Button>
            </Group>
          ) : null}
          <fieldset className="content-fields" disabled={saving}>
            <Stack gap="sm">
              <TextInput
                label="GM content name"
                description="Only visible in your editor."
                value={draft.name}
                maxLength={120}
                onChange={(e) => edit({ name: e.currentTarget.value })}
              />
              {draft.type === "text" ? (
                <Textarea
                  label="Display text"
                  value={draft.text}
                  maxLength={4000}
                  autosize
                  minRows={3}
                  maxRows={8}
                  onChange={(e) => edit({ text: e.currentTarget.value })}
                />
              ) : (
                <LootFields item={draft} onChange={edit} />
              )}
              <Group grow>
                <NumberInput
                  label="Content width"
                  value={draft.width}
                  min={160}
                  max={1920}
                  onChange={(width) => {
                    if (typeof width === "number") edit({ width });
                  }}
                />
                <NumberInput
                  label="Content height"
                  value={draft.height}
                  min={80}
                  max={1080}
                  onChange={(height) => {
                    if (typeof height === "number") edit({ height });
                  }}
                />
              </Group>
              <NumberInput
                label="Font size"
                value={draft.fontSize}
                min={16}
                max={120}
                onChange={(fontSize) => {
                  if (typeof fontSize === "number") edit({ fontSize });
                }}
              />
              <ColorInput
                label="Text color"
                format="hex"
                value={draft.color}
                onChange={(color) => edit({ color })}
              />
              <Select
                label="Text alignment"
                value={draft.align}
                data={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
                onChange={(value) => {
                  if (
                    value === "left" ||
                    value === "center" ||
                    value === "right"
                  )
                    edit({ align: value });
                }}
              />
              <Switch
                label="Background panel"
                checked={draft.panel}
                onChange={(e) => edit({ panel: e.currentTarget.checked })}
              />
              <Group gap="xs">
                <Button
                  size="xs"
                  loading={saving}
                  disabled={!dirty}
                  onClick={() => void save()}
                >
                  Save content
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  disabled={!dirty}
                  onClick={() => {
                    discard(item.id);
                    setError(null);
                  }}
                >
                  Discard draft
                </Button>
              </Group>
            </Stack>
          </fieldset>
          <Text size="xs" c={dirty ? "yellow" : "dimmed"}>
            {dirty
              ? "Unsaved draft — canvas shows the saved version."
              : "Content saved. Drag it on the canvas to position it."}
          </Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          <Button
            size="xs"
            variant="subtle"
            color="red"
            onClick={() => setDeleting(item)}
          >
            Remove content
          </Button>
        </Stack>
      ) : null}
      <CopyContent />
      <Modal
        opened={!!deleting}
        title={`Delete ${deleting?.type === "loot" ? "loot list" : "text"}?`}
        onClose={() => {
          if (!deletingBusy) setDeleting(null);
        }}
        closeOnClickOutside={!deletingBusy}
        closeOnEscape={!deletingBusy}
        withCloseButton={!deletingBusy}
        centered
      >
        <Text size="sm" mb="md">
          Delete “{deleting?.name}” from this scene and the player display? Any
          unsaved draft for this entry will also be removed.
        </Text>
        {deleteError ? (
          <Alert color="red" mb="md">
            {deleteError}
          </Alert>
        ) : null}
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={deletingBusy}
            onClick={() => setDeleting(null)}
          >
            Cancel
          </Button>
          <Button
            color="red"
            loading={deletingBusy}
            disabled={pending > 0}
            onClick={async () => {
              setDeletingBusy(true);
              setDeleteError(null);
              if (deleting && (await state.deleteContent(deleting.id))) {
                discard(deleting.id);
                setDeleting(null);
              } else
                setDeleteError(
                  useEditor.getState().error ??
                    "Deletion failed; your content is unchanged.",
                );
              setDeletingBusy(false);
            }}
          >
            Remove permanently
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
