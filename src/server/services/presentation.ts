import type {
  PresentationEvent,
  PublicScene,
  Scene,
} from "../../shared/contracts.js";
import type { PublicContent } from "../../shared/content.js";

// This allowlist is the privacy boundary. Never serialize a Scene to a player.
export function publicScene(
  scene: Scene | null,
  isPublicAsset: (id: string) => boolean = () => true,
): PublicScene | null {
  if (!scene) return null;
  return {
    id: scene.id,
    drawings: (scene.drawings ?? []).map(
      ({ id, type, color, width, points }) => ({
        id,
        type,
        color,
        width,
        points,
      }),
    ),
    gridEnabled: scene.gridEnabled,
    gridSize: scene.gridSize,
    gridColor: scene.gridColor,
    backgroundAssetId:
      scene.backgroundAssetId && isPublicAsset(scene.backgroundAssetId)
        ? scene.backgroundAssetId
        : null,
    objects: scene.objects
      .filter((o) => o.visible && isPublicAsset(o.assetId))
      .map((o) => ({
        id: o.id,
        assetId: o.assetId,
        x: o.x,
        y: o.y,
        scale: o.scale,
        rotation: o.rotation,
        zIndex: o.zIndex,
        width: o.width,
        height: o.height,
      })),
    content: scene.content
      .filter((item) => item.visible)
      .map((item): PublicContent => {
        const base = {
          id: item.id,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          fontSize: item.fontSize,
          color: item.color,
          align: item.align,
          panel: item.panel,
          zIndex: item.zIndex,
        };
        return item.type === "text"
          ? { ...base, type: "text", text: item.text }
          : {
              ...base,
              type: "loot",
              title: item.title,
              description: item.description,
              items: item.items.map(({ name, quantity, description }) => ({
                name,
                quantity,
                description,
              })),
              page: item.page,
            };
      }),
  };
}

export function diffPresentation(
  before: PublicScene | null,
  after: PublicScene | null,
): PresentationEvent | null {
  if (before?.id !== after?.id)
    return { type: "presentation.snapshot", scene: after };
  if (!before || !after) return null;
  const old = new Map(before.objects.map((o) => [o.id, o]));
  const currentIds = new Set(after.objects.map((o) => o.id));
  const upserts = after.objects.filter(
    (o) => JSON.stringify(old.get(o.id)) !== JSON.stringify(o),
  );
  const removed = before.objects
    .filter((o) => !currentIds.has(o.id))
    .map((o) => o.id);
  const oldContent = new Map(before.content.map((item) => [item.id, item]));
  const contentIds = new Set(after.content.map((item) => item.id));
  const contentUpserts = after.content.filter(
    (item) => JSON.stringify(oldContent.get(item.id)) !== JSON.stringify(item),
  );
  const contentRemoved = before.content
    .filter((item) => !contentIds.has(item.id))
    .map((item) => item.id);
  const oldDrawings = new Map((before.drawings ?? []).map((d) => [d.id, d]));
  const drawingIds = new Set((after.drawings ?? []).map((d) => d.id));
  const drawingUpserts = (after.drawings ?? []).filter(
    (d) => JSON.stringify(oldDrawings.get(d.id)) !== JSON.stringify(d),
  );
  const drawingRemoved = (before.drawings ?? [])
    .filter((d) => !drawingIds.has(d.id))
    .map((d) => d.id);
  if (
    !drawingUpserts.length &&
    !drawingRemoved.length &&
    !upserts.length &&
    !removed.length &&
    !contentUpserts.length &&
    !contentRemoved.length &&
    before.backgroundAssetId === after.backgroundAssetId &&
    before.gridEnabled === after.gridEnabled &&
    before.gridSize === after.gridSize &&
    before.gridColor === after.gridColor
  )
    return null;
  return {
    type: "presentation.patch",
    sceneId: after.id,
    gridEnabled: after.gridEnabled,
    gridSize: after.gridSize,
    gridColor: after.gridColor,
    backgroundAssetId: after.backgroundAssetId,
    upserts,
    removed,
    contentUpserts,
    contentRemoved,
    drawingUpserts,
    drawingRemoved,
  };
}
