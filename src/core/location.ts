import type { Destination, LocationState, Place, Trip } from "./types";

/**
 * Biết Mai đang ở đâu (§5.4.3 v3.7) — từ VỊ TRÍ THIẾT BỊ (Google Timeline
 * không còn lấy được), chuyến bay đã lưu, hoặc Mai tự nói. Ranh giới: chỉ
 * giữ thành phố + nơi đã lưu, không giữ tọa độ/đường đi của Mai.
 */

export const CITY_CENTERS: Record<Destination, { lat: number; lng: number; radiusKm: number }> = {
  bkk: { lat: 13.7563, lng: 100.5018, radiusKm: 60 },
  hcmc: { lat: 10.7769, lng: 106.7009, radiusKm: 60 },
  tokyo: { lat: 35.6762, lng: 139.6503, radiusKm: 70 },
};

export const CITY_LABEL: Record<Destination, string> = {
  bkk: "Bangkok",
  hcmc: "HCMC",
  tokyo: "Tokyo",
};

/** Dữ liệu vị trí giữ tối đa 30 ngày rồi xóa (ranh giới §5.4.3). */
export const LOCATION_TTL_MS = 30 * 86_400_000;
/** Vị trí GPS chỉ đáng tin vài giờ — sau đó quay về suy từ lịch/chuyến bay. */
export const GPS_FRESH_MS = 6 * 3_600_000;
/** Bán kính coi như "đang ở" một nơi đã lưu. */
export const PLACE_RADIUS_M = 250;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cityFromCoords(lat: number, lng: number): Destination | undefined {
  let best: { city: Destination; d: number } | undefined;
  for (const [city, c] of Object.entries(CITY_CENTERS) as [Destination, (typeof CITY_CENTERS)[Destination]][]) {
    const d = distanceM({ lat, lng }, c);
    if (d <= c.radiusKm * 1000 && (!best || d < best.d)) best = { city, d };
  }
  return best?.city;
}

/** Nơi đã lưu gần nhất trong bán kính (chỉ nơi Mai đã đặt tọa độ). */
export function nearestPlace(
  pos: { lat: number; lng: number },
  places: Place[],
  radiusM = PLACE_RADIUS_M,
): Place | undefined {
  let best: { p: Place; d: number } | undefined;
  for (const p of places) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const d = distanceM(pos, { lat: p.lat, lng: p.lng });
    if (d <= radiusM && (!best || d < best.d)) best = { p, d };
  }
  return best?.p;
}

/**
 * Thành phố suy từ chuyến bay đã lưu (mức "Không dùng vị trí"): chuyến
 * gần nhất đã cất cánh mà chưa bay về → đang ở điểm đến; còn lại ở nhà.
 */
export function cityFromTrips(trips: Trip[], now: Date, homeCity: Destination = "bkk"): Destination {
  const t = now.getTime();
  const last = trips
    .filter((tr) => Date.parse(tr.departAt) <= t)
    .sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt))[0];
  if (!last) return homeCity;
  return !last.returnAt || Date.parse(last.returnAt) > t ? last.destination : homeCity;
}

export interface CurrentCity {
  city: Destination;
  placeId?: string;
  source: "gps" | "manual" | "calendar";
}

/**
 * Mai đang ở đâu lúc này: GPS còn tươi hoặc Mai tự nói (chưa hết hạn) thắng;
 * nhưng nếu SAU đó có chuyến bay cất cánh thì tin chuyến bay (Mai đã bay).
 */
export function currentCity(
  state: LocationState | undefined,
  trips: Trip[],
  now: Date,
  homeCity: Destination = "bkk",
): CurrentCity {
  const t = now.getTime();
  if (state?.city && Date.parse(state.expiresAt) > t) {
    const updated = Date.parse(state.updatedAt);
    const flewSince = trips.some((tr) => {
      const dep = Date.parse(tr.departAt);
      return dep > updated && dep <= t;
    });
    const fresh = state.source === "gps" ? t - updated < GPS_FRESH_MS : true;
    if (fresh && !flewSince) return { city: state.city, placeId: state.placeId, source: state.source === "gps" ? "gps" : "manual" };
  }
  return { city: cityFromTrips(trips, now, homeCity), source: "calendar" };
}

/** Vị trí hết hạn (quá 30 ngày) thì xóa hẳn — không giữ lâu hơn cần. */
export function pruneLocation(state: LocationState | undefined, now: Date): LocationState | undefined {
  return state && Date.parse(state.expiresAt) > now.getTime() ? state : undefined;
}

/** Phương tiện mặc định theo thành phố: Bangkok/Tokyo → tàu điện, HCMC → Grab (§5.4.3). */
export function defaultModeForCity(city: Destination): "transit" | "car" {
  return city === "hcmc" ? "car" : "transit";
}

/** Nơi xuất phát mặc định: nơi đang ở (nếu biết) → nhà ở thành phố hiện tại. */
export function originPlace(places: Place[], here: CurrentCity): Place | undefined {
  const at = here.placeId ? places.find((p) => p.id === here.placeId) : undefined;
  if (at) return at;
  return places.find((p) => p.isHome && p.city === here.city);
}

/** "chị đang ở HCMC" → hcmc (tên gọi Mai hay dùng, bỏ dấu). */
export function cityFromText(text: string): Destination | undefined {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
  if (/\b(hcmc|hcm|tphcm|tp hcm|sai gon|saigon|ho chi minh|sg)\b/.test(t)) return "hcmc";
  if (/\b(bangkok|bkk|bang coc|thai lan|thailand)\b/.test(t)) return "bkk";
  if (/\b(tokyo|nhat|japan)\b/.test(t)) return "tokyo";
  return undefined;
}
