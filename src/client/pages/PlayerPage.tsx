import { useEffect } from "react";
import { SceneCanvas } from "../components/SceneCanvas.js";
import {
  connectPresentation,
  usePresentation,
} from "../stores/presentation.js";
export default function PlayerPage() {
  const scene = usePresentation((s) => s.scene);
  const pointer = usePresentation((s) => s.pointer);
  useEffect(connectPresentation, []);
  return (
    <main className="player-page">
      <SceneCanvas scene={scene} pointer={pointer} />
    </main>
  );
}
