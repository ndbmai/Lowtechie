/**
 * Linh vật bông mai năm cánh mặt cười (PRD §6.1) — SVG lấy từ
 * docs/prototypes. Cánh vàng mai, nhụy kem, má hồng.
 */
export function Blossom({ size = 36, title }: { size?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="var(--mai)">
        <ellipse cx="50" cy="24" rx="17" ry="22" />
        <ellipse cx="50" cy="24" rx="17" ry="22" transform="rotate(72 50 52)" />
        <ellipse cx="50" cy="24" rx="17" ry="22" transform="rotate(144 50 52)" />
        <ellipse cx="50" cy="24" rx="17" ry="22" transform="rotate(216 50 52)" />
        <ellipse cx="50" cy="24" rx="17" ry="22" transform="rotate(288 50 52)" />
      </g>
      <circle cx="50" cy="52" r="19" fill="#FFF3C4" />
      <circle cx="43" cy="50" r="3" fill="#1E2150" />
      <circle cx="57" cy="50" r="3" fill="#1E2150" />
      <path
        d="M44 57 Q50 62 56 57"
        stroke="#1E2150"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="38" cy="57" r="3" fill="#FF8FA3" opacity=".7" />
      <circle cx="62" cy="57" r="3" fill="#FF8FA3" opacity=".7" />
    </svg>
  );
}
