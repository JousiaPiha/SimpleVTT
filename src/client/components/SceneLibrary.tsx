import { useState } from "react";
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useEditor } from "../stores/editor.js";
export function SceneLibrary() {
  const { scenes, scene, activeId, selectScene, createScene, pending } =
    useEditor();
  const [name, setName] = useState("");
  return (
    <section className="scene-library">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Scenes</Text>
        <Text size="xs" c="dimmed">
          {scenes.length}
        </Text>
      </Group>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim()) {
            await createScene(name.trim());
            setName("");
          }
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <TextInput
            aria-label="New scene name"
            placeholder="New scene name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            type="submit"
            aria-label="Create scene"
            disabled={!name.trim() || pending > 0}
            size="sm"
            variant="light"
          >
            +
          </Button>
        </Group>
      </form>
      <Stack gap={4} mt="sm">
        {!scenes.length ? (
          <Text size="sm" c="dimmed" py="sm">
            Create a scene to begin preparing your session.
          </Text>
        ) : (
          scenes.map((s) => (
            <button
              key={s.id}
              className={`scene-row ${scene?.id === s.id ? "selected" : ""}`}
              aria-label={`Edit ${s.name}`}
              onClick={() => void selectScene(s.id)}
            >
              <span>{s.name}</span>
              {activeId === s.id ? (
                <small className="live-label">LIVE</small>
              ) : null}
            </button>
          ))
        )}
      </Stack>
    </section>
  );
}
