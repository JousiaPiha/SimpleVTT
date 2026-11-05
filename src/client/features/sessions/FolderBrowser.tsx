import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Folder } from "lucide-react";
import {
  folderListingSchema,
  type FolderListing,
} from "../../../shared/sessions.js";
import { api, json } from "../../api.js";

export function FolderBrowser({
  action,
  onClose,
  onSelect,
  disabled,
}: {
  action: "open" | "save-as";
  onClose: () => void;
  onSelect: (path: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [locations, setLocations] = useState<FolderListing["locations"]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  async function browse(target?: string) {
    const serial = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const value = await api(
        `/api/admin/session/folders${target === undefined ? "" : `?path=${encodeURIComponent(target)}`}`,
        {},
        folderListingSchema,
      );
      if (serial === request.current) {
        setListing(value);
        setLocations(value.locations);
        setPath(value.path ?? "");
      }
    } catch (e) {
      if (serial === request.current) {
        setError(e instanceof Error ? e.message : "Cannot browse this folder.");
        setListing(null);
      }
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void browse();
    return () => {
      request.current++;
    };
  }, []);
  return (
    <Modal
      opened
      onClose={onClose}
      title={action === "open" ? "Open Session" : "Save Session As"}
      size="lg"
      centered
      closeOnClickOutside={!disabled}
      closeOnEscape={!disabled}
      withCloseButton={!disabled}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Folders on the server computer.{" "}
          {action === "save-as"
            ? "Choose an empty folder. The copy becomes active when saving completes."
            : "Choose a folder containing a SimpleVTT session."}
        </Text>
        {listing?.warning && <Alert color="yellow">{listing.warning}</Alert>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void browse(path);
          }}
        >
          <Group align="end" wrap="nowrap">
            <TextInput
              label="Server folder path"
              value={path}
              onChange={(event) => setPath(event.currentTarget.value)}
              style={{ flex: 1 }}
              disabled={disabled || loading}
            />
            <Button
              type="submit"
              variant="default"
              disabled={disabled || loading || !path.trim()}
            >
              Go
            </Button>
          </Group>
        </form>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={() =>
              void browse(
                locations.find((location) => location.name === "Home")?.path,
              )
            }
            disabled={disabled || loading}
          >
            Home
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={() => void browse(listing!.parent!)}
            disabled={disabled || loading || !listing?.parent}
          >
            Up
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={() => setCreating(!creating)}
            disabled={disabled || loading || !listing?.path}
          >
            New Folder
          </Button>
        </Group>
        {!!locations.length && (
          <Group gap="xs">
            {locations
              .filter((location) => location.name !== "Home")
              .map((location) => (
                <Button
                  key={location.path}
                  size="compact-xs"
                  variant="subtle"
                  disabled={disabled || loading}
                  onClick={() => void browse(location.path)}
                >
                  {location.name}
                </Button>
              ))}
          </Group>
        )}
        {creating && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!listing?.path) return;
              setLoading(true);
              setError(null);
              try {
                const value = await api(
                  "/api/admin/session/folders",
                  json("POST", { parent: listing.path, name }),
                  folderListingSchema,
                );
                setListing(value);
                setLocations(value.locations);
                setPath(value.path ?? "");
                setName("");
                setCreating(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Cannot create folder.",
                );
              } finally {
                setLoading(false);
              }
            }}
          >
            <Group align="end" wrap="nowrap">
              <TextInput
                label="New folder name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                disabled={loading || disabled}
                style={{ flex: 1 }}
              />
              <Button
                type="submit"
                disabled={loading || disabled || !name.trim()}
              >
                Create folder
              </Button>
            </Group>
          </form>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <ScrollArea
          h={250}
          style={{
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 4,
          }}
        >
          {loading ? (
            <Group justify="center" p="xl">
              <Loader aria-label="Loading folders" />
            </Group>
          ) : listing?.folders.length ? (
            <Stack gap={0}>
              {listing.folders.map((folder) => (
                <Button
                  key={folder.path}
                  variant="subtle"
                  color="gray"
                  justify="start"
                  radius={0}
                  leftSection={<Folder size={16} />}
                  onClick={() => void browse(folder.path)}
                  disabled={disabled}
                >
                  {folder.name}
                </Button>
              ))}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" p="md">
              No subfolders.
            </Text>
          )}
        </ScrollArea>
        {action === "save-as" && listing && !listing.empty && (
          <Text size="sm" c="yellow">
            This folder contains files. Select or create an empty folder.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={disabled}>
            Cancel
          </Button>
          <Button
            disabled={
              disabled ||
              loading ||
              !listing?.path ||
              path !== listing.path ||
              (action === "save-as" && !listing.empty)
            }
            onClick={async () => {
              if (listing?.path && (await onSelect(listing.path))) onClose();
            }}
          >
            {action === "open" ? "Open this session" : "Save in this folder"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
