"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { projectById } from "@/core/projects";
import {
  activeReminder,
  daysUntil,
  intervalLabel,
  isSeriesDay,
  type RecurringSeries,
  type SeriesUnit,
} from "@/core/series";
import { proposeSlots } from "@/core/slots";
import { carChain, transitChain, type Chain } from "@/core/timeback";
import type { CalEvent, Destination, Task, Trip } from "@/core/types";
import { PlaceSelect } from "@/components/PlaceSelect";
import { fmtDay, fmtDayFull, fmtRange, fmtTime, isSameDay } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import {
  createGcalEvent,
  deleteGcalEvent,
  fetchRoute,
  searchGcalEvents,
  useGoogleEvents,
  useGoogleStatus,
} from "@/lib/useGoogle";

const PREP_PROFILES = [
  { label: "Ra ngoài đầy đủ (tắm + make up)", minutes: 90 },
  { label: "Ra ngoài nhanh", minutes: 30 },
  { label: "Họp online có quay mặt", minutes: 20 },
  { label: "Không cần chuẩn bị", minutes: 0 },
];

function ChainForm({
  event,
  gcalConnected,
  mapsAvailable,
  onClose,
}: {
  event: CalEvent;
  gcalConnected: boolean;
  mapsAvailable: boolean;
  onClose: () => void;
}) {
  const { settings, addEvents, setWalkToStation, setHomeAddress, places } = useStore();
  const [mode, setMode] = useState<"transit" | "car">("transit");
  const [prep, setPrep] = useState(settings.defaultPrepMinutes);
  const [walkTo, setWalkTo] = useState(settings.walkToStationMin);
  const [transitMin, setTransitMin] = useState(30);
  const [walkFrom, setWalkFrom] = useState(8);
  const [driveMin, setDriveMin] = useState(30);
  const [rain, setRain] = useState(false);
  const [writeGcal, setWriteGcal] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gcalWarn, setGcalWarn] = useState(false);
  const [origin, setOrigin] = useState(settings.homeAddress);
  const [dest, setDest] = useState(event.location ?? "");
  const [mapsBusy, setMapsBusy] = useState(false);
  const [mapsMsg, setMapsMsg] = useState<string | null>(null);

  /** Google Maps điền số phút vào form — Mai vẫn xem lại rồi mới Khóa. */
  async function fillFromMaps() {
    if (!origin.trim() || !dest.trim()) {
      setMapsMsg("Mai điền điểm đi và điểm đến trước nhé.");
      return;
    }
    setMapsBusy(true);
    setMapsMsg(null);
    // Giờ cần CÓ MẶT = giờ hẹn − đệm đến sớm 10 phút.
    const arriveByMs = new Date(event.startAt).getTime() - 10 * 60_000;
    const r = await fetchRoute({
      origin: origin.trim(),
      destination: dest.trim(),
      mode: mode === "car" ? "drive" : "transit",
      arriveByMs,
    });
    setMapsBusy(false);
    if (!r.ok) {
      setMapsMsg(`Maps không tính được (${r.detail}).`);
      return;
    }
    setHomeAddress(origin.trim());
    if (r.route.mode === "drive") {
      setDriveMin(r.route.driveMin ?? r.route.totalMin);
      setMapsMsg(`Maps: lái ~${r.route.totalMin} phút (đã tính giao thông dự báo).`);
    } else {
      setWalkTo(r.route.walkToMin ?? 0);
      setTransitMin(r.route.transitMin ?? r.route.totalMin);
      setWalkFrom(r.route.walkFromMin ?? 0);
      setMapsMsg(
        `Maps: tổng ~${r.route.totalMin} phút (đi bộ ${r.route.walkToMin ?? 0}’ → tàu ${r.route.transitMin ?? 0}’ → đi bộ ${r.route.walkFromMin ?? 0}’), theo giờ đến.`,
      );
    }
  }

  const chain: Chain =
    mode === "transit"
      ? transitChain({
          appointmentAt: event.startAt,
          prepMinutes: prep,
          walkToStationMin: walkTo,
          transitMin,
          walkFromStationMin: walkFrom,
          rain,
        })
      : carChain({ appointmentAt: event.startAt, prepMinutes: prep, driveMin });

  const altCar = carChain({ appointmentAt: event.startAt, prepMinutes: prep, driveMin });

  async function lock() {
    setSaving(true);
    const blocks = chain.blocks.filter((b) => b.kind === "prep" || b.kind === "travel");
    const toStore: Omit<CalEvent, "id">[] = [];
    let anyGcalFail = false;
    // Lịch đích theo dự án của sự kiện chính (§5.3.4), không có thì mặc định.
    const targetAcct = event.projectId
      ? useStore.getState().settings.projectCalendar[event.projectId]
      : undefined;
    for (const b of blocks) {
      let gcalId: string | undefined;
      let calAccount: string | undefined;
      if (gcalConnected && writeGcal) {
        const created = await createGcalEvent(
          {
            title: `🌼 ${b.label} — ${event.title}`,
            startAt: b.startAt,
            endAt: b.endAt,
          },
          targetAcct,
        );
        gcalId = created?.gcalId;
        calAccount = created?.accountId;
        if (!gcalId) anyGcalFail = true;
      }
      toStore.push({
        title: b.label,
        startAt: b.startAt,
        endAt: b.endAt,
        kind: b.kind as CalEvent["kind"],
        chainOf: event.id,
        gcalId,
        calAccount,
      });
    }
    addEvents(toStore);
    setWalkToStation(walkTo);
    setSaving(false);
    if (anyGcalFail) {
      setGcalWarn(true);
      return; // giữ form mở để Mai thấy cảnh báo; block local đã lưu
    }
    onClose();
  }

  const num = (v: number, set: (n: number) => void, label: string) => (
    <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: 1 }}>{label}</span>
      <input
        type="number"
        min={0}
        max={240}
        value={v}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        style={{ width: 64, padding: "6px 8px", borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
      />
      <span className="muted">phút</span>
    </label>
  );

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <b>
        Chuỗi cho “{event.title}” — {fmtTime(event.startAt)} {fmtDay(event.startAt)}
      </b>

      <div className="seg" role="radiogroup" aria-label="Phương tiện">
        <button aria-pressed={mode === "transit"} onClick={() => setMode("transit")}>
          🚆 BTS (mặc định)
        </button>
        <button aria-pressed={mode === "car"} onClick={() => setMode("car")}>
          🚗 Ô tô
        </button>
      </div>

      <select
        className="btn"
        value={prep}
        onChange={(e) => setPrep(Number(e.target.value))}
        aria-label="Hồ sơ chuẩn bị"
      >
        {PREP_PROFILES.map((pp) => (
          <option key={pp.minutes} value={pp.minutes}>
            {pp.label} — {pp.minutes} phút
          </option>
        ))}
      </select>

      {mapsAvailable && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <PlaceSelect places={places} onPick={setOrigin} label="Chọn điểm đi đã lưu" />
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 9, flex: 1 }}
              placeholder="Điểm đi (địa chỉ nhà — lưu lại cho lần sau)"
              aria-label="Điểm đi"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <PlaceSelect places={places} onPick={setDest} label="Chọn điểm đến đã lưu" />
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 9, flex: 1 }}
              placeholder="Điểm đến (tên quán/địa chỉ, càng cụ thể càng chuẩn)"
              aria-label="Điểm đến"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            />
          </div>
          <button className="btn" disabled={mapsBusy} onClick={() => void fillFromMaps()}>
            {mapsBusy ? "Đang hỏi Google Maps…" : "📍 Tính thời gian bằng Google Maps"}
          </button>
          {mapsMsg && <p className="muted small">{mapsMsg}</p>}
        </div>
      )}

      {mode === "transit" ? (
        <>
          {num(walkTo, setWalkTo, "Đi bộ nhà → BTS Bang Na (lưu lại)")}
          {num(transitMin, setTransitMin, "Tàu + đổi tuyến")}
          {num(walkFrom, setWalkFrom, "Đi bộ ga → điểm hẹn")}
          <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" className="check" checked={rain} onChange={(e) => setRain(e.target.checked)} />
            Dự báo mưa giờ đi (+10’ mỗi đoạn đi bộ)
          </label>
        </>
      ) : (
        num(driveMin, setDriveMin, "Lái xe (mô hình “ngày xấu”)")
      )}

      <div>
        {chain.blocks.map((b) => (
          <div className="block-line faded" key={b.kind + b.startAt} style={{ marginBottom: 6 }}>
            <span className="time">{fmtRange(b.startAt, b.endAt)}</span>
            <span>{b.label}</span>
          </div>
        ))}
        <div className="block-line">
          <span className="time">{fmtTime(event.startAt)}</span>
          <span>{event.title}</span>
        </div>
      </div>

      {chain.reminders.map((r) => (
        <div className="note-box" key={r}>
          ☔ {r}
        </div>
      ))}

      <div className="muted small">
        Bắt đầu chuẩn bị <b>{fmtTime(chain.prepStartAt)}</b> · rời nhà <b>{fmtTime(chain.leaveAt)}</b>
        {mode === "transit" && (
          <>
            {" "}
            · nếu đi ô tô: chuẩn bị từ {fmtTime(altCar.prepStartAt)} (mình vẫn giữ phương án tàu,
            Mai chọn thôi)
          </>
        )}
      </div>

      {gcalConnected && !gcalWarn && (
        <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            className="check"
            checked={writeGcal}
            onChange={(e) => setWriteGcal(e.target.checked)}
          />
          Ghi 2 block vào Google Calendar (hiện “bận” cho người khác)
        </label>
      )}

      {gcalWarn ? (
        <>
          <div className="note-box">
            Block đã lưu trong app, nhưng ghi sang Google Calendar không thành công — Mai thử gỡ
            chuỗi rồi khóa lại, hoặc kiểm tra kết nối Google.
          </div>
          <button className="btn" onClick={onClose}>
            Đóng
          </button>
        </>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" style={{ flex: 1 }} disabled={saving} onClick={() => void lock()}>
            {saving ? "Đang khóa…" : "Khóa 2 block vào lịch"}
          </button>
          <button className="btn" style={{ flex: 1 }} disabled={saving} onClick={onClose}>
            Thôi
          </button>
        </div>
      )}
      {!mapsAvailable && (
        <p className="muted small">
          Số phút di chuyển đang nhập tay — thêm GOOGLE_MAPS_API_KEY vào server là có nút tính tự động.
        </p>
      )}
    </div>
  );
}

