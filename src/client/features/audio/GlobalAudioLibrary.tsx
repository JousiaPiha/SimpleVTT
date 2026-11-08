import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import type { Asset } from "../../../shared/contracts.js";
import { CompactAction } from "../../components/CompactAction.js";
import { useSessionAccess } from "../sessions/access.js";
import { audioEngine, useAudioStore } from "./store.js";
import type { useGlobalLibrary } from "./useGlobalLibrary.js";

export function GlobalAudioLibrary({
  library,
  assets,
}: {
  library: ReturnType<typeof useGlobalLibrary>;
  assets: Asset[];
}) {
  const preview = useAudioStore((state) => state.snapshot.preview);
  const enabled = useAudioStore((state) => state.snapshot.enabled);
  const blocked = useSessionAccess((state) => state.blocked);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Asset | null>(null);
  return (
    <>
      <Text size="xs" c="dimmed" mt="xs">
        Preview sounds here, then add copies to the session when you need them.
      </Text>
      <div className="audio-asset-list">
        {assets.map((asset) => (
          <div className="audio-asset-row global-audio-asset-row" key={asset.id}>
            {editing?.id === asset.id ? (
              <form
                className="global-audio-rename"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (await library.rename(asset, name.trim())) setEditing(null);
                }}
              >
                <TextInput
                  label="Global sound name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  maxLength={120}
                  required
                  disabled={!!library.busy}
                  autoFocus
                />
                <Group gap={6} wrap="nowrap" align="end">
                  <Button
                    size="compact-xs"
                    type="submit"
                    aria-label="Save global sound name"
                    disabled={!name.trim() || !!library.busy}
                    loading={library.busy === `rename:${asset.id}`}
                  >
                    Save name
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={!!library.busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel rename
                  </Button>
                </Group>
              </form>
            ) : (
              <>
                <div className="audio-asset-name">
                  <Text size="sm" truncate title={asset.name}>{asset.name}</Text>
                  <Text size="xs" c="dimmed">
                    {asset.category === "effect" ? "Sound effect" : asset.category}
                  </Text>
                </div>
                <Group gap={6} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={!enabled}
                    aria-label={`${preview?.asset.id === asset.id ? "Stop preview" : "Preview"} ${asset.name}`}
                    onClick={() => preview?.asset.id === asset.id
                      ? audioEngine.stopPreview()
                      : void audioEngine.playPreview(asset)}
                  >
                    {preview?.asset.id === asset.id ? "Stop preview" : "Preview"}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="default"
                    aria-label={`Add to session ${asset.name}`}
                    disabled={!!library.busy}
                    loading={library.busy === `transfer:${asset.id}`}
                    onClick={() => void library.transfer(asset, "session")}
                  >
                    Add to session
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    aria-label={`Rename global sound ${asset.name}`}
                    disabled={!!library.busy}
                    onClick={() => { setEditing(asset); setName(asset.name); }}
                  >
                    Rename
                  </Button>
                  <CompactAction
                    icon="trash"
                    tooltip="Delete global sound"
                    label={`Delete global sound ${asset.name}`}
                    danger
                    disabled={!!library.busy}
                    onClick={() => setDeleting(asset)}
                  />
                </Group>
              </>
            )}
          </div>
        ))}
        {!assets.length ? (
          <Text size="sm" c="dimmed" py="lg">
            {library.busy === "load"
              ? "Loading global library…"
              : !library.loaded
                ? "Load the global library to browse saved sounds."
                : library.assets.length
                  ? "No matching audio."
                  : "Your global library is empty. Add sounds from the Session library to reuse them across sessions."}
          </Text>
        ) : null}
      </div>
      <Modal
        opened={!!deleting && !blocked}
        title="Delete global sound?"
        onClose={() => { if (!library.busy) setDeleting(null); }}
        withCloseButton={!library.busy}
        closeOnEscape={!library.busy}
        closeOnClickOutside={!library.busy}
        centered
      >
        <Stack>
          <Text fw={600} style={{ overflowWrap: "anywhere" }}>{deleting?.name}</Text>
          <Text size="sm">
            Permanently delete this sound from the global library? Copies already added to sessions stay available. This cannot be undone.
          </Text>
          {library.error ? <Alert color="red">{library.error}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" disabled={!!library.busy} onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              color="red"
              loading={!!deleting && library.busy === `delete:${deleting.id}`}
              disabled={!!library.busy}
              onClick={async () => {
                if (deleting && await library.remove(deleting)) setDeleting(null);
              }}
            >
              Delete from global library
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
