import { useEffect } from "react";
import { SceneCanvas } from "../components/SceneCanvas.js";
import {
  connectPresentation,
  usePresentation,
} from "../stores/presentation.js";
export default function PlayerPage() {
  const scene = usePresentation((s) => s.scene);
  const pointer = usePresentation((s) => s.pointer);
  const generation = usePresentation((s) => s.generation);
  useEffect(connectPresentation, []);
  return (
    <main className="player-page">
      <SceneCanvas key={generation} scene={scene} pointer={pointer} />
    </main>
  );
}
