"use client";

import { useEffect } from "react";
import {
  LOCATION_TTL_MS,
  PLACE_RADIUS_M,
  cityFromCoords,
  distanceM,
  nearestPlace,
} from "@/core/location";
import { foldName } from "@/core/clients";
import type { Destination, Place } from "@/core/types";
import { useStore } from "@/lib/store";

/**
 * Vị trí THIẾT BỊ (§5.4.3 v3.7) — Google Timeline không còn lấy được nên
 * app dùng GPS của máy Mai. Ranh giới: tọa độ của Mai KHÔNG BAO GIỜ được
 * lưu; chỉ lưu thành phố + nơi đã lưu (đã tới nhà, đã tới sân bay), hết
 * hạn 30 ngày thì xóa.
 */

export type PositionResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reason: "denied" | "unavailable" | "timeout" | "unsupported" };

export function getDevicePosition(timeoutMs = 10_000): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        resolve({
          ok: false,
          reason: e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable",
        }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 },
    );
  });
}

export const POSITION_ERROR: Record<Exclude<PositionResult, { ok: true }>["reason"], string> = {
  denied: "Trình duyệt đang chặn quyền vị trí — bật lại trong cài đặt của Safari/Chrome cho lowtechie.vercel.app.",
  unavailable: "Máy chưa lấy được vị trí (trong nhà, tắt định vị?) — thử lại sau nhé.",
  timeout: "Lấy vị trí lâu quá — thử lại sau nhé.",
  unsupported: "Trình duyệt này không hỗ trợ vị trí.",
};

/** Ghi "Mai đang ở đâu" từ một tọa độ — chỉ giữ thành phố + nơi đã lưu. */
export function applyPosition(lat: number, lng: number): { city?: Destination; place?: Place } {
  const st = useStore.getState();
  const place = nearestPlace({ lat, lng }, st.places);
  const city = cityFromCoords(lat, lng) ?? place?.city;
  const now = Date.now();
  st.setLocationState({
    city,
    placeId: place?.id,
    source: "gps",
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LOCATION_TTL_MS).toISOString(),
  });
  markArrivals(place);
  return { city, place };
}

/**
 * Xác nhận đã đến (§5.4.3): đang đứng ở nơi đã lưu mà có lịch ở đúng nơi
 * đó (từ 60 phút trước giờ hẹn đến lúc kết thúc) → đánh dấu đã tới.
 */
function markArrivals(place: Place | undefined) {
  if (!place) return;
  const st = useStore.getState();
  const now = Date.now();
  const name = foldName(place.name);
  for (const e of st.events) {
    if (e.kind !== "event" || e.arrivedAt) continue;
    const s = Date.parse(e.startAt);
    const en = Date.parse(e.endAt);
    if (now < s - 60 * 60_000 || now > en) continue;
    const here =
      e.placeId === place.id || (e.location ? foldName(e.location).includes(name) : false);
    if (here) st.updateEvent(e.id, { arrivedAt: new Date(now).toISOString() });
  }
}

/** Lấy vị trí ngay (Mai bấm, hoặc lúc mở Lịch ở mức "Chỉ khi cần"). */
export async function refreshLocation(): Promise<
  { ok: true; city?: Destination; place?: Place } | { ok: false; message: string }
> {
  const r = await getDevicePosition();
  if (!r.ok) return { ok: false, message: POSITION_ERROR[r.reason] };
  return { ok: true, ...applyPosition(r.lat, r.lng) };
}

/**
 * Gắn vào màn Lịch (và Hôm nay ở mức "khi app mở"):
 * - "ondemand": hỏi vị trí MỘT lần khi mở màn (GPS cũ hơn 10 phút mới hỏi lại).
 * - "light": như trên + theo dõi khi app ĐANG MỞ, chỉ ghi khi đổi nơi/thành
 *   phố (PWA không chạy nền được — rào cản ghi trong CLAUDE.md).
 * - "off": không đụng tới vị trí.
 */
export function useDeviceLocation(active: boolean) {
  const mode = useStore((s) => s.settings.locationMode);
  useEffect(() => {
    if (!active || mode === "off") return;
    const st = useStore.getState();
    const last = st.locationState;
    const stale =
      !last || last.source !== "gps" || Date.now() - Date.parse(last.updatedAt) > 10 * 60_000;
    if (stale) void refreshLocation();
    if (mode !== "light" || typeof navigator === "undefined" || !navigator.geolocation) return;
    let lastPos: { lat: number; lng: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        // Chỉ ghi khi dịch chuyển đáng kể — không theo dõi từng bước.
        if (lastPos && distanceM(lastPos, pos) < PLACE_RADIUS_M / 2) return;
        lastPos = pos;
        applyPosition(pos.lat, pos.lng);
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 2 * 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, mode]);
}
