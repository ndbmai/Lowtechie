"use client";

import { useEffect, useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { proposeSlots } from "@/core/slots";
import { carChain, transitChain, type Chain } from "@/core/timeback";
import type { CalEvent } from "@/core/types";
import { fmtDay, fmtRange, fmtTime } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import {
  createGcalEvent,
  deleteGcalEvent,
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
  onClose,
}: {
  event: CalEvent;
  gcalConnected: boolean;
  onClose: () => void;
}) {
  const { settings, addEvents, setWalkToStation } = useStore();
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
    for (const b of blocks) {
      let gcalId: string | undefined;
      if (gcalConnected && writeGcal) {
        gcalId =
          (await createGcalEvent({
            title: `🌼 ${b.label} — ${event.title}`,
            startAt: b.startAt,
            endAt: b.endAt,
          })) ?? undefined;
        if (!gcalId) anyGcalFail = true;
      }
      toStore.push({
        title: b.label,
        startAt: b.startAt,
        endAt: b.endAt,
        kind: b.kind as CalEvent["kind"],
        chainOf: event.id,
        gcalId,
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
      <p className="muted small">
        Số phút di chuyển đang nhập tay — Google Maps Routes sẽ điền tự động (chọn “giờ đến” có
        với phương tiện công cộng, PRD §5.4.1).
      </p>
    </div>
  );
}

export default function CalendarPage() {
  const mounted = useMounted();
  const { events, pendingBlock, setPendingBlock, addEvent, removeChain } = useStore();
  const [chainFor, setChainFor] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");

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

  // Cửa sổ 7 ngày, tính một lần cho ổn định.
  const [range] = useState(() => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return { from, to: from + 7 * 86_400_000 };
  });
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
  const allEvents = useMemo(() => [...events, ...googleAsCal], [events, googleAsCal]);

  const upcoming = useMemo(() => {
    if (!now) return [];
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return allEvents
      .filter((e) => new Date(e.endAt).getTime() >= from)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [allEvents, now]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of upcoming) {
      const k = fmtDay(e.startAt);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [upcoming]);

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
    await Promise.allSettled(withGcal.map((b) => deleteGcalEvent(b.gcalId!)));
    removeChain(ev.id);
    void gcal.reload();
  }

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Lịch</h1>
        {!mounted || gs.loading ? (
          <span className="muted small">…</span>
        ) : gs.connected ? (
          <span className="muted small">
            GCal · {gs.email ?? "đã nối"}{" "}
            <button className="btn ghost small" onClick={() => void gs.disconnect()}>
              Ngắt
            </button>
          </span>
        ) : gs.configured ? (
          <a className="btn small" href="/api/google/auth" style={{ textDecoration: "none" }}>
            🔗 Nối Google Calendar
          </a>
        ) : (
          <span className="muted small">local — chưa cấu hình Google</span>
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

      {mounted && pendingBlock && (
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
          onClose={() => setChainFor(null)}
        />
      )}

      {mounted && byDay.length === 0 && !pendingBlock && (
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
          {evs.map((e) => {
            const hasChain = events.some((x) => x.chainOf === e.id);
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
                  </span>
                  {e.kind === "event" &&
                    (hasChain ? (
                      <button
                        className="btn ghost small"
                        onClick={() => void removeChainEverywhere(e)}
                      >
                        Gỡ chuỗi
                      </button>
                    ) : (
                      <button className="btn small" onClick={() => setChainFor(e.id)}>
                        + Chuỗi
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

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
              addEvent({
                title: title.trim(),
                startAt: start.toISOString(),
                endAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
                kind: "event",
              });
              setTitle("");
              setWhen("");
            }}
          >
            Thêm (60 phút)
          </button>
        </div>
      </div>
    </main>
  );
}
