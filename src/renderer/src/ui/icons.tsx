import React from 'react'

type IconProps = { size?: number; className?: string; strokeWidth?: number }

const paths: Record<string, React.ReactNode> = {
  region: <><rect x="3" y="3" width="7" height="7" rx="1" /><path d="M14 3h3a2 2 0 0 1 2 2v3M21 14v3a2 2 0 0 1-2 2h-3M10 21H7a2 2 0 0 1-2-2v-3" /></>,
  window: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  fullscreen: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></>,
  star: <><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9L12 3z" /></>,
  tag: <><path d="M3 7v4.6a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.8-5.8a2 2 0 0 0 0-2.8l-7-7a2 2 0 0 0-1.4-.6H5a2 2 0 0 0-2 2z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5" /></>,
  edit: <><path d="M4 20h4L19 9a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  check: <><path d="M5 12l5 5L20 6" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  sparkles: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  reveal: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M9 13h6" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></>,
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  square: <><rect x="4" y="4" width="16" height="16" rx="2" /></>,
  type: <><path d="M4 7V5h16v2M9 19h6M12 5v14" /></>,
  pen: <><path d="M3 21s1-4 2-5 8-8 8-8l3 3s-7 7-8 8-5 2-5 2z" /></>,
  shield: <><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" /></>,
  wand: <><path d="m15 4 5 5M3 21l9-9M14 5l5 5M9 7l1 1M7 3v3M5 5h3" /></>,
  back: <><path d="M19 12H5M11 18l-6-6 6-6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  inbox: <><path d="M3 12h5l2 3h4l2-3h5M3 12l3-7h12l3 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7z" /></>,
  eraser: <><path d="M8 20H20M5 16l4 4M14.5 5.5l4 4a2 2 0 0 1 0 2.8l-6 6a2 2 0 0 1-2.8 0l-4-4a2 2 0 0 1 0-2.8l6-6a2 2 0 0 1 2.8 0z" /></>,
  scroll: <><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M12 7v4M10 9l2-2 2 2" /></>,
  pipette: <><path d="M19 3a2.8 2.8 0 0 1 0 4l-2 2-2-2 2-2a2.8 2.8 0 0 1 2-2zM13.5 6.5 4 16v4h4l9.5-9.5M11.5 8.5l4 4" /></>,
  browser: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01" /></>,
  ruler: <><path d="M3 9.5 9.5 3 21 14.5 14.5 21 3 9.5zM7 9l1.5 1.5M9.5 6.5 11 8M12 4l1.5 1.5M14.5 6.5 16 8M6.5 11.5 8 13" /></>
}

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: IconProps & { name: string }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  )
}