type ViewMode = "day" | "week" | "month" | "list";

const KIND_FILTERS = [
  { id: "", label: "Mọi loại" },
  { id: "event", label: "Sự kiện" },
  { id: "block", label: "Block" },
  { id: "flight", label: "Chuyến bay" },
] as const;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function matchKind(e: CalEvent, kind: string): boolean {
  if (!kind) return true;
  if (kind === "event") return e.kind === "event";
  if (kind === "flight") return e.kind === "flight" || e.kind === "airport";
  return e.kind === "block" || e.kind === "prep" || e.kind === "travel";
}

/** Lưới tháng (§5.4.0): chấm màu dự án, biểu tượng bay/hạn cứng/hẹn định kỳ. */
function MonthGrid({
  year,
  month,
  events,
  tasks,
  trips,
  series,
  selected,
  onSelect,
}: {
  year: number;
  month: number; // 0-11
  events: CalEvent[];
  tasks: Task[];
  trips: Trip[];
  series: RecurringSeries[];
  selected: Date;
  onSelect: (d: Date) => void;
}) {
  const { projects } = useStore();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Thứ Hai đầu tuần
  const start = new Date(year, month, 1 - lead);
  const today = new Date();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return d;
  });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((w) => (
          <span key={w} className="muted small" style={{ textAlign: "center" }}>
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const inMonth = d.getMonth() === month;
          const dayEvents = events.filter((e) => isSameDay(e.startAt, d));
          const colors = [
            ...new Set(
              dayEvents
                .map((e) => (e.projectId ? projectById(projects, e.projectId).color : "#7D8AA5"))
                .slice(0, 6),
            ),
          ];
          const hasFlight =
            dayEvents.some((e) => e.kind === "flight") ||
            trips.some(
              (t) => isSameDay(t.departAt, d) || (t.returnAt ? isSameDay(t.returnAt, d) : false),
            );
          const hasHardDue = tasks.some(
            (t) =>
              t.dueAt &&
              t.dueType === "hard" &&
              (t.status === "todo" || t.status === "doing") &&
              isSameDay(t.dueAt, d),
          );
          const hasSeries = series.some((s) => isSeriesDay(s, d));
          const hasPendingBooking = dayEvents.some((e) => e.bookingStatus === "pending");
          const isToday =
            d.getFullYear() === today.getFullYear() &&
            d.getMonth() === today.getMonth() &&
            d.getDate() === today.getDate();
          const isSelected =
            d.getFullYear() === selected.getFullYear() &&
            d.getMonth() === selected.getMonth() &&
            d.getDate() === selected.getDate();
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              aria-label={`Ngày ${d.getDate()}/${d.getMonth() + 1}`}
              style={{
                minHeight: 46,
                borderRadius: 10,
                border: isToday ? "2px solid var(--mai)" : "1.5px solid var(--line)",
                background: isSelected ? "var(--ink)" : "var(--surface)",
                color: isSelected ? "var(--bg)" : inMonth ? "var(--ink)" : "var(--ink-2)",
                opacity: inMonth ? 1 : 0.45,
                padding: "3px 2px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <span className="small" style={{ fontWeight: 600 }}>
                {d.getDate()}
              </span>
              <span style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                {colors.slice(0, 3).map((c) => (
                  <span key={c} style={{ width: 5, height: 5, borderRadius: 3, background: c }} />
                ))}
                {colors.length > 3 && <span style={{ fontSize: 8 }}>+{colors.length - 3}</span>}
                {hasFlight && <span style={{ fontSize: 9 }}>✈️</span>}
                {hasSeries && <span style={{ fontSize: 9 }}>📄</span>}
                {hasHardDue && <span style={{ fontSize: 9 }}>❗</span>}
                {hasPendingBooking && <span style={{ fontSize: 9 }}>🔖</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SERIES_PRESETS: { id: string; label: string; unit: SeriesUnit; count: number }[] = [
  { id: "w1", label: "mỗi tuần", unit: "week", count: 1 },
  { id: "m1", label: "mỗi tháng", unit: "month", count: 1 },
  { id: "m3", label: "mỗi 3 tháng", unit: "month", count: 3 },
  { id: "m6", label: "mỗi 6 tháng", unit: "month", count: 6 },
  { id: "y1", label: "mỗi năm", unit: "year", count: 1 },
  { id: "custom", label: "tùy chỉnh (ngày)", unit: "day", count: 90 },
];

/** Hẹn định kỳ dài hạn (§5.4.0): gia hạn visa 3 tháng, khám mỗi năm… */
function SeriesSection() {
  const { series, trips, addSeries, updateSeries, deleteSeries, completeSeries } = useStore();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState("m3");
  const [customDays, setCustomDays] = useState(90);
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [doneDate, setDoneDate] = useState("");
  const [doneNotes, setDoneNotes] = useState("");
  const now = new Date();

  function add() {
    const p = SERIES_PRESETS.find((x) => x.id === preset)!;
    if (!title.trim() || !date) return;
    addSeries({
      title,
      intervalUnit: p.unit,
      intervalCount: p.id === "custom" ? Math.max(1, customDays) : p.count,
      nextDate: date,
    });
    setTitle("");
    setDate("");
    setAdding(false);
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="hdr">
        <h3 style={{ fontSize: 18 }}>📄 Hẹn định kỳ</h3>
        <button className="btn ghost small" onClick={() => setAdding((v) => !v)}>
          {adding ? "Thôi" : "+ Thêm"}
        </button>
      </div>

      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: 9 }}
            placeholder="Tên hẹn (ví dụ: Gia hạn visa Thái)"
            aria-label="Tên hẹn định kỳ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select className="btn small" value={preset} aria-label="Chu kỳ" onChange={(e) => setPreset(e.target.value)}>
              {SERIES_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {preset === "custom" && (
              <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                mỗi
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={customDays}
                  aria-label="Số ngày chu kỳ"
                  onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value) || 90))}
                  style={{ width: 64, padding: "4px 6px", borderRadius: 9, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
                />
                ngày
              </label>
            )}
            <input
              type="date"
              className="btn small"
              value={date}
              aria-label="Lần kế tiếp"
              onChange={(e) => setDate(e.target.value)}
            />
            <button className="btn primary small" disabled={!title.trim() || !date} onClick={add}>
              Thêm
            </button>
          </div>
        </div>
      )}

      {series.length === 0 && !adding && (
        <p className="muted small" style={{ margin: 0 }}>
          Chưa có hẹn định kỳ nào — ví dụ: gia hạn visa mỗi 3 tháng, khám răng mỗi 6 tháng.
        </p>
      )}

      {series.map((s) => {
        const left = daysUntil(s.nextDate, now);
        const rem = activeReminder(s, now);
        const flightClash = trips.some(
          (t) =>
            t.departAt.slice(0, 10) === s.nextDate ||
            (t.returnAt ? t.returnAt.slice(0, 10) === s.nextDate : false),
        );
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="small"
                style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 2 }}
              >
                <b>{s.title}</b>
                <span className="muted">
                  {intervalLabel(s.intervalUnit, s.intervalCount)} · lần tới{" "}
                  {fmtDayFull(`${s.nextDate}T09:00:00`)}
                </span>
              </span>
              {left >= 0 ? (
                <span
                  className="small"
                  style={
                    rem !== null
                      ? { color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 10px" }
                      : { color: "var(--ink-2)" }
                  }
                >
                  còn {left} ngày
                </span>
              ) : (
                <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 10px" }}>
                  quá hạn {-left} ngày
                </span>
              )}
              <button className="btn small" onClick={() => { setDoneFor(s.id); setDoneDate(new Date().toISOString().slice(0, 10)); setDoneNotes(""); }}>
                Đã làm
              </button>
              <button className="btn ghost small" aria-label={`Sửa ${s.title}`} onClick={() => setEditing(editing === s.id ? null : s.id)}>
                ✎
              </button>
              <button
                className="btn ghost small"
                aria-label={`Xóa ${s.title}`}
                onClick={() => {
                  if (window.confirm(`Xóa hẹn định kỳ "${s.title}"? Lịch sử các lần đã làm sẽ mất.`)) deleteSeries(s.id);
                }}
              >
                ×
              </button>
            </div>
            {flightClash && (
              <div className="note-box small">⚠ Lần hẹn tới trùng ngày bay — Mai tính dời sớm/muộn một chút?</div>
            )}
            {doneFor === s.id && (
              <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                Ngày làm thật:
                <input type="date" className="btn small" value={doneDate} aria-label="Ngày làm thật" onChange={(e) => setDoneDate(e.target.value)} />
                <input
                  className="transcript"
                  style={{ minHeight: 0, padding: "4px 8px", flex: "1 1 120px" }}
                  placeholder="Ghi chú (nơi làm, biên nhận…)"
                  aria-label="Ghi chú lần làm"
                  value={doneNotes}
                  onChange={(e) => setDoneNotes(e.target.value)}
                />
                <button
                  className="btn primary small"
                  disabled={!doneDate}
                  onClick={() => {
                    completeSeries(s.id, doneDate, doneNotes.trim() || undefined);
                    setDoneFor(null);
                  }}
                >
                  Lưu (lần sau tính từ ngày này)
                </button>
                <button className="btn small" onClick={() => setDoneFor(null)}>
                  Thôi
                </button>
              </div>
            )}
            {editing === s.id && (
              <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  className="transcript"
                  style={{ minHeight: 0, padding: 8 }}
                  value={s.title}
                  aria-label="Tên hẹn"
                  onChange={(e) => updateSeries(s.id, { title: e.target.value })}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  mỗi
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={s.intervalCount}
                    aria-label="Số chu kỳ"
                    onChange={(e) => updateSeries(s.id, { intervalCount: Math.max(1, Number(e.target.value) || 1) })}
                    style={{ width: 56, padding: "4px 6px", borderRadius: 9, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
                  />
                  <select
                    className="btn small"
                    value={s.intervalUnit}
                    aria-label="Đơn vị chu kỳ"
                    onChange={(e) => updateSeries(s.id, { intervalUnit: e.target.value as SeriesUnit })}
                  >
                    <option value="day">ngày</option>
                    <option value="week">tuần</option>
                    <option value="month">tháng</option>
                    <option value="year">năm</option>
                  </select>
                  · lần tới
                  <input
                    type="date"
                    className="btn small"
                    value={s.nextDate}
                    aria-label="Ngày lần tới"
                    onChange={(e) => e.target.value && updateSeries(s.id, { nextDate: e.target.value, prepCreatedFor: undefined })}
                  />
                </div>
                <textarea
                  className="transcript"
                  style={{ minHeight: 52, padding: 8 }}
                  aria-label="Mẫu việc chuẩn bị (mỗi dòng một việc)"
                  value={s.prepTemplate}
                  onChange={(e) => updateSeries(s.id, { prepTemplate: e.target.value })}
                />
                {s.history.length > 0 && (
                  <div className="small muted">
                    Lịch sử:{" "}
                    {s.history
                      .slice(0, 4)
                      .map((h) => `${fmtDay(`${h.actualDate}T09:00:00`)}${h.notes ? ` (${h.notes})` : ""}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

const BOOKING_METHODS = [
  { id: "call", label: "Gọi điện" },
  { id: "line", label: "LINE" },
  { id: "zalo", label: "Zalo" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "web", label: "Website/app" },
] as const;

const CITY_OPTIONS: { id: "" | Destination; label: string }[] = [
  { id: "", label: "— thành phố —" },
  { id: "bkk", label: "Bangkok" },
  { id: "hcmc", label: "HCMC" },
  { id: "tokyo", label: "Tokyo" },
];

/**
 * Địa điểm đã lưu (places §8): nhà ở từng thành phố (điểm đi/đến + link
 * Google Maps) và nơi cần đặt chỗ trước (§5.4.2).
 */
function PlacesSection() {
  const { places, addPlace, updatePlace, deletePlace } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState<"" | Destination>("");
  const [isHome, setIsHome] = useState(false);
  const [needsBook, setNeedsBook] = useState(false);
  const [lead, setLead] = useState(3);
  const [method, setMethod] = useState<(typeof BOOKING_METHODS)[number]["id"]>("call");
  const [contact, setContact] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const mapsSearch = (q: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="hdr">
        <h3 style={{ fontSize: 18 }}>📍 Địa điểm của Mai</h3>
        <button className="btn ghost small" onClick={() => setAdding((v) => !v)}>
          {adding ? "Thôi" : "+ Thêm"}
        </button>
      </div>

      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: 9 }}
            placeholder="Tên (Nhà ở HCM, Nhà Bang Na, Spa Sukhumvit…)"
            aria-label="Tên địa điểm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="transcript"
            style={{ minHeight: 0, padding: 9 }}
            placeholder="Địa chỉ cho Google Maps"
            aria-label="Địa chỉ"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select className="btn small" value={city} aria-label="Thành phố" onChange={(e) => setCity(e.target.value as typeof city)}>
              {CITY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" className="check" checked={isHome} onChange={(e) => setIsHome(e.target.checked)} />
              🏠 nơi ở chính
            </label>
            <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" className="check" checked={needsBook} onChange={(e) => setNeedsBook(e.target.checked)} />
              🔖 cần đặt chỗ trước
            </label>
          </div>
          {needsBook && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                đặt trước
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={lead}
                  aria-label="Đặt trước bao nhiêu ngày"
                  onChange={(e) => setLead(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 52, padding: "4px 6px", borderRadius: 9, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
                />
                ngày
              </label>
              <select className="btn small" value={method} aria-label="Cách đặt" onChange={(e) => setMethod(e.target.value as typeof method)}>
                {BOOKING_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <input
                className="transcript"
                style={{ minHeight: 0, padding: "4px 8px", flex: "1 1 140px" }}
                placeholder="SĐT hoặc link đặt chỗ"
                aria-label="Liên hệ đặt chỗ"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
          )}
          <button
            className="btn primary small"
            style={{ alignSelf: "flex-start" }}
            disabled={!name.trim()}
            onClick={() => {
              addPlace({
                name,
                address: address.trim() || undefined,
                city: city || undefined,
                isHome,
                needsBooking: needsBook,
                bookingLeadDays: needsBook ? lead : 0,
                bookingMethod: needsBook ? method : undefined,
                bookingContact: needsBook ? contact.trim() || undefined : undefined,
              });
              setName("");
              setAddress("");
              setIsHome(false);
              setNeedsBook(false);
              setContact("");
              setAdding(false);
            }}
          >
            Thêm
          </button>
        </div>
      )}

      {places.length === 0 && !adding && (
        <p className="muted small" style={{ margin: 0 }}>
          Lưu "Nhà ở HCM", "Nhà Bang Na"… để chuỗi ngày bay tự chọn đúng nhà theo đầu chặng, và
          spa/nhà hàng cần đặt chỗ để được nhắc đặt trước.
        </p>
      )}

      {places.map((p) => (
        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="t" style={{ flex: 1, minWidth: 140 }}>
              <b>
                {p.isHome ? "🏠 " : ""}
                {p.needsBooking ? "🔖 " : ""}
                {p.name}
              </b>
              <span className="muted">
                {CITY_OPTIONS.find((c) => c.id === (p.city ?? ""))?.label.replace("— thành phố —", "")}
                {p.address ? ` · ${p.address}` : ""}
                {p.needsBooking ? ` · đặt trước ${p.bookingLeadDays} ngày` : ""}
              </span>
            </span>
            {(p.address || p.name) && (
              <a
                className="btn ghost small"
                style={{ textDecoration: "none" }}
                href={mapsSearch(p.address || p.name)}
                target="_blank"
                rel="noreferrer"
              >
                Mở Maps
              </a>
            )}
            <button className="btn ghost small" aria-label={`Sửa ${p.name}`} onClick={() => setEditing(editing === p.id ? null : p.id)}>
              ✎
            </button>
            <button
              className="btn ghost small"
              aria-label={`Xóa ${p.name}`}
              onClick={() => {
                if (window.confirm(`Xóa địa điểm "${p.name}"?`)) deletePlace(p.id);
              }}
            >
              ×
            </button>
          </div>
          {editing === p.id && (
            <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                className="transcript"
                style={{ minHeight: 0, padding: 8 }}
                placeholder="Địa chỉ cho Google Maps"
                aria-label={`Địa chỉ của ${p.name}`}
                value={p.address ?? ""}
                onChange={(e) => updatePlace(p.id, { address: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="btn small"
                  value={p.city ?? ""}
                  aria-label={`Thành phố của ${p.name}`}
                  onChange={(e) => updatePlace(p.id, { city: (e.target.value || undefined) as Destination | undefined })}
                >
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={Boolean(p.isHome)}
                    onChange={(e) => updatePlace(p.id, { isHome: e.target.checked })}
                  />
                  🏠 nơi ở chính
                </label>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={p.needsBooking}
                    onChange={(e) => updatePlace(p.id, { needsBooking: e.target.checked })}
                  />
                  🔖 cần đặt trước
                </label>
                {p.needsBooking && (
                  <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={p.bookingLeadDays}
                      aria-label={`Số ngày đặt trước cho ${p.name}`}
                      onChange={(e) => updatePlace(p.id, { bookingLeadDays: Math.max(0, Number(e.target.value) || 0) })}
                      style={{ width: 48, padding: "3px 5px", borderRadius: 8, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
                    />
                    ngày
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default function CalendarPage() {
  const mounted = useMounted();
  const {
    events,
    tasks,
    trips,
    series,
    settings,
    pendingBlock,
    setPendingBlock,
    addEvent,
    addTriage,
    removeChain,
    setCalendarView,
    updateSeries,
    places,
    setEventBooking,
  } = useStore();
  const [chainFor, setChainFor] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [focus, setFocus] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<CalEvent[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [fProject, setFProject] = useState("");
  const [fKind, setFKind] = useState("");
  const [fSource, setFSource] = useState("");
  const { projects } = useStore();

  const view: ViewMode = settings.calendarView;
  const now = mounted ? new Date() : null;
  const gs = useGoogleStatus();
  const [gmsg, setGmsg] = useState<string | null>(null);

  // Kết quả quay về từ màn đồng ý của Google (?gok=1 / ?gerr=...).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const gok = p.get("gok");
    const gerr = p.get("gerr");
    if (gok) {
      setGmsg("Đã nối Google Calendar ✓ Sự kiện của Mai sẽ hiện bên dưới.");
      void gs.reload();
    } else if (gerr) {
      setGmsg(
        gerr === "config"
          ? "Server chưa có GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — thêm trong Vercel rồi Redeploy nhé."
          : `Nối Google không thành công (${gerr}). Mai thử lại giúp mình.`,
      );
    }
    if (gok || gerr) window.history.replaceState({}, "", "/lich");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Việc chuẩn bị cho hẹn định kỳ: đến mốc nhắc 30 ngày là vào Hộp duyệt,
  // mỗi lần hẹn chỉ tạo một lần (§5.4.0).
  useEffect(() => {
    if (!mounted) return;
    const today = new Date();
    for (const s of series) {
      const left = daysUntil(s.nextDate, today);
      if (left < 0 || left > 30 || s.prepCreatedFor === s.nextDate) continue;
      for (const line of s.prepTemplate.split("\n").map((x) => x.trim()).filter(Boolean)) {
        addTriage({
          title: `${line} — ${s.title}`,
          projectId: s.projectId,
          categoryId: s.categoryId,
          assignee: "mai",
          dueAt: new Date(`${s.nextDate}T09:00:00`).toISOString(),
          dueType: s.isHard ? "hard" : "soft",
          dueSource: "nguon",
          source: {
            channel: "manual",
            quote: `Hẹn định kỳ "${s.title}" — ${fmtDayFull(`${s.nextDate}T09:00:00`)}`,
          },
          confidence: 1,
        });
      }
      updateSeries(s.id, { prepCreatedFor: s.nextDate });
    }
  }, [mounted, series, addTriage, updateSeries]);

  // Khoảng dữ liệu theo chế độ xem — tháng nào tải tháng đó (không giới hạn).
  const range = useMemo(() => {
    const base = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate());
    if (view === "day") return { from: base.getTime(), to: base.getTime() + 86_400_000 };
    if (view === "month") {
      const first = new Date(focus.getFullYear(), focus.getMonth(), 1).getTime() - 7 * 86_400_000;
      const last = new Date(focus.getFullYear(), focus.getMonth() + 1, 1).getTime() + 7 * 86_400_000;
      return { from: first, to: last };
    }
    const todayStart = now ? startOfDay(now) : Date.now();
    return { from: todayStart, to: todayStart + (view === "list" ? 60 : 7) * 86_400_000 };
  }, [view, focus, now]);

  const gcal = useGoogleEvents(range.from, range.to, mounted && gs.connected);

  // Sự kiện Google (bỏ những block chính Lowtechie đã ghi sang, tránh trùng).
  const googleAsCal = useMemo(() => {
    const localGcalIds = new Set(events.map((e) => e.gcalId).filter(Boolean));
    return gcal.events
      .filter((g) => !localGcalIds.has(g.gcalId))
      .map(
        (g): CalEvent => ({
          id: `g:${g.gcalId}`,
          title: g.title,
          startAt: g.startAt,
          endAt: g.endAt,
          location: g.location,
          kind: "event",
          gcalId: g.gcalId,
        }),
      );
  }, [gcal.events, events]);
  const allDayIds = useMemo(
    () => new Set(gcal.events.filter((g) => g.allDay).map((g) => `g:${g.gcalId}`)),
    [gcal.events],
  );

  const applyFilters = useMemo(
    () => (list: CalEvent[]) =>
      list.filter(
        (e) =>
          matchKind(e, fKind) &&
          (!fProject || e.projectId === fProject) &&
          (!fSource || (fSource === "google" ? e.id.startsWith("g:") : !e.id.startsWith("g:"))),
      ),
    [fKind, fProject, fSource],
  );
  const allEvents = useMemo(
    () => applyFilters([...events, ...googleAsCal]),
    [events, googleAsCal, applyFilters],
  );

  const inRange = useMemo(
    () =>
      allEvents
        .filter((e) => Date.parse(e.endAt) >= range.from && Date.parse(e.startAt) < range.to)
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [allEvents, range],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of inRange) {
      const k = fmtDay(e.startAt);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [inRange]);

  const focusEvents = useMemo(
    () => allEvents.filter((e) => isSameDay(e.startAt, focus)).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [allEvents, focus],
  );
  const focusTasks = useMemo(
    () =>
      tasks.filter(
        (t) => t.dueAt && (t.status === "todo" || t.status === "doing") && isSameDay(t.dueAt, focus),
      ),
    [tasks, focus],
  );
  const focusSeries = useMemo(() => series.filter((s) => isSeriesDay(s, focus)), [series, focus]);

  const slots = useMemo(
    () =>
      now && pendingBlock
        ? proposeSlots(
            allEvents.filter((e) => e.kind === "event" || e.kind === "block"),
            now,
            pendingBlock.durationMinutes,
          )
        : [],
    [now, pendingBlock, allEvents],
  );

  const chainEvent = chainFor ? allEvents.find((e) => e.id === chainFor) : null;

  async function removeChainEverywhere(ev: CalEvent) {
    const withGcal = events.filter((x) => x.chainOf === ev.id && x.gcalId);
    await Promise.allSettled(withGcal.map((b) => deleteGcalEvent(b.gcalId!, b.calAccount)));
    removeChain(ev.id);
    void gcal.reload();
  }

  /** Tìm trên TOÀN BỘ lịch: sự kiện trong app (mọi thời điểm) + Google. */
  async function runSearch() {
    const q = search.trim();
    if (!q) return;
    setSearchBusy(true);
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
    const local = events.filter((e) => fold(`${e.title} ${e.location ?? ""}`).includes(fold(q)));
    const remote = gs.connected ? await searchGcalEvents(q) : [];
    const localIds = new Set(local.map((e) => e.gcalId).filter(Boolean));
    const merged: CalEvent[] = [
      ...local,
      ...remote
        .filter((g) => !localIds.has(g.gcalId))
        .map(
          (g): CalEvent => ({
            id: `g:${g.gcalId}`,
            title: g.title,
            startAt: g.startAt,
            endAt: g.endAt,
            location: g.location,
            kind: "event",
            gcalId: g.gcalId,
          }),
        ),
    ].sort((a, b) => a.startAt.localeCompare(b.startAt));
    setSearchResults(merged.slice(0, 50));
    setSearchBusy(false);
  }

  const eventRow = (e: CalEvent, withChainButtons = true) => {
    const hasChain = events.some((x) => x.chainOf === e.id);
    const place = e.placeId ? places.find((p) => p.id === e.placeId) : undefined;
    const soon =
      e.bookingStatus === "pending" &&
      Date.parse(e.startAt) - Date.now() < 24 * 3_600_000 &&
      Date.parse(e.startAt) > Date.now();
    return (
      <div key={e.id} style={{ marginTop: 6 }}>
        <div className={`block-line${e.kind !== "event" ? " faded" : ""}`}>
          <span className="time">
            {allDayIds.has(e.id) ? "Cả ngày" : fmtRange(e.startAt, e.endAt)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {e.gcalId && e.kind === "event" ? "📆 " : ""}
            {e.title}
            {e.location ? <span className="muted small"> · {e.location}</span> : null}
            {e.bookingStatus === "booked" && (
              <span className="small" style={{ color: "#2FA97C" }}> · ✓ đã đặt chỗ</span>
            )}
          </span>
          {e.bookingStatus === "pending" && (
            <button
              className="btn small"
              style={{ background: "var(--note)", borderColor: "var(--note)", color: "var(--note-ink)" }}
              onClick={() => {
                if (window.confirm(`Đánh dấu đã đặt chỗ${place ? ` ở ${place.name}` : ""}?`))
                  setEventBooking(e.id, "booked");
              }}
            >
              🔖 Chưa đặt
            </button>
          )}
          {e.bookingStatus === "pending" && place?.bookingContact && (
            <a
              className="btn ghost small"
              style={{ textDecoration: "none" }}
              href={
                /^https?:/i.test(place.bookingContact)
                  ? place.bookingContact
                  : `tel:${place.bookingContact.replace(/\s+/g, "")}`
              }
              target={/^https?:/i.test(place.bookingContact) ? "_blank" : undefined}
              rel="noreferrer"
            >
              {/^https?:/i.test(place.bookingContact) ? "Mở đặt chỗ" : "Gọi"}
            </a>
          )}
          {withChainButtons &&
            e.kind === "event" &&
            (hasChain ? (
              <button className="btn ghost small" onClick={() => void removeChainEverywhere(e)}>
                Gỡ chuỗi
              </button>
            ) : (
              <button className="btn small" onClick={() => setChainFor(e.id)}>
                + Chuỗi
              </button>
            ))}
        </div>
        {soon && (
          <div className="note-box small" style={{ marginTop: 4 }}>
            ⚠ Còn dưới 24 giờ mà chưa đặt chỗ — lịch này có thể không thành. Đặt ngay hoặc dời?
          </div>
        )}
      </div>
    );
  };

  const monthLabel = `Tháng ${focus.getMonth() + 1}/${focus.getFullYear()}`;

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Lịch</h1>
        {!mounted || gs.loading ? (
          <span className="muted small">…</span>
        ) : gs.connected ? (
          <span className="muted small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {gs.email ?? "đã nối"}
            <Link href="/ket-noi" className="btn ghost small" style={{ textDecoration: "none" }}>
              ⚙️ Kết nối
            </Link>
          </span>
        ) : gs.configured ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <a className="btn small" href="/api/google/auth" style={{ textDecoration: "none" }}>
              🔗 Nối Google Calendar
            </a>
            <Link href="/ket-noi" className="muted small">
              Kết nối…
            </Link>
          </span>
        ) : (
          <Link href="/ket-noi" className="muted small">
            local
          </Link>
        )}
      </div>
      {gmsg && (
        <div className="note-box" role="status">
          {gmsg}{" "}
          <button className="btn ghost small" onClick={() => setGmsg(null)}>
            Ẩn
          </button>
        </div>
      )}

      {mounted && (
        <>
          <div className="seg" role="radiogroup" aria-label="Chế độ xem">
            {(
              [
                ["day", "Ngày"],
                ["week", "Tuần"],
                ["month", "Tháng"],
                ["list", "Danh sách"],
              ] as [ViewMode, string][]
            ).map(([v, label]) => (
              <button key={v} aria-pressed={view === v} onClick={() => setCalendarView(v)}>
                {label}
              </button>
            ))}
          </div>

          <form
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 8, flex: 1 }}
              placeholder="Tìm cả lịch cũ lẫn tương lai…"
              aria-label="Tìm kiếm lịch"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value.trim()) setSearchResults(null);
              }}
            />
            <button className="btn small" type="submit" disabled={searchBusy || !search.trim()}>
              {searchBusy ? "…" : "Tìm"}
            </button>
            {searchResults && (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchResults(null);
                }}
              >
                ✕
              </button>
            )}
          </form>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select className="btn small" value={fProject} aria-label="Lọc dự án" onChange={(e) => setFProject(e.target.value)}>
              <option value="">Mọi dự án</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="btn small" value={fKind} aria-label="Lọc loại" onChange={(e) => setFKind(e.target.value)}>
              {KIND_FILTERS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <select className="btn small" value={fSource} aria-label="Lọc nguồn" onChange={(e) => setFSource(e.target.value)}>
              <option value="">Mọi nguồn</option>
              <option value="app">Trong app</option>
              <option value="google">Google</option>
            </select>
          </div>
        </>
      )}

      {mounted && searchResults && (
        <>
          <div className="group-title">Kết quả “{search.trim()}” · {searchResults.length}</div>
          {searchResults.map((e) => (
            <div key={e.id} style={{ marginTop: 6 }}>
              <div className="block-line">
                <span className="time">{fmtDay(e.startAt)} · {fmtRange(e.startAt, e.endAt)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {e.gcalId ? "📆 " : ""}
                  {e.title}
                  {e.location ? <span className="muted small"> · {e.location}</span> : null}
                </span>
              </div>
            </div>
          ))}
          {searchResults.length === 0 && (
            <p className="muted small">Không thấy sự kiện nào khớp.</p>
          )}
        </>
      )}

      {mounted && pendingBlock && !searchResults && (
        <>
          <Bubble>
            <b>{pendingBlock.title}</b>
            <br />
            Cần {pendingBlock.durationMinutes} phút. Mình đề xuất 3 khung — không có gì ghi vào
            lịch cho đến khi Mai bấm.
          </Bubble>
          {slots.map((s, i) => (
            <div className={`slot${i === 0 ? " pick" : ""}`} key={s.startAt}>
              <div>
                <div className="when">
                  {fmtDay(s.startAt)}, {fmtRange(s.startAt, s.endAt)}
                </div>
                <div className="small muted">{s.reason}</div>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  addEvent({
                    title: pendingBlock.title,
                    startAt: s.startAt,
                    endAt: s.endAt,
                    projectId: pendingBlock.projectId,
                    kind: "block",
                  });
                  setPendingBlock(undefined);
                }}
              >
                Đặt
              </button>
            </div>
          ))}
          {slots.length === 0 && (
            <div className="note-box">
              Tuần này kín quá, mình chưa tìm được khung {pendingBlock.durationMinutes} phút trống.
            </div>
          )}
          <button className="btn ghost" onClick={() => setPendingBlock(undefined)}>
            Bỏ tìm giờ
          </button>
        </>
      )}

      {chainEvent && (
        <ChainForm
          event={chainEvent}
          gcalConnected={gs.connected}
          mapsAvailable={gs.maps}
          onClose={() => setChainFor(null)}
        />
      )}

      {mounted && !searchResults && (view === "month" || view === "day") && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            className="btn small"
            aria-label="Lùi"
            onClick={() =>
              setFocus((d) =>
                view === "month"
                  ? new Date(d.getFullYear(), d.getMonth() - 1, 1)
                  : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1),
              )
            }
          >
            ◀
          </button>
          <b style={{ flex: 1, textAlign: "center" }}>
            {view === "month" ? monthLabel : fmtDayFull(focus.toISOString())}
          </b>
          <button
            className="btn small"
            aria-label="Tới"
            onClick={() =>
              setFocus((d) =>
                view === "month"
                  ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
                  : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
              )
            }
          >
            ▶
          </button>
          <button className="btn ghost small" onClick={() => setFocus(new Date())}>
            Hôm nay
          </button>
          {view === "month" && (
            <input
              type="month"
              className="btn small"
              aria-label="Chọn tháng/năm"
              value={`${focus.getFullYear()}-${String(focus.getMonth() + 1).padStart(2, "0")}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                if (y && m) setFocus(new Date(y, m - 1, 1));
              }}
            />
          )}
        </div>
      )}

      {mounted && !searchResults && view === "month" && (
        <>
          <MonthGrid
            year={focus.getFullYear()}
            month={focus.getMonth()}
            events={allEvents}
            tasks={tasks}
            trips={trips}
            series={series}
            selected={focus}
            onSelect={setFocus}
          />
          <div className="group-title">{fmtDayFull(focus.toISOString())}</div>
          {focusSeries.map((s) => (
            <div key={s.id} className="block-line" style={{ marginTop: 6 }}>
              <span className="time">📄</span>
              <span>{s.title} ({intervalLabel(s.intervalUnit, s.intervalCount)})</span>
            </div>
          ))}
          {focusTasks.map((t) => (
            <div key={t.id} className="block-line faded" style={{ marginTop: 6 }}>
              <span className="time">{t.dueType === "hard" ? "❗ hạn" : "hạn"}</span>
              <span>{t.title}</span>
            </div>
          ))}
          {focusEvents.map((e) => eventRow(e))}
          {focusEvents.length + focusTasks.length + focusSeries.length === 0 && (
            <p className="muted small">Ngày này trống.</p>
          )}
        </>
      )}

      {mounted && !searchResults && view === "day" && (
        <>
          {focusSeries.map((s) => (
            <div key={s.id} className="block-line" style={{ marginTop: 6 }}>
              <span className="time">📄</span>
              <span>{s.title}</span>
            </div>
          ))}
          {focusTasks.map((t) => (
            <div key={t.id} className="block-line faded" style={{ marginTop: 6 }}>
              <span className="time">{t.dueType === "hard" ? "❗ hạn" : "hạn"}</span>
              <span>{t.title}</span>
            </div>
          ))}
          {focusEvents.map((e) => eventRow(e))}
          {focusEvents.length + focusTasks.length + focusSeries.length === 0 && (
            <div className="empty card">
              <p>Ngày này trống.</p>
            </div>
          )}
        </>
      )}

      {mounted && !searchResults && (view === "week" || view === "list") && (
        <>
          {byDay.length === 0 && !pendingBlock && (
            <div className="empty card">
              <p>
                Lịch đang trống. Nói với bông mai kiểu <i>&ldquo;Tối nay 7 giờ hẹn ở Thonglor, đi
                tàu&rdquo;</i> — sự kiện sẽ hiện ở đây kèm chuỗi chuẩn bị + di chuyển.
              </p>
            </div>
          )}
          {byDay.map(([day, evs]) => (
            <div key={day}>
              <div className="group-title">{day}</div>
              {evs.map((e) => eventRow(e))}
            </div>
          ))}
        </>
      )}

      {mounted && !searchResults && <SeriesSection />}
      {mounted && !searchResults && <PlacesSection />}

      {mounted && !searchResults && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="group-title" style={{ marginTop: 0 }}>
            Thêm sự kiện nhanh
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 10 }}
              placeholder="Tên sự kiện"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              type="datetime-local"
              className="btn"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Thời điểm"
            />
            <button
              className="btn primary"
              disabled={!title.trim() || !when}
              onClick={() => {
                const start = new Date(when);
                // Nơi cần đặt chỗ (§5.4.2): lịch mang "Chưa đặt" + việc
                // "Đặt lịch…" vào Hộp duyệt với hạn = ngày hẹn − đặt trước.
                const place = places.find(
                  (pl) => pl.needsBooking && title.toLowerCase().includes(pl.name.toLowerCase()),
                );
                addEvent({
                  title: title.trim(),
                  startAt: start.toISOString(),
                  endAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
                  kind: "event",
                  bookingStatus: place ? "pending" : undefined,
                  placeId: place?.id,
                });
                if (place) {
                  const dueDate = new Date(start.getTime() - place.bookingLeadDays * 86_400_000);
                  dueDate.setHours(9, 0, 0, 0);
                  addTriage({
                    title: `Đặt lịch ${place.name} cho ${fmtDay(start.toISOString())} ${fmtTime(start.toISOString())}`,
                    projectId: "canhan",
                    categoryId: "canhan:suckhoe",
                    assignee: "mai",
                    dueAt: dueDate.toISOString(),
                    dueType: "hard",
                    dueSource: "nguon",
                    source: {
                      channel: "manual",
                      quote: `“${title.trim()}” — ${place.name} cần đặt trước ${place.bookingLeadDays} ngày`,
                    },
                    confidence: 1,
                  });
                }
                setTitle("");
                setWhen("");
              }}
            >
              Thêm (60 phút)
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
