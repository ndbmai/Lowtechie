import type { Destination } from "./types";

/**
 * Phân loại + gộp chặng bay (PRD §5.9 6b — quy tắc rút từ lỗi vé OADC5J).
 *
 * AI chỉ TRÍCH THÔ tất cả các chặng trong email + PDF đính kèm; việc so
 * với "bây giờ" và gán sắp tới / đã bay là của CODE ở đây — thuần, có
 * unit test (trong đó có test hồi quy OADC5J bắt buộc của PRD).
 */

export interface FlightSegment {
  pnr?: string;
  flightNo: string;
  airline?: string;
  fromIata?: string;
  toIata?: string;
  fromTerminal?: string;
  toTerminal?: string;
  /** ISO 8601 kèm offset múi giờ SÂN BAY ĐI. */
  departLocal: string;
  arriveLocal?: string;
  seat?: string;
  baggage?: string;
  /** "Có mặt trước X phút" nếu vé ghi quy định riêng. */
  checkinMinutes?: number;
  /** Vé ghi trạng thái hủy. */
  cancelled?: boolean;
  /** Lịch trình cũ đã bị email đổi vé thay thế. */
  superseded?: boolean;
  subject?: string;
  confidence: number;
}

export interface TripCandidate {
  destination: Destination | "other";
  destinationName?: string;
  departAt: string;
  /** Giờ hạ cánh chặng đi — cho chuỗi ngày bay hai đầu (v2.0). */
  arriveAt?: string;
  returnAt?: string;
  pnr?: string;
  /** "SGN → BKK" — nhãn hướng bay rõ ràng (6b). */
  route?: string;
  /** Đệm sân bay theo quy định ghi trên vé, nếu có. */
  airportBufferMin?: number;
  flights: string;
  subject: string;
  confidence: number;
}

/** Sân bay đến → điểm đến có checklist. */
const IATA_DEST: Record<string, Destination> = {
  NRT: "tokyo",
  HND: "tokyo",
  SGN: "hcmc",
  BKK: "bkk",
  DMK: "bkk",
};

/** Thành phố của một sân bay — để chọn đúng nhà đã lưu cho đầu chặng. */
export function iataCity(iata?: string): Destination | undefined {
  return iata ? IATA_DEST[iata.toUpperCase()] : undefined;
}

/**
 * Offset múi giờ (phút) theo sân bay — cho cảnh báo giờ địa phương của
 * chuỗi ngày bay khi dữ liệu cũ lưu ISO dạng Z (mất offset).
 */
export const IATA_TZ_MIN: Record<string, number> = {
  SGN: 420,
  HAN: 420,
  DAD: 420,
  BKK: 420,
  DMK: 420,
  CNX: 420,
  NRT: 540,
  HND: 540,
  KIX: 540,
};

function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${parseInt(m[1], 10)}:${m[2]}` : "";
}

function dmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}` : "";
}

function segmentLabel(s: FlightSegment): string {
  const route = s.fromIata && s.toIata ? ` ${s.fromIata} → ${s.toIata}` : "";
  const arrive = s.arriveLocal ? `–${hhmm(s.arriveLocal)}` : "";
  return `${s.flightNo}${route} ${dmy(s.departLocal)} ${hhmm(s.departLocal)}${arrive}`.trim();
}

export interface ClassifiedFlights {
  candidates: TripCandidate[];
  /** Chặng không tạo gì: đã bay / đã hủy / lịch cũ — hiện ở mục Lịch sử. */
  history: string[];
}

/**
 * Khử trùng theo PNR + số hiệu + ngày bay (KHÔNG bao giờ chỉ PNR — 6b),
 * phân loại theo thời gian bằng code, rồi gộp các chặng SẮP TỚI cùng
 * PNR thành ứng viên chuyến (chặng đầu = đi, chặng sau = về).
 */
export function classifyAndGroup(segments: FlightSegment[], nowMs: number): ClassifiedFlights {
  // 1. Khử trùng: giữ bản tin cậy cao nhất cho mỗi (pnr, số hiệu, ngày).
  const byKey = new Map<string, FlightSegment>();
  for (const s of segments) {
    if (!s.flightNo || !s.departLocal || Number.isNaN(Date.parse(s.departLocal))) continue;
    const key = `${s.pnr ?? ""}|${s.flightNo}|${s.departLocal.slice(0, 10)}`;
    const prev = byKey.get(key);
    if (!prev || s.confidence > prev.confidence) byKey.set(key, s);
  }

  const history: string[] = [];
  const upcoming: FlightSegment[] = [];
  for (const s of byKey.values()) {
    if (s.cancelled) {
      history.push(`${segmentLabel(s)} — đã hủy`);
    } else if (s.superseded) {
      history.push(`${segmentLabel(s)} — lịch cũ trước khi đổi vé`);
    } else if (Date.parse(s.departLocal) <= nowMs) {
      history.push(`${segmentLabel(s)} — đã bay`);
    } else {
      upcoming.push(s);
    }
  }
  upcoming.sort((a, b) => Date.parse(a.departLocal) - Date.parse(b.departLocal));

  // 2. Gộp chặng sắp tới theo PNR (không PNR thì mỗi chặng một chuyến).
  const groups = new Map<string, FlightSegment[]>();
  for (const s of upcoming) {
    const key = s.pnr ?? `no-pnr:${s.flightNo}:${s.departLocal}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const candidates: TripCandidate[] = [];
  for (const segs of groups.values()) {
    const first = segs[0];
    const last = segs[segs.length - 1];
    const dest = first.toIata ? IATA_DEST[first.toIata.toUpperCase()] : undefined;
    const extras = [first.seat && `ghế ${first.seat}`, first.baggage && `ký gửi ${first.baggage}`]
      .filter(Boolean)
      .join(", ");
    candidates.push({
      destination: dest ?? "other",
      destinationName: dest ? undefined : (first.toIata ?? undefined),
      departAt: first.departLocal,
      arriveAt: first.arriveLocal,
      returnAt: segs.length > 1 ? last.departLocal : undefined,
      pnr: first.pnr,
      route:
        first.fromIata && first.toIata
          ? `${first.fromIata}${first.fromTerminal ? ` (nhà ga ${first.fromTerminal})` : ""} → ${first.toIata}`
          : undefined,
      airportBufferMin: first.checkinMinutes,
      flights: segs.map((s) => segmentLabel(s) + (s === first && extras ? ` (${extras})` : "")).join(" · "),
      subject: first.subject ?? "",
      confidence: Math.min(...segs.map((s) => s.confidence)),
    });
  }

  return { candidates, history };
}
