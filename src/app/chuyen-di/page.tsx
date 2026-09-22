"use client";

import { useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import {
  DESTINATION_LABELS,
  groupsFor,
  type ChecklistTab,
} from "@/core/checklist";
import { IATA_TZ_MIN } from "@/core/flights";
import { fullFlightChain, parseOffsetMin, validateChainBlocks } from "@/core/timeback";
import type { Destination, Trip, TripAttachment } from "@/core/types";
import { deleteFile, getFile, putFile } from "@/lib/fileStore";
import { fmtDay, fmtDayTime, fmtRange, fmtTime, isSameDay } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import {
  deleteGcalEvent,
  fetchFlightTrips,
  fetchGmailAttachment,
  fetchRoute,
  useGoogleStatus,
  type FlightTripCandidate,
  type GmailAttachmentRef,
} from "@/lib/useGoogle";

/** "SGN (nhà ga 2) → BKK" → "SGN → BKK" cho tab/tiêu đề gọn (v2.0). */
function shortRoute(route?: string): string | undefined {
  return route?.replace(/\s*\(nhà ga [^)]*\)/g, "");
}

function iataPair(route?: string): { from?: string; to?: string } {
  const m = route?.match(/[A-Z]{3}/g);
  return { from: m?.[0], to: m?.[1] };
}

/** Nhãn tab theo tuyến: "SGN → BKK · 2/10" (v2.0 — không dùng tên điểm đến). */
function tabLabel(route: string | undefined, destination: Destination, departAt: string): string {
  const d = new Date(departAt);
  return `${shortRoute(route) ?? DESTINATION_LABELS[destination]} · ${d.getDate()}/${d.getMonth() + 1}`;
}

/** Tên trên dòng cất cánh — không bao giờ "Cất cánh Về Bangkok". */
function flightName(trip: Trip): string {
  return trip.route ?? (trip.destination === "bkk" ? "Bangkok" : DESTINATION_LABELS[trip.destination]);
}

/** Tên file vé chuẩn: Ve_SGN-BKK_2026-10-02_OADC5J.pdf (v2.0). */
function ticketFileName(c: FlightTripCandidate, fallback: string): string {
  const { from, to } = iataPair(c.route);
  if (!from || !to) return fallback;
  return `Ve_${from}-${to}_${c.departAt.slice(0, 10)}${c.pnr ? `_${c.pnr}` : ""}.pdf`;
}

// Danh sách phương tiện v2.3 — không có "Người đón".
const MODE_OPTIONS = [
  { id: "grab", label: "Grab/taxi" },
  { id: "car", label: "Ô tô riêng" },
  { id: "train", label: "Tàu điện" },
  { id: "bus", label: "Xe bus" },
  { id: "bike", label: "Xe máy" },
] as const;
type TravelMode = (typeof MODE_OPTIONS)[number]["id"];

/** Chế độ Routes API theo phương tiện (xe máy = hai bánh, server tự rơi về lái xe). */
function routeMode(mode: TravelMode): "transit" | "drive" | "bike" {
  return mode === "train" || mode === "bus" ? "transit" : mode === "bike" ? "bike" : "drive";
}

