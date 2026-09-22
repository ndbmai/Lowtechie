/**
 * Chuỗi tính ngược "chuẩn bị + di chuyển" (PRD §5.4.1).
 *
 * Từ giờ hẹn (hoặc giờ bay) trừ lùi các đoạn: đệm đến sớm → di chuyển
 * → đệm rời nhà → chuẩn bị, ra "giờ bắt đầu chuẩn bị" và "giờ phải đi".
 * Ở Bangkok mặc định đi tàu (BTS từ Bang Na); ô tô chỉ khi Mai nói rõ.
 *
 * Thời lượng di chuyển ở v1 nhập tay / lấy từ giá trị đã lưu; Google Maps
 * Routes API sẽ thay vào đúng các tham số này (nhớ: chọn "giờ đến" chỉ
 * có với phương tiện công cộng).
 */

export const DEFAULT_BUFFERS = {
  /** Đệm đến sớm tại điểm hẹn. */
  arriveEarly: 10,
  /** Đệm rời nhà: thang máy, gọi xe. */
  leaveHome: 10,
  /** Đệm chờ tàu / qua cổng soát vé. */
  gate: 5,
  /** Cộng thêm cho mỗi đoạn đi bộ khi trời mưa. */
  rainWalk: 10,
  /** Có mặt trước giờ bay: quốc tế / nội địa (phút). */
  airportIntl: 150,
  airportDomestic: 90,
};

export type Buffers = typeof DEFAULT_BUFFERS;

export interface ChainBlock {
  kind: "prep" | "travel" | "airport" | "flight";
  label: string;
  startAt: string;
  endAt: string;
}

export interface Chain {
  /** Giờ bắt đầu chuẩn bị — mốc Lowtechie sẽ nhắc. */
  prepStartAt: string;
  /** Giờ phải rời nhà (bắt đầu block di chuyển). */
  leaveAt: string;
  blocks: ChainBlock[];
  totalMinutes: number;
  reminders: string[];
}

function minus(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60_000);
}

function buildChain(
  anchorAt: Date,
  prepMinutes: number,
  travelMinutes: number,
  travelLabel: string,
  reminders: string[],
  extraBlocks: ChainBlock[] = [],
): Chain {
  const travelEnd = anchorAt;
  const travelStart = minus(travelEnd, travelMinutes);
  const prepEnd = travelStart;
  const prepStart = minus(prepEnd, prepMinutes);

  const blocks: ChainBlock[] = [
    {
      kind: "prep",
      label: "Chuẩn bị",
      startAt: prepStart.toISOString(),
      endAt: prepEnd.toISOString(),
    },
    {
      kind: "travel",
      label: travelLabel,
      startAt: travelStart.toISOString(),
      endAt: travelEnd.toISOString(),
    },
    ...extraBlocks,
  ];

  return {
    prepStartAt: prepStart.toISOString(),
    leaveAt: travelStart.toISOString(),
    blocks,
    totalMinutes: prepMinutes + travelMinutes,
    reminders,
  };
}

// ── Đi tàu (mặc định ở Bangkok) ─────────────────────────────────────────

export interface TransitOpts {
  /** Giờ hẹn (ISO). */
  appointmentAt: string;
  /** Theo hồ sơ chuẩn bị Mai chọn (PRD: 90/30/20/0 phút). */
  prepMinutes: number;
  /** Đi bộ nhà → ga (BTS Bang Na): giá trị đã lưu, không gọi API mỗi lần. */
  walkToStationMin: number;
  /** Tàu + đổi tuyến (Google Maps chế độ công cộng, sau này). */
  transitMin: number;
  /** Đi bộ ga → điểm hẹn. */
  walkFromStationMin: number;
  rain?: boolean;
  buffers?: Partial<Buffers>;
}

export function transitChain(o: TransitOpts): Chain {
  const b = { ...DEFAULT_BUFFERS, ...o.buffers };
  const rainExtra = o.rain ? 2 * b.rainWalk : 0;
  const travel =
    b.leaveHome +
    o.walkToStationMin +
    b.gate +
    o.transitMin +
    o.walkFromStationMin +
    b.arriveEarly +
    rainExtra;
  const reminders = o.rain ? ["Trời mưa: đã cộng đệm đi bộ, nhớ mang ô"] : [];
  return buildChain(new Date(o.appointmentAt), o.prepMinutes, travel, "Di chuyển (BTS)", reminders);
}

// ── Ô tô (chỉ khi Mai nói rõ) ───────────────────────────────────────────

export interface CarOpts {
  appointmentAt: string;
  prepMinutes: number;
  /** Google Maps chỉ nhận giờ đi với ô tô → dùng dự báo "ngày xấu". */
  driveMin: number;
  buffers?: Partial<Buffers>;
}

