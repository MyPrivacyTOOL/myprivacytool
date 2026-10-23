// A hexagon with a pair of footprints leaving its lower-right corner (Chris's sketch, 2026-10-23). Drawn here, decorative only.

function Foot({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} fill="currentColor">
      <ellipse cx="0" cy="2.2" rx="2.1" ry="3.1" />
      <circle cx="-2" cy="-2" r="0.8" />
      <circle cx="-0.7" cy="-3" r="0.8" />
      <circle cx="0.8" cy="-3" r="0.8" />
      <circle cx="2.1" cy="-2" r="0.8" />
    </g>
  );
}

export default function FootprintsIcon({ className = "", feetOnly = false }: { className?: string; feetOnly?: boolean }) {
  return (
    <svg viewBox={feetOnly ? "13 16 20 16" : "0 0 32 32"} className={className} aria-hidden="true" focusable="false">
      {!feetOnly && <polygon points="9,4 23,4 30,14 23,24 9,24 2,14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />}
      <Foot x={19} y={25} rotate={-8} />
      <Foot x={26} y={23} rotate={8} />
    </svg>
  );
}
