import type { CSSProperties } from 'react'
const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  compare: 'M8 3H4v18h4 M16 3h4v18h-4 M12 2v20 M2 8h7 M15 16h7',
  book: 'M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2z M12 6v15',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  plus: 'M12 5v14 M5 12h14', check: 'm5 12 4 4L19 6', close: 'm6 6 12 12 M6 18 18 6',
  arrow: 'M4 12h16 m-6-6 6 6-6 6', left: 'M20 12H4 m6-6-6 6 6 6', chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  search: 'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M3 15v6h18v-6', download: 'M12 3v13 m-5-5 5 5 5-5 M3 17v4h18v-4',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z m-5 10 3 3 7-7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  alert: 'm12 3 10 18H2z M12 9v5 M12 17v.1',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  edit: 'm16 3 5 5-12 12-6 1 1-6z M14 5l5 5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4 M12 16v.1',
  menu: 'M4 6h16 M4 12h16 M4 18h16', filter: 'M3 5h18 M6 12h12 M9 19h6',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3 M4 10h16v12H4z M12 14v4',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  refresh: 'M20 7V2l-4 4 M4 17v5l4-4 M20 7A9 9 0 0 0 4 6 M4 17a9 9 0 0 0 16 1',
  folder: 'M3 5h6l2 3h10v13H3z', copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  save: 'M3 3h15l3 3v15H3z M7 3v6h10V3 M7 21v-8h10v8', dot: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
}
export type IconName = keyof typeof paths
export default function Icon({ name, size = 20, style, className = '' }: { name: IconName; size?: number; style?: CSSProperties; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name]} /></svg>
}
