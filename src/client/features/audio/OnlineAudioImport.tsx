import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Collapse,
  Group,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Link } from "lucide-react";
import type { AudioCategory } from "../../../shared/audio.js";
import {
  onlineAudioBusy,
  onlineAudioInputSchema,
  onlineAudioJobSchema,
  onlineAudioToolsSchema,
  type OnlineAudioJob,
} from "../../../shared/online-audio.js";
import { api, json } from "../../api.js";
import { useEditor } from "../../stores/editor.js";

export function OnlineAudioImport({ category }: { category: AudioCategory }) {
  const [opened, setOpened] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [job, setJob] = useState<OnlineAudioJob | null>(null);
  const [tools, setTools] = useState<{
    ready: boolean;
    missing: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refreshed = useRef<string | null>(null);
  const busy = onlineAudioBusy(job);
  useEffect(() => {
    if (!opened && !busy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void api("/api/admin/online-audio/tools", {}, onlineAudioToolsSchema)
      .then((value) => {
        if (!stopped) setTools(value);
      })
      .catch((error) => {
        if (!stopped)
          setError(
            error instanceof Error
              ? error.message
              : "Could not check import tools.",
          );
      });
    const poll = async () => {
      try {
        const result = await api(
          "/api/admin/online-audio/job",
          {},
          onlineAudioJobSchema.nullable(),
        );
        if (stopped) return;
        setJob(result);
        if (result?.status === "complete" && refreshed.current !== result.id) {
          refreshed.current = result.id;
          await useEditor.getState().refreshAssets();
        }
      } catch (error) {
        if (!stopped)
          setError(
            error instanceof Error
              ? error.message
              : "Cannot check import progress.",
          );
      } finally {
        if (!stopped) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [opened, busy]);
  const label = category === "effect" ? "sound effect" : category;
  const phase = job
    ? {
        checking: "Checking import tools…",
        downloading: "Downloading…",
        converting: "Converting to MP3…",
        saving: "Saving to library…",
        complete: "Imported",
        failed: "Import failed",
        cancelled: "Import cancelled",
      }[job.status]
    : "";
  return (
    <div className="online-audio-import">
      <Button
        size="xs"
        variant="subtle"
        leftSection={<Link size={14} />}
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
      >
        Import from URL
      </Button>
      <Collapse expanded={opened}>
        <Stack gap="xs" py="xs">
          <Text size="xs" c="dimmed">
            Import one track as {label}. Choose a category using “Import as”
            above. Downloads stay on this computer for offline playback.
          </Text>
          {tools && !tools.ready && (
            <Alert color="yellow" title="Import tools unavailable">
              Install {tools.missing.join(", ")} on the server. See README →
              Online audio imports. Reopen this panel after installation.
            </Alert>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              const input = onlineAudioInputSchema.safeParse({
                url,
                category,
                name,
              });
              if (!input.success) {
                setError(input.error.issues[0].message);
                return;
              }
              setSubmitting(true);
              try {
                setJob(
                  await api(
                    "/api/admin/online-audio/job",
                    json("POST", input.data),
                    onlineAudioJobSchema,
                  ),
                );
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : "Import failed.",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Stack gap="xs">
              <TextInput
                label="Media URL"
                placeholder="https://…"
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                disabled={busy || submitting}
                required
                type="url"
                maxLength={4096}
              />
              <Group align="end" grow>
                <TextInput
                  label="Name (optional)"
                  placeholder="Use the source title"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  disabled={busy || submitting}
                  maxLength={120}
                />
                <Button
                  type="submit"
                  size="xs"
                  disabled={busy || !tools?.ready || !url.trim()}
                  loading={submitting}
                >
                  Download audio
                </Button>
              </Group>
            </Stack>
          </form>
          {error && (
            <Alert color="red" withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {job && (
            <Stack gap={4} role="status" aria-live="polite">
              <Group justify="space-between">
                <Text size="sm">
                  {phase} · {job.title}
                </Text>
                {busy && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    disabled={job.status === "saving"}
                    onClick={async () => {
                      try {
                        await api(
                          `/api/admin/online-audio/job/${job.id}`,
                          json("DELETE"),
                        );
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : "Could not cancel.",
                        );
                      }
                    }}
                  >
                    Cancel import
                  </Button>
                )}
              </Group>
              {busy && (
                <Progress
                  aria-label="Audio import progress"
                  value={job.progress ?? 0}
                  animated
                />
              )}
              {job.status === "complete" && (
                <Text size="xs" c="teal">
                  {job.asset?.name} is ready in{" "}
                  {job.category === "effect" ? "Sound effects" : job.category}.
                </Text>
              )}
              {job.error && (
                <Alert
                  color="red"
                  style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
                >
                  {job.error}
                </Alert>
              )}
            </Stack>
          )}
        </Stack>
      </Collapse>
    </div>
  );
}
