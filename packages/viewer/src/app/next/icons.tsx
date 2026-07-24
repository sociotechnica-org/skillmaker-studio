/** Hand-drawn 16px line icons in the brand's stroke weight. */

type IconProps = { readonly size?: number };

export function PanelLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
    </svg>
  );
}

export function PanelRightIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
    </svg>
  );
}

export function OverviewIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="3.5" cy="4.5" r="1" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="4.5" x2="13.5" y2="4.5" />
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="8" x2="13.5" y2="8" />
      <circle cx="3.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="11.5" x2="13.5" y2="11.5" />
    </svg>
  );
}

/** Kanban: three columns, cards at differing heights. */
export function BoardIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2" width="3.4" height="9" rx="0.8" />
      <rect x="6.3" y="2" width="3.4" height="12" rx="0.8" />
      <rect x="11.1" y="2" width="3.4" height="6" rx="0.8" />
    </svg>
  );
}

export function TasksIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 4.5l1.5 1.5L6 3.5" />
      <line x1="8" y1="4.5" x2="14" y2="4.5" />
      <path d="M2 10.5l1.5 1.5L6 9.5" />
      <line x1="8" y1="10.5" x2="14" y2="10.5" />
    </svg>
  );
}

export function ChevronIcon({ open }: { readonly open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 3.5L10.5 8L6 12.5" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

export function GitHubIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 .8a7.2 7.2 0 0 0-2.28 14.03c.36.07.5-.16.5-.35v-1.22c-2 .43-2.43-.97-2.43-.97-.33-.83-.8-1.05-.8-1.05-.66-.45.05-.44.05-.44.72.05 1.1.75 1.1.75.65 1.1 1.7.79 2.1.6.07-.47.26-.79.46-.97-1.6-.18-3.28-.8-3.28-3.56 0-.79.28-1.43.74-1.94-.07-.18-.32-.91.07-1.9 0 0 .6-.2 1.98.74a6.9 6.9 0 0 1 3.6 0c1.38-.93 1.98-.74 1.98-.74.4.99.15 1.72.07 1.9.46.5.74 1.15.74 1.94 0 2.77-1.69 3.38-3.3 3.56.26.22.5.66.5 1.33v1.97c0 .2.13.42.5.35A7.2 7.2 0 0 0 8 .8Z" />
    </svg>
  );
}

export function HelpIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.2 6.2a1.8 1.8 0 1 1 2.7 1.6c-.55.32-.9.6-.9 1.3v.3" />
      <circle cx="8" cy="11.4" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Diagonal arrow out of a corner — expand the panel to full width. */
export function ExpandIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M9.5 2.5h4v4" />
      <line x1="13.5" y1="2.5" x2="9" y2="7" />
      <path d="M6.5 13.5h-4v-4" />
      <line x1="2.5" y1="13.5" x2="7" y2="9" />
    </svg>
  );
}

/** Diagonal arrows into the center — collapse the expanded panel. */
export function CollapseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M7 3v4H3" />
      <line x1="7" y1="7" x2="2.5" y2="2.5" />
      <path d="M9 13V9h4" />
      <line x1="9" y1="9" x2="13.5" y2="13.5" />
    </svg>
  );
}

/** Sun — shown while dark, click for daylight. */
export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1.2" x2="8" y2="3.2" />
      <line x1="8" y1="12.8" x2="8" y2="14.8" />
      <line x1="1.2" y1="8" x2="3.2" y2="8" />
      <line x1="12.8" y1="8" x2="14.8" y2="8" />
      <line x1="3.2" y1="3.2" x2="4.6" y2="4.6" />
      <line x1="11.4" y1="11.4" x2="12.8" y2="12.8" />
      <line x1="12.8" y1="3.2" x2="11.4" y2="4.6" />
      <line x1="4.6" y1="11.4" x2="3.2" y2="12.8" />
    </svg>
  );
}

/** Crescent moon — shown while light, click for the manuscript at night. */
export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M13.2 9.8A5.6 5.6 0 0 1 6.2 2.8a5.6 5.6 0 1 0 7 7Z" />
    </svg>
  );
}

/** Folder — toggles the file-browser column inside the panel. */
export function FolderIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.5 1.8h6.5a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </svg>
  );
}
