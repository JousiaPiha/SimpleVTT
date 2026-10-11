import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { Settings2 } from "lucide-react";
import { z } from "zod";
import type { Asset } from "../../../shared/contracts.js";
import {
  DEFAULT_SOUND,
  soundboardEntrySchema,
  type SoundboardEntry,
  type SoundboardInput,
} from "../../../shared/soundboard.js";
import { api, json } from "../../api.js";
import { useEditor } from "../../stores/editor.js";
import { audioEngine, useAudioStore } from "./store.js";
import { SoundIcon } from "./SoundIcon.js";
import { SoundSettings } from "./SoundSettings.js";

export function Soundboard() {
  const assets = useEditor((s) => s.assets);
  const enabled = useAudioStore((s) => s.snapshot.enabled);
  const [entries, setEntries] = useState<SoundboardEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    let active = true;
    void api("/api/admin/soundboard", {}, z.array(soundboardEntrySchema))
      .then((result) => {
        if (active) {
          setEntries(result);
          setReady(true);
          setError(null);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load soundboard",
          );
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const effects = assets.filter((a) => a.category === "effect");
  const settings = new Map(entries.map((entry) => [entry.assetId, entry]));
  const imageIds = new Set(
    assets.filter((a) => a.mimeType.startsWith("image/")).map((a) => a.id),
  );
  const groups = [
    ...new Set(
      effects.map((a) => settings.get(a.id)?.group ?? "").filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const validFilter =
    filter.startsWith("group:") && !groups.includes(filter.slice(6))
      ? "all"
      : filter;
  const matches = effects.filter((a) => {
    const group = settings.get(a.id)?.group ?? "";
    return (
      (validFilter === "all" ||
        (validFilter === "ungrouped"
          ? !group
          : group === validFilter.slice(6))) &&
      `${a.name} ${group}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    );
  });
  const sections = [...groups, ""]
    .map((group) => ({
      group,
      sounds: matches.filter(
        (a) => (settings.get(a.id)?.group ?? "") === group,
      ),
    }))
    .filter((s) => s.sounds.length);
  const save = async (input: SoundboardInput) => {
    if (!editing) return;
    const entry = await api(
      `/api/admin/soundboard/${editing.id}`,
      json("PUT", input),
      soundboardEntrySchema,
    );
    setEntries((old) => [
      ...old.filter((e) => e.assetId !== entry.assetId),
      entry,
    ]);
    setFilter("all");
    setEditing(null);
  };
  return (
    <Stack gap="sm">
      <Group align="end" gap="sm" className="soundboard-toolbar">
        <TextInput
          label="Search sounds"
          placeholder="Name or group…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Select
          label="Soundboard group"
          value={validFilter}
          onChange={(value) => setFilter(value ?? "all")}
          data={[
            { value: "all", label: "All groups" },
            { value: "ungrouped", label: "Ungrouped" },
            ...groups.map((g) => ({ value: `group:${g}`, label: g })),
          ]}
        />
      </Group>
      {error && (
        <Alert color="red">
          {error}{" "}
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setRetry((r) => r + 1)}
          >
            Retry soundboard
          </Button>
        </Alert>
      )}
      {!ready && !error && (
        <Text size="sm" c="dimmed">
          Loading soundboard…
        </Text>
      )}
      <div className="soundboard">
        {sections.map(({ group, sounds }) => (
          <section
            className="soundboard-group"
            key={group}
            aria-label={`${group || "Ungrouped"} sounds`}
          >
            <Text component="h3" size="xs" fw={600} c="dimmed" mb="xs">
              {group || "Ungrouped"} · {sounds.length}
            </Text>
            <div className="soundboard-grid">
              {sounds.map((asset) => {
                const entry = settings.get(asset.id) ?? DEFAULT_SOUND;
                return (
                  <div key={asset.id} className="soundboard-card">
                    <UnstyledButton
                      className="soundboard-trigger"
                      disabled={!enabled}
                      aria-label={`Trigger ${asset.name}`}
                      onClick={() => void audioEngine.triggerEffect(asset)}
                      title={asset.name}
                    >
                      <SoundIcon
                        name={entry.icon}
                        imageId={
                          entry.customIconAssetId &&
                          imageIds.has(entry.customIconAssetId)
                            ? entry.customIconAssetId
                            : null
                        }
                      />
                      <span>{asset.name}</span>
                    </UnstyledButton>
                    <Tooltip
                      label="Group & icon"
                      events={{ hover: true, focus: true, touch: false }}
                    >
                      <ActionIcon
                        className="soundboard-settings"
                        size={26}
                        variant="subtle"
                        color="gray"
                        disabled={!ready}
                        aria-label={`Configure ${asset.name}`}
                        onClick={() => setEditing(asset)}
                      >
                        <Settings2 size={15} aria-hidden="true" />
                      </ActionIcon>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {!matches.length && (
          <Text size="sm" c="dimmed" py="md">
            {effects.length
              ? "No matching sounds."
              : "Import short sound effects in the Library tab. Trigger them repeatedly to overlap."}
          </Text>
        )}
      </div>
      {editing && assets.some((a) => a.id === editing.id) && (
        <SoundSettings
          key={editing.id}
          asset={editing}
          initial={settings.get(editing.id) ?? DEFAULT_SOUND}
          groups={groups}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