function mapsUrl(origin: string, destination: string, mode: TravelMode): string {
  const m = mode === "train" || mode === "bus" ? "transit" : "driving";
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${m}`;
}

/**
 * ISO kèm offset thiết bị cho chuyến tạo tay — KHÔNG toISOString() trần:
 * đổi về Z là mất múi giờ sân bay, cảnh báo "nửa đêm" của chuỗi sẽ sai.
 */
function deviceOffsetIso(d: Date): string {
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const abs = Math.abs(tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

function NewTripForm({ onDone }: { onDone: () => void }) {
  const addTrip = useStore((s) => s.addTrip);
  const [dest, setDest] = useState<Destination>("tokyo");
  const [when, setWhen] = useState("");

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <b>Chuyến mới</b>
      <div className="seg" role="radiogroup" aria-label="Điểm đến">
        {(Object.keys(DESTINATION_LABELS) as Destination[]).map((d) => (
          <button key={d} aria-pressed={dest === d} onClick={() => setDest(d)}>
            {DESTINATION_LABELS[d]}
          </button>
        ))}
      </div>
      <input
        type="datetime-local"
        className="btn"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        aria-label="Giờ bay (giờ địa phương sân bay đi)"
      />
      <button
        className="btn primary"
        disabled={!when}
        onClick={() => {
          const d = new Date(when);
          addTrip({
            destination: dest,
            label: `${DESTINATION_LABELS[dest]} · ${d.getDate()}/${d.getMonth() + 1}`,
            departAt: deviceOffsetIso(d),
          });
          onDone();
        }}
      >
        Tạo chuyến + checklist
      </button>
    </div>
  );
}

interface ScanResult {
  candidates: FlightTripCandidate[];
  skipped: string[];
  attachments: GmailAttachmentRef[];
  scanned: number;
  today: string;
}

/**
 * Quét Gmail → THẺ KẾT QUẢ hiện MỘT LẦN (v2.0): mốc "Hôm nay", ứng viên,
 * và các chặng lịch sử đều nằm trong thẻ này, đóng được — không nằm cố
 * định trên màn. Xác nhận chuyến thì vé PDF trong email tự lưu vào chuyến.
 */
function GmailScan() {
  const gs = useGoogleStatus();
  const { trips, addTrip, updateTrip } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (gs.loading || !gs.configured) return null;

  if (!gs.connected || !gs.gmail) {
    return (
      <a className="btn" href="/api/google/auth" style={{ textDecoration: "none", textAlign: "center" }}>
        📧 {gs.connected ? "Cấp quyền đọc Gmail (nối lại Google)" : "Nối Google để quét vé máy bay"}
      </a>
    );
  }

  async function scan() {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await fetchFlightTrips();
    setBusy(false);
    if (!r.ok) {
      setError(
        r.reason === "no-key"
          ? "Trích vé cần ANTHROPIC_API_KEY trên server."
          : r.reason === "no-gmail-scope"
            ? "Chưa có quyền Gmail — bấm nối lại Google nhé."
            : `Quét không thành công${r.detail ? ` (${r.detail})` : ""}.`,
      );
      return;
    }
    setResult({
      candidates: r.trips,
      skipped: r.skipped,
      attachments: r.attachments,
      scanned: r.scanned,
      today: r.todayLocal,
    });
  }

  /** Tự lưu vé PDF của email vào chuyến vừa xác nhận (v2.0). */
  async function saveTickets(c: FlightTripCandidate, tripId: string) {
    const refs = result?.attachments ?? [];
    const matched = refs.filter((x) => x.subject === c.subject);
    const use = (matched.length ? matched : refs).slice(0, 3);
    let saved = 0;
    for (let i = 0; i < use.length; i++) {
      const blob = await fetchGmailAttachment(use[i]);
      if (!blob) continue;
      const name = i === 0 ? ticketFileName(c, use[i].filename) : use[i].filename;
      const att = useStore.getState().addTripAttachment(tripId, name);
      if (att && (await putFile(att.id, blob))) saved++;
    }
    if (saved > 0) setNote(`🎫 Đã lưu ${saved} file vé vào chuyến.`);
  }

  function confirm(c: FlightTripCandidate, i: number) {
    const existing = c.pnr ? trips.find((t) => t.pnr && t.pnr === c.pnr) : undefined;
    const label = tabLabel(c.route, c.destination as Destination, c.departAt);
    // Giữ NGUYÊN ISO kèm offset múi giờ sân bay từ vé (§5.9) — không đổi về Z.
    const patch = {
      departAt: c.departAt,
      arriveAt: c.arriveAt,
      returnAt: c.returnAt,
      pnr: c.pnr,
      route: c.route,
      airportBufferMin: c.airportBufferMin,
      label,
    };
    let tripId: string;
    if (existing) {
      updateTrip(existing.id, patch);
      tripId = existing.id;
      setNote(`Đã cập nhật "${label}" (cùng mã đặt chỗ, không tạo bản sao).`);
    } else {
      const t = addTrip({ destination: c.destination as Destination, ...patch });
      tripId = t.id;
      setNote(`Đã tạo chuyến "${label}".`);
    }
    void saveTickets(c, tripId);
    setResult((s) => (s ? { ...s, candidates: s.candidates.filter((_, j) => j !== i) } : s));
  }

  return (
    <>
      <button className="btn" disabled={busy} onClick={() => void scan()}>
        {busy ? "Đang đọc email…" : "📧 Quét vé máy bay trong Gmail"}
      </button>
      {error && <p className="muted small">{error}</p>}
      {note && <p className="muted small">{note}</p>}
      {result && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b>Kết quả quét vé</b>
            <button
              className="btn ghost small"
              style={{ marginLeft: "auto" }}
              aria-label="Đóng kết quả quét"
              onClick={() => setResult(null)}
            >
              ✕
            </button>
          </div>
          <div className="note-box small">🕐 Hôm nay: <b>{result.today}</b> (giờ nơi Mai đang ở)</div>
          <p className="muted small" style={{ margin: 0 }}>
            {result.candidates.length === 0
              ? `Không thấy chuyến sắp tới nào trong ${result.scanned} email gần đây.`
              : `${result.candidates.length} chuyến sắp tới trong ${result.scanned} email:`}
          </p>
          {result.candidates.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="t small">
                <b>
                  ✈️ {shortRoute(c.route) ??
                    (c.destination === "other" ? (c.destinationName ?? "Nơi khác") : DESTINATION_LABELS[c.destination])}
                  {" · "}
                  {fmtDayTime(c.departAt)}
                </b>
                <span className="muted">
                  {c.flights}
                  {c.pnr ? ` · PNR ${c.pnr}` : ""}
                  {c.returnAt ? ` · về ${fmtDay(c.returnAt)}` : ""} · từ email “{c.subject.slice(0, 60)}”
                </span>
              </span>
              {c.destination === "other" ? (
                <span className="muted small">chưa có checklist cho điểm đến này</span>
              ) : c.pnr && trips.some((t) => t.pnr === c.pnr) ? (
                <button className="btn small" onClick={() => confirm(c, i)}>
                  Cập nhật giờ
                </button>
              ) : (
                <button className="btn primary small" onClick={() => confirm(c, i)}>
                  Tạo chuyến
                </button>
              )}
            </div>
          ))}
          {result.skipped.length > 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              Lịch sử: {result.skipped.slice(0, 6).join(" · ")}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Chuỗi ngày bay ĐẦY ĐỦ HAI ĐẦU, mọi block chỉnh được (PRD §5.9 v2.0). */
function FullChain({ trip }: { trip: Trip }) {
  const gs = useGoogleStatus();
  const { addEvents, events, settings } = useStore();
  const { from, to } = iataPair(trip.route);
  const fromBkk = from === "BKK" || from === "DMK";
  const toBkk = to === "BKK" || to === "DMK" || trip.destination === "bkk";

  const [prepOn, setPrepOn] = useState(true);
  const [prepMin, setPrepMin] = useState(90);
  const [travelMin, setTravelMin] = useState(45);
  const [modeTo, setModeTo] = useState<TravelMode>("grab");
  const [origin, setOrigin] = useState(fromBkk ? settings.homeAddress : "");
  const [checkinMin, setCheckinMin] = useState(Math.max(trip.airportBufferMin ?? 0, 150));
  const [arriveProcMin, setArriveProcMin] = useState(60);
  const [afterOn, setAfterOn] = useState(true);
  const [afterMin, setAfterMin] = useState(40);
  const [modeAfter, setModeAfter] = useState<TravelMode>("grab");
  const [destPlace, setDestPlace] = useState(toBkk ? settings.homeAddress : "");
  const [mapsMsg, setMapsMsg] = useState<string | null>(null);
  const locked = events.some((e) => e.chainOf === trip.id);

  const chain = useMemo(
    () =>
      fullFlightChain({
        departureAt: trip.departAt,
        arrivalAt: trip.arriveAt,
        international: true,
        prepMinutes: prepOn ? prepMin : 0,
        travelToAirportMin: travelMin,
        ticketCheckinMin: trip.airportBufferMin,
        checkinOverrideMin: checkinMin,
        arrivalProcessMin: arriveProcMin,
        travelAfterMin: afterOn && trip.arriveAt ? afterMin : 0,
        // v2.3: cảnh báo tính theo giờ ĐỊA PHƯƠNG thành phố đi — dữ liệu
        // cũ lưu dạng Z thì suy từ mã sân bay, cuối cùng mới tới giờ máy.
        originTzOffsetMin:
          parseOffsetMin(trip.departAt) ??
          (from ? IATA_TZ_MIN[from] : undefined) ??
          -new Date().getTimezoneOffset(),
      }),
    [trip, from, prepOn, prepMin, travelMin, checkinMin, arriveProcMin, afterOn, afterMin],
  );
  const chainError = validateChainBlocks(chain.blocks);
  const departDay = new Date(trip.departAt);

  async function calcTravel(which: "to" | "after") {
    const place = which === "to" ? origin : destPlace;
    const mode = which === "to" ? modeTo : modeAfter;
    const airport = `sân bay ${which === "to" ? (from ?? "") : (to ?? "")}`.trim();
    setMapsMsg(null);
    const r = await fetchRoute({
      origin: which === "to" ? place : airport,
      destination: which === "to" ? airport : place,
      mode: routeMode(mode),
      arriveByMs:
        which === "to"
          ? Date.parse(trip.departAt) - checkinMin * 60_000
          : Date.parse(trip.arriveAt ?? trip.departAt) + arriveProcMin * 60_000,
    });
    if (!r.ok) {
      setMapsMsg(`Không tính được (${r.detail}).`);
      return;
    }
    if (which === "to") setTravelMin(r.route.totalMin);
    else setAfterMin(r.route.totalMin);
  }

  function minInput(value: number, onChange: (n: number) => void, label: string) {
    return (
      <input
        type="number"
        min={0}
        max={1440}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
        style={{ width: 58, padding: "4px 6px", borderRadius: 9, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
      />
    );
  }

  function modeSelect(value: TravelMode, onChange: (m: TravelMode) => void, label: string) {
    return (
      <select className="btn small" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as TravelMode)}>
        {MODE_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>Chuỗi ngày bay — {fmtDay(trip.departAt)}</b>

      {chainError ? (
        <div className="note-box small">⚠ {chainError}</div>
      ) : (
        <>
          {chain.warnings.length > 0 && (
            <div className="note-box small">⚠ {chain.warnings.join(" · ")}</div>
          )}
          {chain.blocks.map((b) => (
            <div className={`block-line${b.key === "flight" ? "" : " faded"}`} key={b.key}>
              <span className="time">
                {isSameDay(b.startAt, departDay) ? "" : `${fmtDay(b.startAt)}, `}
                {fmtRange(b.startAt, b.endAt)}
              </span>
              <span>{b.key === "flight" ? `✈️ Bay ${flightName(trip)}` : b.label}</span>
            </div>
          ))}
          {!trip.arriveAt && (
            <div className="block-line">
              <span className="time">{fmtTime(trip.departAt)}</span>
              <span>✈️ Cất cánh {flightName(trip)}</span>
            </div>
          )}
          {chain.arriveAt && (
            <div className="muted small">
              → Về đến nơi: <b>{fmtTime(chain.arriveAt)}</b>
              {isSameDay(chain.arriveAt, departDay) ? "" : ` (${fmtDay(chain.arriveAt)})`}
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" className="check" checked={prepOn} onChange={(e) => setPrepOn(e.target.checked)} />
          <span style={{ flex: 1 }}>Chuẩn bị</span>
          {prepOn && minInput(prepMin, setPrepMin, "Phút chuẩn bị")}
          {prepOn && <span className="muted">phút</span>}
        </label>
        <div className="small" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ flex: "1 0 100%" }}>Ra sân bay {from ? `(${from})` : ""}</span>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: "4px 8px", flex: "1 1 130px" }}
            placeholder="Điểm xuất phát"
            aria-label="Điểm xuất phát ra sân bay"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
          {modeSelect(modeTo, setModeTo, "Phương tiện ra sân bay")}
          {minInput(travelMin, setTravelMin, "Phút ra sân bay")}
          <span className="muted">phút</span>
          {gs.maps && origin && (
            <button className="btn ghost small" onClick={() => void calcTravel("to")}>
              Tính
            </button>
          )}
          {origin && (
            <a
              className="btn ghost small"
              style={{ textDecoration: "none" }}
              target="_blank"
              rel="noreferrer"
              href={mapsUrl(origin, `sân bay ${from ?? ""}`, modeTo)}
            >
              Mở Maps
            </a>
          )}
        </div>
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1 }}>Check-in, an ninh {trip.airportBufferMin ? `(vé: ${trip.airportBufferMin} phút)` : ""}</span>
          {minInput(checkinMin, setCheckinMin, "Phút check-in")}
          <span className="muted">phút</span>
        </label>
        {trip.arriveAt && (
          <>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1 }}>Nhập cảnh, hành lý, ra sảnh</span>
              {minInput(arriveProcMin, setArriveProcMin, "Phút nhập cảnh")}
              <span className="muted">phút</span>
            </label>
            <div className="small" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 0 100%" }}>
                <input type="checkbox" className="check" checked={afterOn} onChange={(e) => setAfterOn(e.target.checked)} />
                Di chuyển sau khi đáp {to ? `(${to})` : ""}
              </label>
              {afterOn && (
                <>
                  <input
                    className="transcript"
                    style={{ minHeight: 0, padding: "4px 8px", flex: "1 1 130px" }}
                    placeholder="Điểm đến (nhà, khách sạn…)"
                    aria-label="Điểm đến sau khi đáp"
                    value={destPlace}
                    onChange={(e) => setDestPlace(e.target.value)}
                  />
                  {modeSelect(modeAfter, setModeAfter, "Phương tiện sau khi đáp")}
                  {minInput(afterMin, setAfterMin, "Phút sau khi đáp")}
                  <span className="muted">phút</span>
                  {gs.maps && destPlace && (
                    <button className="btn ghost small" onClick={() => void calcTravel("after")}>
                      Tính
                    </button>
                  )}
                  {destPlace && (
                    <a
                      className="btn ghost small"
                      style={{ textDecoration: "none" }}
                      target="_blank"
                      rel="noreferrer"
                      href={mapsUrl(`sân bay ${to ?? ""}`, destPlace, modeAfter)}
                    >
                      Mở Maps
                    </a>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {mapsMsg && <p className="muted small">{mapsMsg}</p>}
      </div>

      <button
        className={`btn ${locked ? "done" : "primary"}`}
        disabled={locked || Boolean(chainError)}
        onClick={() =>
          addEvents(
            chain.blocks.map((b) => ({
              title: b.key === "flight" ? `✈️ Bay ${flightName(trip)}` : b.label,
              startAt: b.startAt,
              endAt: b.endAt,
              kind:
                b.key === "prep"
                  ? "prep"
                  : b.key === "flight"
                    ? "flight"
                    : b.key === "checkin" || b.key === "arrival"
                      ? "airport"
                      : "travel",
              chainOf: trip.id,
            })),
          )
        }
      >
        {locked ? "Đã khóa vào lịch ✓" : "Khóa chuỗi vào lịch"}
      </button>
    </div>
  );
}

/** File vé đã lưu vào chuyến (v2.0) — mở từ IndexedDB. */
function TripFiles({ trip }: { trip: Trip }) {
  const [msg, setMsg] = useState<string | null>(null);
  const atts = trip.attachments ?? [];
  if (atts.length === 0) return null;

  async function open(att: TripAttachment) {
    const blob = await getFile(att.id);
    if (!blob) {
      setMsg(`"${att.filename}" không còn trên thiết bị này.`);
      return;
    }
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <b>🎫 Vé & file của chuyến</b>
      {atts.map((a) => (
        <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="t small" style={{ opacity: a.isLatest ? 1 : 0.6 }}>
            {a.filename}
            {!a.isLatest && <span className="muted"> · bản cũ (v{a.version})</span>}
          </span>
          <button className="btn small" onClick={() => void open(a)}>
            Mở
          </button>
        </div>
      ))}
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}

/** Chuyến coi là xong sau (giờ về ?? giờ đi) + 24h → chỉ còn ở Lịch sử. */
function isPastTrip(t: Trip, nowMs: number): boolean {
  return Date.parse(t.returnAt ?? t.departAt) + 24 * 60 * 60_000 < nowMs;
}

export default function TripsPage() {
  const mounted = useMounted();
  const {
    trips,
    events,
    toggleTripItem,
    addCustomItem,
    removeTripItem,
    newRound,
    deleteTrip,
    undoDeleteTrip,
  } = useStore();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<ChecklistTab>("pack");
  const [tripId, setTripId] = useState<string | null>(null);
  const [addText, setAddText] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [keepFiles, setKeepFiles] = useState(true);
  const [undo, setUndo] = useState<{ ids: string[]; until: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const nowMs = Date.now();
  const upcoming = trips.filter((t) => !isPastTrip(t, nowMs));
  const past = trips.filter((t) => isPastTrip(t, nowMs));
  const trip = trips.find((t) => t.id === tripId) ?? upcoming[0] ?? trips[0];

  const groups = useMemo(() => {
    if (!trip) return [];
    return groupsFor(tab, trip.destination)
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => !trip.removed[it.id]),
        custom: trip.customItems.filter((c) => c.groupId === g.id),
      }))
      .filter((g) => g.items.length + g.custom.length > 0 || tab === "pack");
  }, [trip, tab]);

  const { total, done } = useMemo(() => {
    if (!trip) return { total: 0, done: 0 };
    let total = 0;
    let done = 0;
    for (const g of groups) {
      for (const it of g.items) {
        total++;
        if (trip.done[it.id]) done++;
      }
      for (const c of g.custom) {
        total++;
        if (trip.done[c.id]) done++;
      }
    }
    return { total, done };
  }, [trip, groups]);

  /** Xóa 1 hay nhiều chuyến: gỡ block GCal của chuỗi, vào thùng rác 10'. */
  function doDelete(ids: string[], keep: boolean) {
    for (const id of ids) {
      const t = trips.find((x) => x.id === id);
      if (!t) continue;
      for (const e of events.filter((e) => e.chainOf === id)) {
        if (e.gcalId) void deleteGcalEvent(e.gcalId);
      }
      if (!keep) for (const a of t.attachments ?? []) void deleteFile(a.id);
      deleteTrip(id);
    }
    setUndo({ ids, until: Date.now() + 5 * 60_000 });
    setConfirmDelete(false);
    setSelecting(false);
    setSelected({});
    setTripId(null);
  }

  if (!mounted) {
    return (
      <main className="screen-body">
        <div className="hdr">
          <h1>Chuyến đi</h1>
        </div>
      </main>
    );
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Chuyến đi</h1>
        {trip && (
          <button className="btn ghost small" onClick={() => newRound(trip.id)}>
            Bắt đầu chuyến mới
          </button>
        )}
      </div>

      <GmailScan />

      {undo && Date.now() < undo.until && (
        <div className="note-box small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Đã xóa {undo.ids.length} chuyến.
          <button
            className="btn small"
            onClick={() => {
              undo.ids.forEach((id) => undoDeleteTrip(id));
              setUndo(null);
            }}
          >
            Hoàn tác
          </button>
        </div>
      )}

      {!trip && !creating && (
        <>
          <Bubble>
            Chưa có chuyến nào. Quét Gmail phía trên, hoặc tạo tay một chuyến — mình dựng sẵn
            checklist theo điểm đến.
          </Bubble>
          <button className="btn primary" onClick={() => setCreating(true)}>
            ✈️ Thêm chuyến bay
          </button>
        </>
      )}
      {creating && <NewTripForm onDone={() => setCreating(false)} />}

      {trip && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {upcoming.map((t) => (
              <button
                key={t.id}
                className="btn"
                style={
                  t.id === trip.id
                    ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }
                    : undefined
                }
                onClick={() => setTripId(t.id)}
              >
                {t.label}
              </button>
            ))}
            <button className="btn ghost" onClick={() => setCreating(true)}>
              +
            </button>
          </div>

          {isPastTrip(trip, nowMs) ? (
            <div className="note-box small">✈️ Chuyến này đã bay ({fmtDay(trip.departAt)}) — nằm trong Lịch sử.</div>
          ) : (
            <FullChain trip={trip} />
          )}

          <TripFiles trip={trip} />

          <div className="progress">
            <div className="bar-track">
              <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <span className="num">
              {done}/{total}
            </span>
          </div>

          <div className="tabs2" role="tablist">
            <button role="tab" aria-selected={tab === "pack"} onClick={() => setTab("pack")}>
              Đồ mang theo
            </button>
            <button role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>
              Việc trước khi bay
            </button>
          </div>

          {groups.map((g) => {
            const gDone =
              g.items.filter((i) => trip.done[i.id]).length +
              g.custom.filter((c) => trip.done[c.id]).length;
            return (
              <section className="card" key={g.id}>
                <div className="hdr">
                  <h3 style={{ fontSize: 18 }}>{g.title}</h3>
                  <span className="muted small">
                    {gDone}/{g.items.length + g.custom.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                  {g.items.map((it) => (
                    <label
                      key={it.id}
                      className={`row${trip.done[it.id] ? " done-row" : ""}`}
                      style={{ padding: "8px 4px", background: "transparent" }}
                    >
                      <input
                        type="checkbox"
                        className="check"
                        checked={!!trip.done[it.id]}
                        onChange={() => toggleTripItem(trip.id, it.id)}
                      />
                      <span className="t">
                        <b style={{ fontWeight: 500 }}>{it.title}</b>
                        {it.hint && <span className="small muted">{it.hint}</span>}
                      </span>
                      <button
                        className="btn ghost small"
                        aria-label={`Xóa ${it.title}`}
                        onClick={(e) => {
                          e.preventDefault();
                          removeTripItem(trip.id, it.id, false);
                        }}
                      >
                        Xóa
                      </button>
                    </label>
                  ))}
                  {g.custom.map((c) => (
                    <label
                      key={c.id}
                      className={`row${trip.done[c.id] ? " done-row" : ""}`}
                      style={{ padding: "8px 4px", background: "transparent" }}
                    >
                      <input
                        type="checkbox"
                        className="check"
                        checked={!!trip.done[c.id]}
                        onChange={() => toggleTripItem(trip.id, c.id)}
                      />
                      <span className="t">
                        <b style={{ fontWeight: 500 }}>{c.text}</b>
                        <span className="small muted">món của Mai — giữ cho chuyến sau</span>
                      </span>
                      <button
                        className="btn ghost small"
                        aria-label={`Xóa ${c.text}`}
                        onClick={(e) => {
                          e.preventDefault();
                          removeTripItem(trip.id, c.id, true);
                        }}
                      >
                        Xóa
                      </button>
                    </label>
                  ))}
                </div>
                <form
                  className="add-line"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = (addText[g.id] ?? "").trim();
                    if (!v) return;
                    addCustomItem(trip.id, g.id, v);
                    setAddText((s) => ({ ...s, [g.id]: "" }));
                  }}
                >
                  <input
                    placeholder="Thêm món / việc của riêng Mai"
                    aria-label={`Thêm vào ${g.title}`}
                    value={addText[g.id] ?? ""}
                    onChange={(e) => setAddText((s) => ({ ...s, [g.id]: e.target.value }))}
                  />
                  <button type="submit">Thêm</button>
                </form>
              </section>
            );
          })}

          <div className="note-box">
            Giấy tờ nhập cảnh (visa, tờ khai điện tử) tùy quốc tịch và thay đổi theo thời gian —
            kiểm tra trang chính thức trước mỗi chuyến. Chất lỏng xách tay tối đa 100ml mỗi chai;
            pin dự phòng không ký gửi.
          </div>

          {!confirmDelete ? (
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmDelete(true)}>
              Xóa chuyến “{trip.label}”
            </button>
          ) : (
            <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <b>Xóa chuyến “{trip.label}”?</b>
              <span>
                Sẽ xóa: {events.filter((e) => e.chainOf === trip.id).length} block chuỗi trong Lịch
                {events.some((e) => e.chainOf === trip.id && e.gcalId) ? " (cả trên Google Calendar)" : ""}
                {" · "}checklist của chuyến
                {(trip.attachments?.length ?? 0) > 0 ? ` · ${trip.attachments!.length} file vé (tùy chọn dưới)` : ""}.
                {!isPastTrip(trip, nowMs) && " Xóa trong app không hủy vé với hãng bay."}
              </span>
              {(trip.attachments?.length ?? 0) > 0 && (
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" className="check" checked={keepFiles} onChange={(e) => setKeepFiles(e.target.checked)} />
                  Giữ lại file vé
                </label>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary small" onClick={() => doDelete([trip.id], keepFiles)}>
                  Xóa chuyến
                </button>
                <button className="btn small" onClick={() => setConfirmDelete(false)}>
                  Thôi
                </button>
              </div>
            </div>
          )}

          {past.length > 0 && (
            <section className="card">
              <div className="hdr">
                <h3 style={{ fontSize: 18 }}>Lịch sử</h3>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <span className="muted small">{past.length} chuyến đã bay</span>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setSelecting((v) => !v);
                      setSelected({});
                    }}
                  >
                    {selecting ? "Thôi" : "Chọn nhiều"}
                  </button>
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {past.map((t) => (
                  <button
                    key={t.id}
                    className="btn small"
                    aria-pressed={selecting ? !!selected[t.id] : t.id === trip.id}
                    style={
                      (selecting ? selected[t.id] : t.id === trip.id)
                        ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }
                        : { opacity: 0.65 }
                    }
                    onClick={() =>
                      selecting
                        ? setSelected((s) => ({ ...s, [t.id]: !s[t.id] }))
                        : setTripId(t.id)
                    }
                  >
                    ✈️ {t.label}
                  </button>
                ))}
              </div>
              {selecting && selectedIds.length > 0 && (
                <button
                  className="btn primary small"
                  style={{ marginTop: 8 }}
                  onClick={() => doDelete(selectedIds, true)}
                >
                  Xóa {selectedIds.length} chuyến đã chọn (giữ file vé)
                </button>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
