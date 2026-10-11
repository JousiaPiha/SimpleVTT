import { useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import type { Asset } from "../../../shared/contracts.js";
import { assetSchema } from "../../../shared/contracts.js";
import {
  SOUND_ICONS,
  type SoundboardInput,
} from "../../../shared/soundboard.js";
import { api } from "../../api.js";
import { useEditor } from "../../stores/editor.js";
import { SoundIcon, iconLabel } from "./SoundIcon.js";

export function SoundSettings({
  asset,
  initial,
  groups,
  onSave,
  onClose,
}: {
  asset: Asset;
  initial: SoundboardInput;
  groups: string[];
  onSave: (input: SoundboardInput) => Promise<void>;
  onClose: () => void;
}) {
  const assets = useEditor((s) => s.assets);
  const [draft, setDraft] = useState<SoundboardInput>(() => ({
    group: initial.group,
    icon: initial.icon,
    customIconAssetId: initial.customIconAssetId,
  }));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const image = assets.find((a) => a.id === draft.customIconAssetId);
  const close = () => {
    if (!busy) onClose();
  };
  const upload = async (selected: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", selected);
      const uploaded = await api(
        "/api/admin/assets?category=image",
        { method: "POST", body },
        assetSchema,
      );
      useEditor.setState((s) => ({
        assets: [...s.assets.filter((a) => a.id !== uploaded.id), uploaded],
      }));
      setDraft((d) => ({ ...d, customIconAssetId: uploaded.id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import icon");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      opened
      title={`Sound settings: ${asset.name}`}
      onClose={close}
      centered
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSave({ ...draft, customIconAssetId: image?.id ?? null });
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Settings were not saved",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack gap="md">
          <Autocomplete
            label="Sound group"
            description="Choose an existing group or type a new name. Leave blank for Ungrouped."
            placeholder="e.g. Combat, Nature, Doors"
            data={groups}
            value={draft.group}
            maxLength={60}
            disabled={busy}
            onChange={(group) => setDraft((d) => ({ ...d, group }))}
          />
          <Group gap="sm">
            <SoundIcon name={draft.icon} imageId={image?.id} />
            <Text size="sm">{image ? image.name : iconLabel(draft.icon)}</Text>
          </Group>
          <TextInput
            label="Find a built-in icon"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div
            className="sound-icon-picker"
            role="group"
            aria-label="Built-in icons"
          >
            {SOUND_ICONS.filter((name) =>
              iconLabel(name).toLowerCase().includes(query.toLowerCase()),
            ).map((name) => (
              <Tooltip
                key={name}
                label={iconLabel(name)}
                events={{ hover: true, focus: true, touch: false }}
              >
                <UnstyledButton
                  type="button"
                  className="sound-icon-option"
                  disabled={busy}
                  aria-label={`Use ${iconLabel(name)} icon`}
                  aria-pressed={!image && draft.icon === name}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      icon: name,
                      customIconAssetId: null,
                    }))
                  }
                >
                  <SoundIcon name={name} />
                </UnstyledButton>
              </Tooltip>
            ))}
          </div>
          <Text size="xs" c="dimmed">
            32 Lucide icons, bundled for offline use.
          </Text>
          <Select
            label="Custom icon from library"
            placeholder="Choose an image"
            searchable
            clearable
            value={image?.id ?? null}
            disabled={busy}
            data={assets
              .filter((a) => a.mimeType.startsWith("image/"))
              .map((a) => ({ value: a.id, label: a.name }))}
            onChange={(customIconAssetId) =>
              setDraft((d) => ({ ...d, customIconAssetId }))
            }
          />
          <Group>
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              Upload custom icon
            </Button>
            {image && (
              <Button
                type="button"
                size="xs"
                variant="subtle"
                disabled={busy}
                onClick={() =>
                  setDraft((d) => ({ ...d, customIconAssetId: null }))
                }
              >
                Use built-in icon
              </Button>
            )}
          </Group>
          <input
            ref={file}
            className="file-input"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif"
            aria-label="Custom icon file"
            disabled={busy}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (selected) void upload(selected);
            }}
          />
          <Text size="xs" c="dimmed">
            PNG, WebP, JPEG or GIF. Transparent square images work well. Uploads
            stay in the image library, even if you cancel.
          </Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              type="button"
              variant="default"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save sound settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
