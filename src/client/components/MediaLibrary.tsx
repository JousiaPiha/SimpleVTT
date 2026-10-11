import { useRef, useState } from "react";
import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { useEditor } from "../stores/editor.js";
import type { Asset } from "../../shared/contracts.js";
import { CompactAction } from "./CompactAction.js";
import { DeleteAssetDialog } from "./DeleteAssetDialog.js";
import { mediaUrl } from "../api.js";

export function MediaLibrary() {
  const {
    assets,
    scene,
    pending,
    loading,
    importImages,
    scan,
    addObject,
    updateScene,
  } = useEditor();
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Asset["category"]>("image");
  const [filter, setFilter] = useState("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const images = assets.filter((a) => a.mimeType.startsWith("image/"));
  const filtered = images.filter(
    (a) =>
      a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === "all" || a.category === filter),
  );
  return (
    <section className="media-library">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Media library</Text>
        <Text size="xs" c="dimmed">
          {images.length} images
        </Text>
      </Group>
      <Stack gap="xs">
        <TextInput
          aria-label="Search media"
          placeholder="Search images…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          aria-label="Filter media category"
          value={filter}
          onChange={(value) => setFilter(value ?? "all")}
          data={[
            { value: "all", label: "All images" },
            { value: "background", label: "Backgrounds" },
            { value: "sprite", label: "Sprites" },
            { value: "image", label: "Other images" },
          ]}
        />
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Import category"
            value={category}
            onChange={(value) =>
              setCategory((value ?? "image") as Asset["category"])
            }
            data={[
              { value: "background", label: "Background" },
              { value: "sprite", label: "Sprite" },
              { value: "image", label: "Image" },
            ]}
            style={{ flex: 1 }}
          />
          <Button
            variant="light"
            onClick={() => fileInput.current?.click()}
            disabled={pending > 0}
          >
            Import
          </Button>
        </Group>
        <input
          ref={fileInput}
          className="file-input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Import images"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void importImages(files, category);
            e.target.value = "";
          }}
        />
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          onClick={() => void scan()}
          disabled={pending > 0}
        >
          Scan media folder
        </Button>
      </Stack>
      <div className="media-items">
        {!filtered.length ? (
          <Text size="sm" c="dimmed" py="lg">
            {images.length
              ? "No matching images."
              : "Import PNG, JPEG, WebP, or GIF images, or scan your media folder."}
          </Text>
        ) : (
          filtered.map((asset) => (
            <div className="media-item" key={asset.id}>
              <div className="asset-preview">
                <img
                  src={mediaUrl(asset.id)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.opacity = "0";
                  }}
                />
              </div>
              <div className="asset-info">
                <Text size="sm" truncate title={asset.name}>
                  {asset.name}
                </Text>
                <Text size="xs" c="dimmed" tt="capitalize">
                  {asset.category}
                </Text>
                <Group gap={4} mt={6} wrap="nowrap">
                  <CompactAction
                    icon="person"
                    tooltip="Add sprite"
                    label={`Add ${asset.name} to scene`}
                    disabled={!scene || loading || pending > 0}
                    onClick={() => void addObject(asset)}
                  />
                  <CompactAction
                    icon="image"
                    tooltip="Set background"
                    label={`Set ${asset.name} as background`}
                    disabled={!scene || loading || pending > 0}
                    onClick={() =>
                      void updateScene({ backgroundAssetId: asset.id })
                    }
                  />
                  <CompactAction
                    icon="trash"
                    tooltip="Delete image"
                    label={`Delete image ${asset.name}`}
                    danger
                    disabled={pending > 0}
                    onClick={() => setDeleting(asset)}
                  />
                </Group>
              </div>
            </div>
          ))
        )}
      </div>
      {deleting ? (
        <DeleteAssetDialog asset={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </section>
  );
}
