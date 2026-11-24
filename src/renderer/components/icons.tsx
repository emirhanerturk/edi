// Simgeler: 16'lık ızgarada çizgi SVG. Renk `currentColor`'dan gelir.
import type { ReactNode, SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  /** Verilirse simge anlam taşır ve ekran okuyucuya okunur; verilmezse süstür. */
  label?: string;
}

function Icon({ size = 14, label, strokeWidth = 1.6, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: 'none' }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z" />
  </Icon>
);
export const ChevronDown = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);
export const ChevronRight = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);
/** Claude Code işareti: sekiz kollu yıldız. */
export const ClaudeMark = (p: IconProps) => (
  <Icon strokeWidth={1.9} stroke="var(--claude)" {...p}>
    <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />
  </Icon>
);
export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4.5l3.5 3.5L3 11.5M8.5 11.5H13" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon strokeWidth={1.7} {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3z" />
    <path d="M6.8 14.2a1.3 1.3 0 0 0 2.4 0" />
  </Icon>
);
export const ArrowUp = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);
export const ArrowDown = (p: IconProps) => (
  <Icon strokeWidth={1.9} {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M3 8.5l3.2 3.2L13 5" />
  </Icon>
);
export const WarningIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.2l6.3 11.1H1.7z" />
    <path d="M8 6.6v3.2M8 11.6v.1" />
  </Icon>
);
export const BranchIcon = (p: IconProps) => (
  <Icon strokeLinejoin="miter" {...p}>
    <circle cx="4.5" cy="3.5" r="1.7" />
    <circle cx="4.5" cy="12.5" r="1.7" />
    <circle cx="11.5" cy="5.5" r="1.7" />
    <path d="M4.5 5.2v5.6M11.5 7.2c0 2.6-7 1.4-7 3.6" />
  </Icon>
);
export const MinusIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M3.5 8h9" />
  </Icon>
);
export const StageIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);
export const FetchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
  </Icon>
);
export const RescanIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </Icon>
);
/** Süren işlem: dönen yay. */
export const Spinner = (p: IconProps) => (
  <Icon className="spin" {...p}>
    <path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
  </Icon>
);
