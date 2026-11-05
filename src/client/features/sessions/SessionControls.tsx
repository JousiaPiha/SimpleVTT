import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { FolderOpen } from "lucide-react";
import {
  sessionStatusSchema,
  type SessionAction,
  type SessionStatus,
} from "../../../shared/sessions.js";
import { api, json } from "../../api.js";
import { useEditor } from "../../stores/editor.js";
import { useAudioStore } from "../audio/store.js";
import { useSessionDrafts } from "./drafts.js";
import { FolderBrowser } from "./FolderBrowser.js";
import { prepareSessionTransition } from "./transition.js";

export function SessionControls({
  status,
  onStatus,
  disabled,
  onWorking,
}: {
  status: SessionStatus | null;
  onStatus: (status: SessionStatus, discard?: boolean) => void;
  disabled: boolean;
  onWorking: (working: boolean) => void;
}) {
  const [picker, setPicker] = useState<"open" | "save-as" | null>(null);
  const [confirmation, setConfirmation] = useState<"clear" | "close" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = working || !!status?.busy;
  async function perform(action: SessionAction, path?: string, force = false) {
    setError(null);
    setWorking(true);
    onWorking(true);
    try {
      if (action !== "retry" && !force) {
        await prepareSessionTransition({
          drafts: () => useSessionDrafts.getState().drafts,
          pending: () => useEditor.getState().pending,
          saveFailed: () => useEditor.getState().saveFailed,
          audioBusy: () => useAudioStore.getState().busy,
          saveAudio: () => useAudioStore.getState().savePreferences(),
        });
      }
      const next = await api(
        "/api/admin/session/operations",
        json("POST", {
          action,
          ...(path ? { path } : {}),
          ...(force ? { force } : {}),
        }),
        sessionStatusSchema,
      );
      onStatus(next, force);
      setConfirmation(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session operation failed.");
      return false;
    } finally {
      setWorking(false);
      onWorking(false);
    }
  }
  return (
    <>
      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <Button
            size="xs"
            variant="default"
            maw={220}
            styles={{ label: { overflow: "hidden", textOverflow: "ellipsis" } }}
            leftSection={<FolderOpen size={15} />}
            loading={busy}
            title={status?.active?.path}
            aria-label="Sessions"
          >
            {status?.active?.name ?? "No active session"}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Sessions · autosaved on server</Menu.Label>
          <Menu.Item
            disabled={busy || disabled}
            onClick={() => setPicker("open")}
          >
            Open Session…
          </Menu.Item>
          <Menu.Item
            disabled={busy || disabled || !status?.active || !!status.error}
            onClick={() => setPicker("save-as")}
          >
            Save Session As…
          </Menu.Item>
          <Menu.Item
            disabled={
              busy || disabled || !status?.active || status.active.isDefault
            }
            onClick={() =>
              status?.error ? setConfirmation("close") : void perform("close")
            }
          >
            Close Session
          </Menu.Item>
          <Menu.Item
            disabled={
              busy || disabled || !status?.active?.isDefault || !!status.error
            }
            color="red"
            onClick={() => setConfirmation("clear")}
          >
            Clear Default Session…
          </Menu.Item>
          {(status?.error || !status?.active) && (
            <Menu.Item disabled={busy} onClick={() => void perform("retry")}>
              Retry session storage
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      {picker && (
        <FolderBrowser
          action={picker}
          disabled={busy}
          onClose={() => setPicker(null)}
          onSelect={(path) => perform(picker, path)}
        />
      )}
      <Modal
        opened={!!error}
        onClose={() => setError(null)}
        title="Session needs attention"
        centered
      >
        <Text size="sm">{error}</Text>
        <Group justify="flex-end" mt="md">
          <Button onClick={() => setError(null)}>Back to workspace</Button>
        </Group>
      </Modal>
      <Modal
        opened={!!confirmation}
        onClose={() => setConfirmation(null)}
        title={
          confirmation === "clear"
            ? "Clear Default Session?"
            : "Leave unavailable session?"
        }
        centered
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text size="sm">
            {confirmation === "clear"
              ? "This clears all scenes, indexed assets, playlists, soundboard assignments and saved audio preferences in Default Session. Named sessions and machine configuration remain."
              : "Saving has stopped. Returning to Default Session discards local unsaved edits and drafts. The unavailable folder may contain incomplete saves and is not confirmed safe to transfer."}
          </Text>
          {confirmation === "clear" && status?.active?.externalMedia && (
            <Alert color="yellow">
              External media files remain on disk. Their library references will
              be removed.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={() =>
                void perform(
                  confirmation === "clear" ? "clear" : "close",
                  undefined,
                  confirmation === "close",
                )
              }
            >
              {confirmation === "clear"
                ? "Clear Default Session"
                : "Discard local edits and return"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function SessionProgress({ status }: { status: SessionStatus | null }) {
  const operation = status?.operation;
  if (!operation || operation.status === "complete") return null;
  return (
    <Alert
      color={operation.status === "failed" ? "red" : "blue"}
      title={
        operation.status === "failed"
          ? "Session operation failed"
          : "Session operation in progress"
      }
      role="status"
    >
      {operation.error ?? operation.message}
      {operation.status === "running" && (
        <Progress
          mt="xs"
          value={operation.progress ?? 0}
          animated
          aria-label="Session operation progress"
        />
      )}
    </Alert>
  );
}
