// Icons: line SVGs on a 16-unit grid. Color comes from `currentColor`.
import type { ReactNode, SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  /** If given, the icon carries meaning and is read by screen readers; if not, it's decorative. */
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
/** Claude Code mark: an eight-pointed star. */
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
/** Operation in progress: a spinning arc. */
export const Spinner = (p: IconProps) => (
  <Icon className="spin" {...p}>
    <path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
  </Icon>
);

/** Open externally (in another app). */
export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 3.5H3.5v9h9v-3M9.5 2.5h4v4M13.5 2.5l-6 6" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <rect x="3.5" y="7.5" width="9" height="6" rx="1" />
    <path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);
export const FileIcon = (p: IconProps) => (
  <Icon strokeWidth={1.4} {...p}>
    <path d="M4 1.5h5l3 3v10H4z" />
    <path d="M9 1.5v3h3" />
  </Icon>
);
/** Collapse all: two arrows pointing inward. */
export const CollapseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6.5L8 3l3.5 3.5M4.5 9.5L8 13l3.5-3.5" />
  </Icon>
);

/** Collapse all (commit files): two arrows pointing at each other. */
export const FoldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 2L8 5.5 11.5 2M4.5 14L8 10.5l3.5 3.5" />
  </Icon>
);

/** Expand all: two arrows pointing outward. */
export const ExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 4.5L8 1l3.5 3.5M4.5 11.5L8 15l3.5-3.5" />
  </Icon>
);

export const CommitIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M1.5 8h3.9M10.6 8h3.9" />
  </Icon>
);

export const TagIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
    <circle cx="5.6" cy="5.6" r="0.7" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);

/** A web link: the globe beside a project's main link on its card. */
export const GlobeIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M1.75 8h12.5M8 1.75c1.7 1.8 2.55 3.9 2.55 6.25S9.7 12.45 8 14.25C6.3 12.45 5.45 10.35 5.45 8S6.3 3.55 8 1.75z" />
  </Icon>
);

/** Opens in the browser: next to a link written out. */
export const LinkArrow = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M5 11l6-6M6.5 5H11v4.5" />
  </Icon>
);

/** The main link; filled when `filled`. */
export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon strokeWidth={1.4} fill={filled ? 'currentColor' : 'none'} {...p}>
    <path d="M8 1.9l1.85 3.85 4.2.55-3.07 2.9.78 4.15L8 11.3l-3.76 2.05.78-4.15L1.95 6.3l4.2-.55z" />
  </Icon>
);

/** More actions: three dots. */
export const MoreIcon = (p: IconProps) => (
  <Icon stroke="none" fill="currentColor" {...p}>
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </Icon>
);

/** A file's history: a clock with an arrow going back. */
export const HistoryIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8L2.6 5.8" />
    <path d="M2.6 2.6v3.2h3.2" />
    <path d="M8 5.2v3l2.1 1.3" />
  </Icon>
);
/** Search: a magnifier. */
export const SearchIcon = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4L14 14" />
  </Icon>
);