export function carChain(o: CarOpts): Chain {
  const b = { ...DEFAULT_BUFFERS, ...o.buffers };
  const travel = b.leaveHome + o.driveMin + b.arriveEarly;
  return buildChain(new Date(o.appointmentAt), o.prepMinutes, travel, "Di chuyển (ô tô)", []);
}

// ── Ngày bay (PRD §5.9: chuẩn bị → di chuyển → đệm sân bay → bay) ──────

export interface FlightOpts {
  /** Giờ cất cánh (ISO, múi giờ địa phương sân bay đi). */
  departureAt: string;
  international: boolean;
  prepMinutes: number;
  /** Di chuyển ra sân bay (đã gồm mọi chặng). */
  travelMin: number;
  /** Thời lượng bay, để vẽ block Chuyến bay (tùy chọn). */
  flightMinutes?: number;
  buffers?: Partial<Buffers>;
}

// ── Chuỗi ngày bay ĐẦY ĐỦ HAI ĐẦU (PRD §5.9 v2.0) ──────────────────────
//
// 6 block theo thứ tự thời gian: Chuẩn bị → Ra sân bay → Check-in/an ninh
// → Bay → Nhập cảnh/hành lý → Di chuyển sau khi đáp → "giờ về đến nơi".
// Mọi block chỉnh được ở UI; các mốc cứng (giờ bay trên vé) không đổi.

export interface FullFlightBlock {
  key: "prep" | "toAirport" | "checkin" | "flight" | "arrival" | "fromAirport";
  label: string;
  startAt: string;
  endAt: string;
}

