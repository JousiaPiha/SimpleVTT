import type { ReactElement } from "react";
import { Tooltip } from "@mantine/core";
import { CircleHelp } from "lucide-react";

export function HelpTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip label={label} withArrow multiline w={280} openDelay={250}
      events={{ hover: true, focus: true, touch: true }}>
      {children}
    </Tooltip>
  );
}

export function HelpLabel({ label, help }: { label: string; help: string }) {
  return (
    <HelpTooltip label={help}>
      <span className="help-label" tabIndex={0}>
        {label}<CircleHelp size={13} aria-hidden="true" />
      </span>
    </HelpTooltip>
  );
}

export const SCAN_MEDIA_HELP = "Find supported images and audio already in this session’s media folder on the server, including subfolders. New files use folder names for categories; existing categories stay unchanged.";
