import { LOOT_PAGE_SIZE, type PublicContent } from "../../shared/content.js";

export interface ContentTextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold?: boolean;
}

export function layoutContent(content: PublicContent): ContentTextBlock[] {
  const padding = Math.min(24, content.height * 0.1);
  const width = content.width - padding * 2;
  const height = content.height - padding * 2;
  const fontSize = content.fontSize;
  const blocks: ContentTextBlock[] = [];
  const add = (
    text: string,
    y: number,
    blockHeight: number,
    size = fontSize,
    bold = false,
  ) => {
    blocks.push({
      text,
      x: padding,
      y: padding + y,
      width,
      height: blockHeight,
      fontSize: size,
      bold,
    });
  };
  if (content.type === "text") {
    add(content.text, 0, height);
    return blocks;
  }

  const pages = Math.max(1, Math.ceil(content.items.length / LOOT_PAGE_SIZE));
  const page = Math.min(content.page, pages - 1);
  const items = content.items.slice(
    page * LOOT_PAGE_SIZE,
    (page + 1) * LOOT_PAGE_SIZE,
  );
  const gap = Math.min(16, height * 0.025);
  const titleHeight = Math.min(fontSize * 1.6, height * 0.16);
  const descriptionHeight = content.description
    ? Math.min(fontSize * 2.1, height * 0.16)
    : 0;
  const footerHeight = pages > 1 ? Math.min(28, height * 0.12) : 0;
  add(content.title, 0, titleHeight, fontSize * 1.25, true);
  let y = titleHeight + gap;
  if (content.description) {
    add(content.description, y, descriptionHeight, fontSize * 0.85);
    y += descriptionHeight + gap;
  }
  const itemsHeight = height - y - footerHeight - (footerHeight ? gap : 0);
  const rowHeight = (itemsHeight - gap * (LOOT_PAGE_SIZE - 1)) / LOOT_PAGE_SIZE;
  if (!items.length) add("No items", y, itemsHeight);
  items.forEach((item, index) => {
    const rowY = y + index * (rowHeight + gap);
    const nameHeight = item.description
      ? Math.min(fontSize * 2.4, rowHeight * 0.5)
      : rowHeight;
    add(`${item.quantity} × ${item.name}`, rowY, nameHeight, fontSize, true);
    if (item.description)
      add(
        item.description,
        rowY + nameHeight,
        rowHeight - nameHeight,
        fontSize * 0.85,
      );
  });
  if (footerHeight)
    add(`${page + 1} / ${pages}`, height - footerHeight, footerHeight, 20);
  return blocks;
}
