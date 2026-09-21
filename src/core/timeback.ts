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
