"use client";

import { useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import {
  DESTINATION_LABELS,
  groupsFor,
  type ChecklistTab,
} from "@/core/checklist";
import { flightChain } from "@/core/timeback";
import type { Destination, Trip } from "@/core/types";
import { fmtDay, fmtDayTime, fmtRange, fmtTime } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import {
  fetchFlightTrips,
  useGoogleStatus,
  type FlightTripCandidate,
} from "@/lib/useGoogle";

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
            departAt: d.toISOString(),
          });
          onDone();
        }}
      >
        Tạo chuyến + checklist
      </button>
    </div>
  );
}

/**
 * Quét Gmail tìm vé máy bay → chuyến ứng viên, Mai duyệt mới tạo (PRD §5.9).
 * Thẻ xác nhận luôn hiện dòng mốc "Hôm nay" + các chặng bị bỏ qua, và
 * chuyến trùng PNR thành "Cập nhật" thay vì tạo bản sao.
 */
function GmailScan() {
  const gs = useGoogleStatus();
  const { trips, addTrip, updateTrip } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FlightTripCandidate[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [today, setToday] = useState("");

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
    setMsg(null);
    setSkipped([]);
    const r = await fetchFlightTrips();
    setBusy(false);
    if (!r.ok) {
      setMsg(
        r.reason === "no-key"
          ? "Trích vé cần ANTHROPIC_API_KEY trên server."
          : r.reason === "no-gmail-scope"
            ? "Chưa có quyền Gmail — bấm nối lại Google nhé."
            : `Quét không thành công${r.detail ? ` (${r.detail})` : ""}.`,
      );
      return;
    }
    setCandidates(r.trips);
    setSkipped(r.skipped);
    setToday(r.todayLocal);
    setMsg(
      r.trips.length === 0
        ? `Mình đọc ${r.scanned} email gần đây mà không thấy chuyến bay SẮP TỚI nào.`
        : `Tìm thấy ${r.trips.length} chuyến sắp tới trong ${r.scanned} email — Mai duyệt thì mình mới tạo:`,
    );
  }

  return (
    <>
      <button className="btn" disabled={busy} onClick={() => void scan()}>
        {busy ? "Đang đọc email…" : "📧 Quét vé máy bay trong Gmail"}
      </button>
      {today && (
        <div className="note-box small">
          🕐 Hôm nay: <b>{today}</b> (giờ nơi Mai đang ở)
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      {candidates.map((c, i) => {
        const existing = c.pnr ? trips.find((t) => t.pnr && t.pnr === c.pnr) : undefined;
        return (
          <div className="card" key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="t small">
              <b>
                ✈️ {c.destination === "other" ? (c.destinationName ?? "Nơi khác") : DESTINATION_LABELS[c.destination]}
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
            ) : existing ? (
              <button
                className="btn small"
                onClick={() => {
                  updateTrip(existing.id, {
                    departAt: new Date(c.departAt).toISOString(),
                    returnAt: c.returnAt,
                    pnr: c.pnr,
                    route: c.route,
                    airportBufferMin: c.airportBufferMin,
                  });
                  setCandidates((s) => s.filter((_, j) => j !== i));
                  setMsg(`Đã cập nhật giờ cho chuyến ${existing.label} (cùng PNR, không tạo bản sao).`);
                }}
              >
                Cập nhật giờ
              </button>
            ) : (
              <button
                className="btn primary small"
                onClick={() => {
                  const d = new Date(c.departAt);
                  addTrip({
                    destination: c.destination as Destination,
                    label: `${DESTINATION_LABELS[c.destination as Destination]} · ${d.getDate()}/${d.getMonth() + 1}`,
                    departAt: d.toISOString(),
                    returnAt: c.returnAt,
                    pnr: c.pnr,
                    route: c.route,
                    airportBufferMin: c.airportBufferMin,
                  });
                  setCandidates((s) => s.filter((_, j) => j !== i));
                }}
              >
                Tạo chuyến
              </button>
            )}
          </div>
        );
      })}
      {skipped.length > 0 && (
        <p className="muted small">
          Lịch sử (đã bay / đã hủy / lịch cũ): {skipped.slice(0, 6).join(" · ")}
        </p>
      )}
    </>
  );
}

