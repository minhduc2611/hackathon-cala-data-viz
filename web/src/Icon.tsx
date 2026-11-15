import type { BoardType } from "../../shared/types.ts";

// 16px line icons, drawn in the current text colour. Decorative: the label next to them carries the meaning.
const PATHS: Record<BoardType, React.ReactNode> = {
  query: (
    <>
      <ellipse cx="8" cy="3.5" rx="5" ry="2" />
      <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  join: (
    <>
      <circle cx="6" cy="8" r="4" />
      <circle cx="10" cy="8" r="4" />
    </>
  ),
  filter: <path d="M2 3h12L9.5 8.5V13l-3 1.5v-6z" />,
  aggregate: <path d="M12 3H4l4.5 5L4 13h8" />,
  split: <path d="M8 14V8.5M8 8.5 3.5 4M8 8.5 12.5 4M3.5 4v2.5M3.5 4H6M12.5 4v2.5M12.5 4H10" />,
  sort: <path d="M4.5 2.5v11M4.5 13.5 2.5 11.5M4.5 13.5l2-2M9 4h5M9 8h3.5M9 12h2" />,
  chart: <path d="M2 13.5h12M4 13V8.5M8 13V3.5M12 13V6.5" />,
  graph: (
    <>
      <path d="M4.2 5.2 10.8 4.8M4.6 5.6l2.6 5.2M11.3 6.2 8.4 10.8" />
      <circle cx="3.5" cy="4.5" r="1.8" />
      <circle cx="12" cy="4.5" r="1.8" />
      <circle cx="7.8" cy="12" r="1.8" />
    </>
  ),
  note: (
    <>
      <path d="M3 2.5h7l3 3v8.5H3z" />
      <path d="M10 2.5v3h3M5.5 8.5h5M5.5 11h3.5" />
    </>
  ),
  check: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />
    </>
  ),
};

export function Icon({ name }: { name: BoardType }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
