import { ReactNode } from 'react';

export interface IconProps { size?: number; color?: string; className?: string; 'aria-label'?: string }

const mk = (body: ReactNode) =>
  function Icon({ size = 18, color = 'currentColor', className, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={rest['aria-label'] ? undefined : true} {...rest}>
        {body}
      </svg>
    );
  };

export const Radar = mk(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6.5-6" /></>);
export const Boxes = mk(<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />);
export const Route = mk(<><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8.2 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8" /></>);
export const GitMerge = mk(<><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M6 7.2v9.6M8 12h7.8M6 7.2c0 3 3 4.8 6 4.8" /></>);
export const Filter = mk(<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z" />);
export const Network = mk(<><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M12 7.2v4M12 11.2l-6 5M12 11.2l6 5" /></>);
export const Camera = mk(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13.2" r="3.5" /></>);
export const Share2 = mk(<><circle cx="18" cy="5" r="2.4" /><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="19" r="2.4" /><path d="M8.2 10.9l7.6-4.8M8.2 13.1l7.6 4.8" /></>);
export const Trophy = mk(<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 14v4M8 21h8" />);
export const Check = mk(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const ChevronDown = mk(<path d="M6 9l6 6 6-6" />);
export const ChevronRight = mk(<path d="M9 6l6 6-6 6" />);
export const Home = mk(<path d="M4 11l8-7 8 7M6 10v10h12V10" />);
export const ArrowDownToLine = mk(<path d="M12 4v12M7 11l5 5 5-5M5 20h14" />);
export const ScanLine = mk(<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />);
export const PanelLeft = mk(<path d="M4 5h16v14H4zM9 5v14" />);
export const Eye = mk(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = mk(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><path d="M4 4l16 16" /></>);
export const Undo2 = mk(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />);
export const RotateCcw = mk(<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />);
export const Download = mk(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />);
export const Upload = mk(<path d="M12 16V5M7 9l5-5 5 5M5 20h14" />);
export const Settings2 = mk(<><path d="M4 8h10M18 8h2M4 16h2M10 16h10" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></>);
export const FolderOpen = mk(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 10h19l-2 8H5z" />);
export const PanelRightClose = mk(<path d="M4 5h16v14H4zM15 5v14M8 10l2 2-2 2" />);
export const PanelRightOpen = mk(<path d="M4 5h16v14H4zM15 5v14M10 10l-2 2 2 2" />);
export const Database = mk(<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />);
export const Circle = mk(<circle cx="12" cy="12" r="8.5" />);
export const Crosshair = mk(<><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>);
export const Play = mk(<path d="M7 4.5l12 7.5-12 7.5z" />);
export const Pause = mk(<path d="M8 5v14M16 5v14" />);
export const Square = mk(<rect x="6" y="6" width="12" height="12" rx="1.5" />);
export const Plus = mk(<path d="M12 5v14M5 12h14" />);
export const Minus = mk(<path d="M5 12h14" />);
export const X = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const Trash2 = mk(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />);
export const Info = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>);
export const Ruler = mk(<path d="M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2" />);
export const Scissors = mk(<><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8 8l12 10M8 16L20 6" /></>);
export const ExternalLink = mk(<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />);
export const Cpu = mk(<><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="10" y="10" width="4" height="4" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>);
export const Target = mk(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>);
export const Layers = mk(<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />);
export const Sparkles = mk(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />);
export const SkipForward = mk(<path d="M5 5l9 7-9 7zM18 5v14" />);
export const Wand = mk(<path d="M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z" />);
export const FileText = mk(<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6M9 8h2" />);
export const Dots = mk(<><circle cx="6" cy="7" r="1.6" /><circle cx="13" cy="5" r="1.6" /><circle cx="18" cy="10" r="1.6" /><circle cx="9" cy="13" r="1.6" /><circle cx="16" cy="17" r="1.6" /><circle cx="6" cy="18" r="1.6" /></>);
