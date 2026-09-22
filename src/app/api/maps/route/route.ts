import { NextResponse, type NextRequest } from "next/server";

/**
 * Tính thời gian di chuyển bằng Google Maps Routes API (PRD §5.4.1).
 * - TRANSIT: nhập được GIỜ ĐẾN (đúng lựa chọn mặc định BTS của Mai),
 *   trả về tách đoạn đi bộ → tàu → đi bộ để đổ thẳng vào chuỗi tính ngược.
 * - DRIVE: chỉ nhập được giờ đi → dùng dự báo giao thông từ giờ ước tính.
 * Kết quả chỉ điền vào form; Mai vẫn xem và bấm Khóa (duyệt trước).
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

interface Step {
  travelMode?: string;
  staticDuration?: string;
}

function secs(s: string | undefined): number {
  return s ? parseInt(s, 10) || 0 : 0;
}
/** Giây → phút; đoạn 0 giây giữ 0 (ví dụ không phải đi bộ ra ga). */
const toMin = (s: number) => Math.round(s / 60);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "no-maps-key" }, { status: 501 });

  let origin = "";
  let destination = "";
  let mode: "transit" | "drive" = "transit";
  let arriveByMs = 0;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.origin === "string") origin = body.origin.slice(0, 300);
    if (typeof body.destination === "string") destination = body.destination.slice(0, 300);
    if (body.mode === "drive") mode = "drive";
    if (typeof body.arriveByMs === "number" && Number.isFinite(body.arriveByMs))
      arriveByMs = body.arriveByMs;
  } catch {
    /* 400 bên dưới */
  }
  if (!origin || !destination) {
    return NextResponse.json({ error: "Thiếu origin/destination" }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: mode === "transit" ? "TRANSIT" : "DRIVE",
    computeAlternativeRoutes: false,
  };
  if (mode === "transit") {
    if (arriveByMs > Date.now()) payload.arrivalTime = new Date(arriveByMs).toISOString();
  } else {
    // Ô tô chỉ nhận giờ ĐI: ước lượng rời trước giờ đến ~45 phút,
    // không được ở quá khứ (giới hạn PRD §5.4.1 đã ghi).
    const dep = Math.max(Date.now() + 60_000, arriveByMs - 45 * 60_000);
    payload.departureTime = new Date(dep).toISOString();
    payload.routingPreference = "TRAFFIC_AWARE_OPTIMAL";
  }

  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration",
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as {
      routes?: { duration?: string; legs?: { steps?: Step[] }[] }[];
      error?: { message?: string; status?: string };
    } | null;
    if (!res.ok || !data?.routes?.length) {
      const detail =
        data?.error?.message?.slice(0, 200) ??
        (data?.routes ? "Không tìm được tuyến" : `Maps HTTP ${res.status}`);
      return NextResponse.json({ error: "maps-failed", detail }, { status: 502 });
    }

    const route = data.routes[0];
    const totalMin = Math.max(1, toMin(secs(route.duration)));
    if (mode === "drive") {
      return NextResponse.json({ mode, totalMin, driveMin: totalMin });
    }

    // Tách: đi bộ đầu → (tàu + đổi tuyến + chờ) → đi bộ cuối.
    const steps = route.legs?.flatMap((l) => l.steps ?? []) ?? [];
    let walkToSec = 0;
    let walkFromSec = 0;
    const firstTransit = steps.findIndex((s) => s.travelMode === "TRANSIT");
    if (firstTransit > 0) {
      for (const s of steps.slice(0, firstTransit)) walkToSec += secs(s.staticDuration);
    }
    const lastTransit = steps.map((s) => s.travelMode).lastIndexOf("TRANSIT");
    if (lastTransit >= 0 && lastTransit < steps.length - 1) {
      for (const s of steps.slice(lastTransit + 1)) walkFromSec += secs(s.staticDuration);
    }
    const walkToMin = firstTransit === -1 ? totalMin : toMin(walkToSec);
    const walkFromMin = firstTransit === -1 || lastTransit === steps.length - 1 ? 0 : toMin(walkFromSec);
    const transitMin = Math.max(0, totalMin - walkToMin - walkFromMin);
    return NextResponse.json({ mode, totalMin, walkToMin, transitMin, walkFromMin });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server";
    return NextResponse.json({ error: "maps-failed", detail }, { status: 502 });
  }
}
