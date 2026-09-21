"use client";

import { useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { proposeSlots } from "@/core/slots";
import { carChain, transitChain, type Chain } from "@/core/timeback";
import type { CalEvent } from "@/core/types";
import { fmtDay, fmtRange, fmtTime } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

const PREP_PROFILES = [
  { label: "Ra ngoài đầy đủ (tắm + make up)", minutes: 90 },
  { label: "Ra ngoài nhanh", minutes: 30 },
  { label: "Họp online có quay mặt", minutes: 20 },
  { label: "Không cần chuẩn bị", minutes: 0 },
];

function ChainForm({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const { settings, addEvents, setWalkToStation } = useStore();
  const [mode, setMode] = useState<"transit" | "car">("transit");
  const [prep, setPrep] = useState(settings.defaultPrepMinutes);
  const [walkTo, setWalkTo] = useState(settings.walkToStationMin);
  const [transitMin, setTransitMin] = useState(30);
  const [walkFrom, setWalkFrom] = useState(8);
  const [driveMin, setDriveMin] = useState(30);
  const [rain, setRain] = useState(false);

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

  function lock() {
    addEvents(
      chain.blocks
        .filter((b) => b.kind === "prep" || b.kind === "travel")
        .map((b) => ({
          title: b.label,
          startAt: b.startAt,
          endAt: b.endAt,
          kind: b.kind as CalEvent["kind"],
          chainOf: event.id,
        })),
    );
    setWalkToStation(walkTo);
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

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={lock}>
          Khóa 2 block vào lịch
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>
          Thôi
        </button>
      </div>
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

  const upcoming = useMemo(() => {
    if (!now) return [];
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return events
      .filter((e) => new Date(e.endAt).getTime() >= from)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [events, now]);

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
            events.filter((e) => e.kind === "event" || e.kind === "block"),
            now,
            pendingBlock.durationMinutes,
          )
        : [],
    [now, pendingBlock, events],
  );

  const chainEvent = chainFor ? events.find((e) => e.id === chainFor) : null;

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Lịch</h1>
        <span className="muted small">local — Google Calendar sắp nối</span>
      </div>

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

      {chainEvent && <ChainForm event={chainEvent} onClose={() => setChainFor(null)} />}

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
                  <span className="time">{fmtRange(e.startAt, e.endAt)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {e.title}
                    {e.location ? <span className="muted small"> · {e.location}</span> : null}
                  </span>
                  {e.kind === "event" &&
                    (hasChain ? (
                      <button className="btn ghost small" onClick={() => removeChain(e.id)}>
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
