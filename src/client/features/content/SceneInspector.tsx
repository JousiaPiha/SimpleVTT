import { useEffect, useState } from "react";
import { Tabs } from "@mantine/core";
import { Inspector } from "../../components/Inspector.js";
import { useEditor } from "../../stores/editor.js";
import { ContentPanel } from "./ContentPanel.js";
export function SceneInspector() {
  const { selectedContentId, selectedId } = useEditor();
  const [tab, setTab] = useState<string | null>("objects");
  useEffect(() => {
    if (selectedContentId) setTab("content");
    else if (selectedId) setTab("objects");
  }, [selectedContentId, selectedId]);
  return (
    <aside className="scene-inspector panel">
      <Tabs value={tab} onChange={setTab} keepMounted>
        <Tabs.List grow>
          <Tabs.Tab value="objects">Objects</Tabs.Tab>
          <Tabs.Tab value="content">Text & loot</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="objects">
          <Inspector />
        </Tabs.Panel>
        <Tabs.Panel value="content">
          <ContentPanel />
        </Tabs.Panel>
      </Tabs>
    </aside>
  );
}
