import { ActionIcon, Tooltip } from "@mantine/core";

type IconName = "person" | "image" | "eye" | "eye-off" | "trash";
function ActionSymbol({ name }: { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "person" ? (
        <>
          <circle cx="12" cy="4" r="2" />
          <path d="M5 9h14M9 9v6l-2 6m8-12v6l2 6m-8-6h6" />
        </>
      ) : null}
      {name === "image" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 17 5-5 4 4 4-6 5 7" />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : null}
      {name === "eye-off" ? (
        <>
          <path d="m3 3 18 18M10.5 5.1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3 3.8M6.2 6.2A21 21 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : null}
      {name === "trash" ? (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
        </>
      ) : null}
    </svg>
  );
}
export function CompactAction({
  icon,
  label,
  tooltip = label,
  disabled = false,
  danger = false,
  active = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  tooltip?: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip
      label={tooltip}
      withArrow
      openDelay={250}
      events={{ hover: true, focus: true, touch: false }}
    >
      <ActionIcon
        type="button"
        size={30}
        variant="subtle"
        color={active ? "teal" : "gray"}
        className={danger ? "compact-action danger-action" : "compact-action"}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <ActionSymbol name={icon} />
      </ActionIcon>
    </Tooltip>
  );
}
