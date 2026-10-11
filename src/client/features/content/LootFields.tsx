import {
  Button,
  Group,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { SceneContent } from "../../../shared/content.js";
type Loot = Extract<SceneContent, { type: "loot" }>;
export function LootFields({
  item,
  onChange,
}: {
  item: Loot;
  onChange: (patch: Partial<Loot>) => void;
}) {
  return (
    <Stack gap="xs">
      <TextInput
        label="Loot title"
        value={item.title}
        maxLength={120}
        onChange={(e) => onChange({ title: e.currentTarget.value })}
      />
      <Textarea
        label="Loot description"
        value={item.description}
        maxLength={600}
        autosize
        minRows={2}
        maxRows={4}
        onChange={(e) => onChange({ description: e.currentTarget.value })}
      />
      <Text size="xs" c="dimmed">
        Four items are displayed per page. Use the page controls after saving.
      </Text>
      {item.items.map((entry, index) => (
        <div className="loot-item-editor" key={index}>
          <TextInput
            label={`Item ${index + 1} name`}
            value={entry.name}
            maxLength={120}
            onChange={(e) => {
              const name = e.currentTarget.value;
              onChange({
                items: item.items.map((v, i) =>
                  i === index ? { ...v, name } : v,
                ),
              });
            }}
          />
          <NumberInput
            label={`Item ${index + 1} quantity`}
            value={entry.quantity}
            min={1}
            max={999999}
            allowDecimal={false}
            onChange={(quantity) => {
              if (typeof quantity === "number")
                onChange({
                  items: item.items.map((v, i) =>
                    i === index ? { ...v, quantity } : v,
                  ),
                });
            }}
          />
          <Textarea
            label={`Item ${index + 1} description`}
            value={entry.description}
            maxLength={300}
            autosize
            minRows={1}
            maxRows={3}
            onChange={(e) => {
              const description = e.currentTarget.value;
              onChange({
                items: item.items.map((v, i) =>
                  i === index ? { ...v, description } : v,
                ),
              });
            }}
          />
          <Group justify="flex-end">
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              aria-label={`Remove item ${index + 1}`}
              onClick={() =>
                onChange({ items: item.items.filter((_, i) => i !== index) })
              }
            >
              Remove item
            </Button>
          </Group>
        </div>
      ))}
      <Button
        size="xs"
        variant="light"
        disabled={item.items.length >= 100}
        onClick={() =>
          onChange({
            items: [
              ...item.items,
              { name: "New item", quantity: 1, description: "" },
            ],
          })
        }
      >
        Add loot item
      </Button>
    </Stack>
  );
}
