"use client";

import type { Destination, Place } from "@/core/types";

const CITY_LABELS: Record<Destination, string> = {
  bkk: "Bangkok",
  hcmc: "HCMC",
  tokyo: "Tokyo",
};

/**
 * Chọn nhanh một địa điểm đã lưu (Nhà ở HCM, Nhà Bang Na…) để đổ vào ô
 * điểm đi/điểm đến — ưu tiên đúng thành phố của chặng, vẫn chọn được nơi
 * ở thành phố khác.
 */
export function PlaceSelect({
  places,
  city,
  onPick,
  label,
}: {
  places: Place[];
  /** Thành phố của đầu chặng — địa điểm cùng thành phố xếp lên đầu. */
  city?: Destination;
  onPick: (address: string) => void;
  label: string;
}) {
  const usable = places.filter((p) => (p.address ?? "").trim() || p.name.trim());
  if (usable.length === 0) return null;
  const sorted = [
    ...usable.filter((p) => city && p.city === city),
    ...usable.filter((p) => !city || p.city !== city),
  ];

  return (
    <select
      className="btn small"
      value=""
      aria-label={label}
      onChange={(e) => {
        const p = usable.find((x) => x.id === e.target.value);
        if (p) onPick((p.address ?? "").trim() || p.name);
      }}
    >
      <option value="">📍 Địa điểm đã lưu…</option>
      {sorted.map((p) => (
        <option key={p.id} value={p.id}>
          {p.isHome ? "🏠 " : ""}
          {p.name}
          {p.city ? ` (${CITY_LABELS[p.city]})` : ""}
        </option>
      ))}
    </select>
  );
}
