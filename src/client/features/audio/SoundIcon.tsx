import { useState } from "react";
import {
  Volume2,
  Swords,
  Shield,
  BowArrow,
  Bomb,
  Flame,
  Zap,
  CloudLightning,
  CloudRain,
  Wind,
  Waves,
  Droplets,
  Trees,
  Bird,
  PawPrint,
  Bug,
  Footprints,
  DoorOpen,
  Bell,
  KeyRound,
  Lock,
  Hammer,
  Pickaxe,
  Coins,
  Gem,
  Skull,
  Ghost,
  Sparkles,
  Heart,
  Laugh,
  Megaphone,
  Music,
  type LucideIcon,
} from "lucide-react";
import type { SoundIcon as IconName } from "../../../shared/soundboard.js";
import { mediaUrl } from "../../api.js";

const icons: Record<IconName, LucideIcon> = {
  "volume-2": Volume2,
  swords: Swords,
  shield: Shield,
  "bow-arrow": BowArrow,
  bomb: Bomb,
  flame: Flame,
  zap: Zap,
  "cloud-lightning": CloudLightning,
  "cloud-rain": CloudRain,
  wind: Wind,
  waves: Waves,
  droplets: Droplets,
  trees: Trees,
  bird: Bird,
  "paw-print": PawPrint,
  bug: Bug,
  footprints: Footprints,
  "door-open": DoorOpen,
  bell: Bell,
  "key-round": KeyRound,
  lock: Lock,
  hammer: Hammer,
  pickaxe: Pickaxe,
  coins: Coins,
  gem: Gem,
  skull: Skull,
  ghost: Ghost,
  sparkles: Sparkles,
  heart: Heart,
  laugh: Laugh,
  megaphone: Megaphone,
  music: Music,
};
export const iconLabel = (name: IconName) =>
  name.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
export function SoundIcon({
  name,
  imageId,
}: {
  name: IconName;
  imageId?: string | null;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const Icon = icons[name];
  return imageId && failedImage !== imageId ? (
    <img
      src={mediaUrl(imageId)}
      alt=""
      width={28}
      height={28}
      className="sound-icon-image"
      onError={() => setFailedImage(imageId)}
    />
  ) : (
    <Icon size={26} strokeWidth={1.7} aria-hidden="true" />
  );
}
