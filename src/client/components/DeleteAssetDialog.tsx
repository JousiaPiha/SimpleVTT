import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { z } from "zod";
import type { Asset } from "../../shared/contracts.js";
import { api } from "../api.js";
import { useEditor } from "../stores/editor.js";
import { useAudioStore } from "../features/audio/store.js";
const usageSchema = z.object({
  sceneCount: z.number().int().nonnegative(),
  backgroundCount: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  playlistCount: z.number().int().nonnegative(),
  trackCount: z.number().int().nonnegative(),
  soundboardIconCount: z.number().int().nonnegative().default(0),
});
type Usage = z.infer<typeof usageSchema>;
export function DeleteAssetDialog({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useEditor((s) => s.pending);
  const audioBusy = useAudioStore((s) => s.busy);
  useEffect(() => {
    let active = true;
    setUsage(null);
    setError(null);
    void api(`/api/admin/assets/${asset.id}/usage`, {}, usageSchema)
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not check usage");
      });
    return () => {
      active = false;
    };
  }, [asset.id, retry]);
  return (
    <Modal
      opened
      title={`Delete ${asset.mimeType.startsWith("audio/") ? "sound" : "image"}?`}
      onClose={() => {
        if (!deleting) onClose();
      }}
      closeOnClickOutside={!deleting}
      closeOnEscape={!deleting}
      withCloseButton={!deleting}
      centered
    >
      <Stack>
        <Text fw={600} style={{ overflowWrap: "anywhere" }}>
          {asset.name}
        </Text>
        <Text size="sm">
          This permanently deletes the file from your media folder and removes
          it from the library. This cannot be undone.
        </Text>
        {usage ? (
          <Text size="sm" data-testid="asset-usage">
            Used in {usage.sceneCount} scene(s): {usage.backgroundCount}{" "}
            background(s), {usage.objectCount} image object(s). Used in{" "}
            {usage.playlistCount} playlist(s): {usage.trackCount} track
            entry/entries. Used as {usage.soundboardIconCount} soundboard
            icon(s).
          </Text>
        ) : !error ? (
          <Loader size="sm" aria-label="Checking asset usage" />
        ) : null}
        <Text size="sm">
          All of these references will be removed. A live background or sprite
          disappears immediately; playback of this sound stops. Other media and
          scene content stay unchanged. Custom soundboard icons revert to their
          built-in icon.
        </Text>
        {error ? (
          <Alert color="red">
            {error}
            {!usage ? (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setRetry((r) => r + 1)}
              >
                Retry usage check
              </Button>
            ) : null}
          </Alert>
        ) : null}
        <Group justify="flex-end">
          <Button variant="default" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            disabled={!usage || pending > 0 || audioBusy}
            loading={deleting}
            onClick={async () => {
              setDeleting(true);
              setError(null);
              if (await useEditor.getState().deleteAsset(asset.id)) {
                useAudioStore.getState().forgetAsset(asset.id);
                onClose();
              } else {
                setError(
                  useEditor.getState().error ??
                    "Deletion failed. The asset was not removed.",
                );
                setDeleting(false);
              }
            }}
          >
            Delete permanently
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
