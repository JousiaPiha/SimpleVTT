import { useEffect, useState } from "react";
import { Button, Select, Stack, Text } from "@mantine/core";
import { useEditor } from "../../stores/editor.js";
import { api } from "../../api.js";
import { sceneSchema } from "../../../shared/contracts.js";
import { type SceneContent } from "../../../shared/content.js";
export function CopyContent() {
  const { scene, scenes, copyContent, pending } = useEditor();
  const [source, setSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<SceneContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setItems([]);
    setSelected(null);
    setError(null);
    if (!source) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api(`/api/admin/scenes/${source}`, {}, sceneSchema)
      .then((saved) => {
        if (active) setItems(saved.content);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Cannot load prepared content",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source, scene?.id]);
  const sourceItems = source === scene?.id ? scene.content : items;
  return (
    <Stack gap="xs" className="copy-content">
      <Text size="sm" fw={600}>
        Reuse prepared content
      </Text>
      <Select
        label="Copy from scene"
        placeholder="Choose a scene"
        value={source}
        onChange={setSource}
        clearable
        data={scenes.map((s) => ({ value: s.id, label: s.name }))}
      />
      {source ? (
        <>
          <Select
            label="Prepared content"
            placeholder={loading ? "Loading…" : "Choose text or loot"}
            value={selected}
            onChange={setSelected}
            disabled={loading}
            data={sourceItems.map((i) => ({
              value: i.id,
              label: `${i.name} (${i.type})`,
            }))}
          />
          <Button
            size="xs"
            variant="default"
            disabled={
              !scene ||
              !selected ||
              !sourceItems.some((i) => i.id === selected) ||
              loading ||
              pending > 0
            }
            onClick={() => {
              if (source && selected) void copyContent(source, selected);
            }}
          >
            Copy into current scene
          </Button>
          <Text size="xs" c="dimmed">
            Copies start hidden. The original stays unchanged.
          </Text>
        </>
      ) : null}
      {error ? (
        <Text c="red" size="xs">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