/** Offset ±hh:mm trong chuỗi ISO → phút; null khi thiếu hoặc là Z. */
export function parseOffsetMin(iso: string): number | null {
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

export interface FullFlightOpts {
  /** Giờ cất cánh (ISO kèm offset sân bay đi) — mốc cứng. */
  departureAt: string;
  /**
   * Offset múi giờ (phút) của THÀNH PHỐ ĐI, cho cảnh báo "nửa đêm" (v2.3:
   * kiểm tra bằng giờ địa phương, không phải UTC máy chủ). Không truyền
   * thì đọc từ offset trong departureAt; dữ liệu cũ lưu dạng Z phải truyền.
   */
  originTzOffsetMin?: number;
  /** Giờ hạ cánh (ISO kèm offset sân bay đến) — thiếu thì chuỗi dừng ở cất cánh. */
  arrivalAt?: string;
  international: boolean;
  /** 0 = tắt block Chuẩn bị (đi thẳng từ nơi khác). */
  prepMinutes: number;
  travelToAirportMin: number;
  /** Quy định trên vé ("có mặt trước X phút") — luôn lấy MAX với mặc định. */
  ticketCheckinMin?: number;
  /** Mai tự chỉnh block check-in → dùng ĐÚNG số này, bỏ qua max/mặc định. */
  checkinOverrideMin?: number;
  /** Nhập cảnh + lấy hành lý + ra sảnh; mặc định 60 quốc tế / 30 nội địa. */
  arrivalProcessMin?: number;
  /** 0/không có = tắt block Di chuyển sau khi đáp. */
  travelAfterMin?: number;
}

export interface FullFlightChainResult {
  blocks: FullFlightBlock[];
  prepStartAt: string;
  leaveAt: string;
  airportArriveAt: string;
  /** Giờ về đến nơi (sau block cuối bên đầu đến) — chỉ khi biết giờ hạ cánh. */
  arriveAt?: string;
  /** Đệm check-in đã dùng = max(quy định vé, mặc định). */
  checkinMin: number;
  /** Cảnh báo nhẹ: nửa đêm, di chuyển bất thường — Mai vẫn quyết. */
  warnings: string[];
}

/** Giờ địa phương (0–23) của một mốc theo offset phút cho trước. */
function localHourAt(ms: number, offsetMin: number): number {
  return new Date(ms + offsetMin * 60_000).getUTCHours();
}

export function fullFlightChain(o: FullFlightOpts): FullFlightChainResult {
  const warnings: string[] = [];
  const departMs = Date.parse(o.departureAt);
  const checkinMin =
    o.checkinOverrideMin ?? Math.max(o.ticketCheckinMin ?? 0, o.international ? 150 : 90);
  const airportArrive = departMs - checkinMin * 60_000;
  const leave = airportArrive - o.travelToAirportMin * 60_000;
  const prepStart = leave - o.prepMinutes * 60_000;

  const blocks: FullFlightBlock[] = [];
  if (o.prepMinutes > 0) {
    blocks.push({
      key: "prep",
      label: "Chuẩn bị",
      startAt: new Date(prepStart).toISOString(),
      endAt: new Date(leave).toISOString(),
    });
  }
  blocks.push({
    key: "toAirport",
    label: "Di chuyển ra sân bay",
    startAt: new Date(leave).toISOString(),
    endAt: new Date(airportArrive).toISOString(),
  });
  blocks.push({
    key: "checkin",
    label: "Check-in, gửi hành lý, an ninh",
    startAt: new Date(airportArrive).toISOString(),
    endAt: new Date(departMs).toISOString(),
  });

  let arriveAt: string | undefined;
  const arriveMs = o.arrivalAt ? Date.parse(o.arrivalAt) : NaN;
  if (Number.isFinite(arriveMs) && arriveMs > departMs) {
    blocks.push({
      key: "flight",
      label: "Bay",
      startAt: new Date(departMs).toISOString(),
      endAt: new Date(arriveMs).toISOString(),
    });
    const proc = o.arrivalProcessMin ?? (o.international ? 60 : 30);
    let cursor = arriveMs;
    if (proc > 0) {
      blocks.push({
        key: "arrival",
        label: "Nhập cảnh, lấy hành lý, ra sảnh",
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(cursor + proc * 60_000).toISOString(),
      });
      cursor += proc * 60_000;
    }
    if (o.travelAfterMin && o.travelAfterMin > 0) {
      blocks.push({
        key: "fromAirport",
        label: "Di chuyển sau khi đáp",
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(cursor + o.travelAfterMin * 60_000).toISOString(),
      });
      cursor += o.travelAfterMin * 60_000;
    }
    arriveAt = new Date(cursor).toISOString();
  }

  // Cảnh báo bắt buộc của v2.0 (lỗi thật 22/9: ô di chuyển 1020 phút).
  if (o.travelToAirportMin > 180) warnings.push("di chuyển ra sân bay hơn 3 tiếng — kiểm tra lại số phút");
  if ((o.travelAfterMin ?? 0) > 180) warnings.push("di chuyển sau khi đáp hơn 3 tiếng — kiểm tra lại số phút");
  // v2.3: giờ kiểm tra là GIỜ ĐỊA PHƯƠNG thành phố đi (7:13 HCMC không
  // phải nửa đêm dù bằng 0:13 UTC).
  const originOffset = o.originTzOffsetMin ?? parseOffsetMin(o.departureAt) ?? 0;
  const prepHour = localHourAt(prepStart, originOffset);
  if (o.prepMinutes > 0 && prepHour >= 0 && prepHour < 5) {
    warnings.push("giờ bắt đầu chuẩn bị rơi vào nửa đêm (0:00–5:00) — đổi phương tiện hay rút ngắn chuẩn bị?");
  }

  return {
    blocks,
    prepStartAt: new Date(prepStart).toISOString(),
    leaveAt: new Date(leave).toISOString(),
    airportArriveAt: new Date(airportArrive).toISOString(),
    arriveAt,
    checkinMin,
    warnings,
  };
}

/**
 * Kiểm tra BẮT BUỘC trước khi hiện chuỗi (v2.0): các block phải liên tục
 * và tăng dần; sai thì trả thông báo lỗi — UI không được vẽ chuỗi sai.
 */
export function validateChainBlocks(
  blocks: { label: string; startAt: string; endAt: string }[],
): string | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (Date.parse(b.endAt) < Date.parse(b.startAt)) {
      return `Block "${b.label}" kết thúc trước khi bắt đầu — dữ liệu giờ đang sai.`;
    }
    if (i > 0 && Date.parse(blocks[i - 1].endAt) > Date.parse(b.startAt)) {
      return `Block "${blocks[i - 1].label}" đè lên "${b.label}" — chuỗi không liên tục.`;
    }
  }
  return null;
}

export function flightChain(o: FlightOpts): Chain {
  const b = { ...DEFAULT_BUFFERS, ...o.buffers };
  const airportBuffer = o.international ? b.airportIntl : b.airportDomestic;
  const departure = new Date(o.departureAt);
  const airportArrival = minus(departure, airportBuffer);

  const extra: ChainBlock[] = [
    {
      kind: "airport",
      label: "Đệm sân bay",
      startAt: airportArrival.toISOString(),
      endAt: departure.toISOString(),
    },
  ];
  if (o.flightMinutes) {
    extra.push({
      kind: "flight",
      label: "Chuyến bay",
      startAt: departure.toISOString(),
      endAt: new Date(departure.getTime() + o.flightMinutes * 60_000).toISOString(),
    });
  }

  const travel = b.leaveHome + o.travelMin;
  const chain = buildChain(airportArrival, o.prepMinutes, travel, "Ra sân bay", [], extra);
  return {
    ...chain,
    totalMinutes: chain.totalMinutes + airportBuffer,
    reminders: [
      `Có mặt trước giờ bay ${airportBuffer >= 60 ? `${Math.floor(airportBuffer / 60)} tiếng ${airportBuffer % 60 || ""}`.trim() : `${airportBuffer} phút`} (${o.international ? "quốc tế" : "nội địa"})`,
    ],
  };
}
