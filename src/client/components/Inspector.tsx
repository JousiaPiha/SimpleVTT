import { CompactAction } from "./CompactAction.js";
import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEditor } from "../stores/editor.js";

export function Inspector() {
  const {
    scene,
    selectedId,
    selectObject,
    patchObject,
    deleteObject,
    pending,
  } = useEditor();
  const object = scene?.objects.find((o) => o.id === selectedId);
  const [deleting, setDeleting] = useState(false);
  return (
    <aside className="inspector panel">
      <Text fw={600} mb="md">
        Object properties
      </Text>
      {object ? (
        <Stack gap="md">
          <TextInput
            key={object.id}
            label="Object name"
            defaultValue={object.name}
            maxLength={120}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (name && name !== object.name)
                patchObject(object.id, { name });
              else e.currentTarget.value = object.name;
            }}
          />
          <div className="visibility-control">
            <Switch
              label="Visible to players"
              checked={object.visible}
              onChange={(e) =>
                patchObject(object.id, { visible: e.currentTarget.checked })
              }
            />
            <Text size="xs" c="dimmed" mt="xs">
              {object.visible
                ? "This object is revealed when this scene is live."
                : "Only you can see this object, at half opacity."}
            </Text>
          </div>
          <Group grow align="start">
            <NumberInput
              label="X position"
              value={object.x}
              min={-19200}
              max={19200}
              decimalScale={1}
              onChange={(x) => {
                if (typeof x === "number") patchObject(object.id, { x });
              }}
            />
            <NumberInput
              label="Y position"
              value={object.y}
              min={-10800}
              max={10800}
              decimalScale={1}
              onChange={(y) => {
                if (typeof y === "number") patchObject(object.id, { y });
              }}
            />
          </Group>
          <Group grow align="start">
            <NumberInput
              label="Scale"
              value={object.scale}
              min={0.01}
              max={20}
              step={0.1}
              decimalScale={2}
              onChange={(scale) => {
                if (typeof scale === "number" && scale >= 0.01)
                  patchObject(object.id, { scale });
              }}
            />
            <NumberInput
              label="Rotation"
              value={object.rotation}
              min={-3600}
              max={3600}
              suffix="°"
              onChange={(rotation) => {
                if (typeof rotation === "number")
                  patchObject(object.id, { rotation });
              }}
            />
          </Group>
          <NumberInput
            label="Layer order"
            description="Higher numbers appear in front."
            value={object.zIndex}
            min={-10000}
            max={10000}
            allowDecimal={false}
            onChange={(zIndex) => {
              if (typeof zIndex === "number")
                patchObject(object.id, { zIndex });
            }}
          />
          <Button
            variant="subtle"
            color="red"
            onClick={() => setDeleting(true)}
          >
            Remove object
          </Button>
        </Stack>
      ) : (
        <div className="inspector-empty">
          <Text size="sm" c="dimmed">
            Select an object on the canvas or in the layer list to edit it.
          </Text>
        </div>
      )}
      <div className="layer-section">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Layers</Text>
          <Text size="xs" c="dimmed">
            {scene?.objects.length ?? 0}
          </Text>
        </Group>
        {!scene?.objects.length ? (
          <Text size="sm" c="dimmed">
            Added sprites appear here.
          </Text>
        ) : (
          [...scene.objects]
            .sort((a, b) => b.zIndex - a.zIndex)
            .map((o) => (
              <div
                key={o.id}
                className={`layer-row ${selectedId === o.id ? "selected" : ""}`}
              >
                <button
                  className="layer-select"
                  aria-label={`Select ${o.name}`}
                  onClick={() => selectObject(o.id)}
                >
                  <span>{o.name}</span>
                  <small>{o.visible ? "Visible" : "Hidden"}</small>
                </button>
                <CompactAction
                  icon={o.visible ? "eye-off" : "eye"}
                  tooltip={
                    o.visible ? "Hide from players" : "Reveal to players"
                  }
                  label={`${o.visible ? "Hide" : "Reveal"} ${o.name}`}
                  active={o.visible}
                  onClick={() => patchObject(o.id, { visible: !o.visible })}
                />
              </div>
            ))
        )}
      </div>
      <Modal
        opened={deleting && !!object}
        onClose={() => setDeleting(false)}
        title="Remove this object?"
        centered
      >
        <Text size="sm" mb="lg">
          The image stays in your media library. Its position and settings in
          this scene will be removed.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={pending > 0}
            onClick={async () => {
              if (object) await deleteObject(object.id);
              setDeleting(false);
            }}
          >
            Remove object
          </Button>
        </Group>
      </Modal>
    </aside>
  );
}