function FlightDayChain({ trip }: { trip: Trip }) {
  const addEvents = useStore((s) => s.addEvents);
  const events = useStore((s) => s.events);
  const [travelMin, setTravelMin] = useState(45);
  const locked = events.some((e) => e.chainOf === trip.id);

  const chain = flightChain({
    departureAt: trip.departAt,
    international: true,
    prepMinutes: 90,
    travelMin,
    // Vé ghi "có mặt trước X phút" → dùng đúng quy định đó thay mặc định.
    buffers: trip.airportBufferMin ? { airportIntl: trip.airportBufferMin } : undefined,
  });

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>Chuỗi ngày bay — {fmtDay(trip.departAt)}</b>
      {chain.blocks.map((b) => (
        <div className="block-line faded" key={b.kind}>
          <span className="time">{fmtRange(b.startAt, b.endAt)}</span>
          <span>{b.label}</span>
        </div>
      ))}
      <div className="block-line">
        <span className="time">{fmtTime(trip.departAt)}</span>
        {/* Nhãn hướng bay từ vé ("SGN (nhà ga 2) → BKK") — 6b, tránh nhầm chiều. */}
        <span>✈️ Cất cánh {trip.route ?? DESTINATION_LABELS[trip.destination]}</span>
      </div>
      <div className="muted small">
        Bắt đầu chuẩn bị <b>{fmtTime(chain.prepStartAt)}</b> · rời nhà{" "}
        <b>{fmtTime(chain.leaveAt)}</b> · {chain.reminders[0]}
      </div>
      <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>Di chuyển ra sân bay</span>
        <input
          type="number"
          min={10}
          max={240}
          value={travelMin}
          onChange={(e) => setTravelMin(Math.max(10, Number(e.target.value) || 45))}
          style={{ width: 64, padding: "6px 8px", borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
        />
        <span className="muted">phút</span>
      </label>
      <button
        className={`btn ${locked ? "done" : "primary"}`}
        disabled={locked}
        onClick={() =>
          addEvents(
            chain.blocks.map((b) => ({
              title:
                b.kind === "flight"
                  ? `✈️ Bay ${trip.route ?? DESTINATION_LABELS[trip.destination]}`
                  : b.label,
              startAt: b.startAt,
              endAt: b.endAt,
              kind: b.kind === "prep" ? "prep" : b.kind === "travel" ? "travel" : b.kind,
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

/** Chuyến coi là xong sau (giờ về ?? giờ đi) + 24h → chỉ còn ở Lịch sử (6b). */
function isPastTrip(t: Trip, nowMs: number): boolean {
  return Date.parse(t.returnAt ?? t.departAt) + 24 * 60 * 60_000 < nowMs;
}

export default function TripsPage() {
  const mounted = useMounted();
  const { trips, toggleTripItem, addCustomItem, removeTripItem, newRound } = useStore();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<ChecklistTab>("pack");
  const [tripId, setTripId] = useState<string | null>(null);
  const [addText, setAddText] = useState<Record<string, string>>({});

  // Chỉ chạy sau mounted (client) nên Date.now() không lệch hydration.
  const nowMs = Date.now();
  const upcoming = trips.filter((t) => !isPastTrip(t, nowMs));
  const past = trips.filter((t) => isPastTrip(t, nowMs));

  // Mặc định mở chuyến SẮP TỚI gần nhất; chuyến đã bay chỉ khi Mai tự chọn.
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

  if (!mounted) {
    return (
      <main className="screen-body">
        <div className="hdr">
          <h1>Chuyến đi</h1>
        </div>
      </main>
    );
  }

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

      {!trip && !creating && (
        <>
          <Bubble>
            Chưa có chuyến nào. Quét Gmail phía trên, hoặc tạo tay một chuyến — mình dựng sẵn
            checklist theo điểm đến: Tokyo có Visit Japan Web và Suica, về Bangkok có TDAC, HCMC
            có tiền đồng.
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
            // 6b: chuyến đã bay không bao giờ được vẽ chuỗi ngày bay nữa
            // (lỗi OADC5J: chuỗi 7/9 vẫn hiện sau khi đã bay).
            <div className="note-box small">
              ✈️ Chuyến này đã bay ({fmtDay(trip.departAt)}) — nằm trong Lịch sử nên mình không
              vẽ chuỗi ngày bay nữa. Vé sắp tới cứ quét Gmail phía trên là ra.
            </div>
          ) : (
            <FlightDayChain trip={trip} />
          )}

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

          {past.length > 0 && (
            <section className="card">
              <div className="hdr">
                <h3 style={{ fontSize: 18 }}>Lịch sử</h3>
                <span className="muted small">{past.length} chuyến đã bay</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {past.map((t) => (
                  <button
                    key={t.id}
                    className="btn small"
                    style={
                      t.id === trip.id
                        ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }
                        : { opacity: 0.65 }
                    }
                    onClick={() => setTripId(t.id)}
                  >
                    ✈️ {t.label} · {fmtDay(t.departAt)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
