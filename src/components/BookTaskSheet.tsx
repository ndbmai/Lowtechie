"use client";

import { useEffect, useMemo, useState } from "react";
import { deadlineEnd, proposeTaskSlots } from "@/core/slots";
import type { CalEvent, Task } from "@/core/types";
import { fmtDay, fmtDayFull, fmtDue, fmtRange, isSameDay } from "@/lib/format";
import { useStore } from "@/lib/store";
import {
  createGcalEvent,
  deleteGcalEvent,
  useAccounts,
  useGoogleEvents,
  useGoogleStatus,
} from "@/lib/useGoogle";

const APP_ONLY = "app";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "YYYY-MM-DD" + "HH:mm" → mốc giờ THIẾT BỊ (không gắn Z). */
function localMs(date: string, time: string): number {
  return new Date(`${date}T${time}`).getTime();
}

/**
 * Book lịch từ một việc — bản GỌN (Mai 25/9: "chỉ cần chọn calendar và
 * timeslot từ mấy giờ đến mấy giờ"): Lịch · Ngày · Từ · Đến · Book. Giờ điền
 * sẵn khung trống đầu tiên trước hạn (bận ở MỌI lịch đều tính), Mai sửa
 * thoải mái; trùng lịch chỉ nhắc một dòng. Sự kiện lấy tên việc, gắn dự án ·
 * category · khách và link về việc; có Hoàn tác.
 */
export function BookTaskSheet({
  task,
  onClose,
  onBooked,
  initialDuration,
  onDay,
  z = 75,
}: {
  task: Task;
  onClose: () => void;
  onBooked?: (line: string) => void;
  initialDuration?: number;
  /** "thứ Năm" từ chat/voice → điền sẵn ngày đó (ISO). */
  onDay?: string;
  z?: number;
}) {
  const { events, trips, settings, addEvent, removeEvent } = useStore();
  const gs = useGoogleStatus();
  const accts = useAccounts();
  const calAccounts = accts.accounts.filter((a) => a.parts.cal);
  const [now] = useState(() => new Date());
  const dur = initialDuration ?? task.estMinutes ?? 60;
  const horizon = Math.max(
    task.dueAt ? deadlineEnd(task.dueAt) : 0,
    onDay ? Date.parse(onDay) + 86_400_000 : 0,
    now.getTime() + 7 * 86_400_000,
  );
  const gcal = useGoogleEvents(now.getTime(), horizon, gs.connected || calAccounts.length > 0);

  const busy = useMemo(() => {
    const localIds = new Set(events.map((e) => e.gcalId).filter(Boolean));
    return [
      ...events.filter((e) => e.kind === "event" || e.kind === "block" || e.kind === "flight"),
      ...gcal.events
        .filter((g) => !g.allDay && !localIds.has(g.gcalId))
        .map((g): CalEvent => ({ id: `g:${g.gcalId}`, title: g.title, startAt: g.startAt, endAt: g.endAt, kind: "event" })),
    ];
  }, [events, gcal.events]);

  // Điền sẵn khung trống đầu tiên; lịch Google/Lark về sau thì điền lại — cho tới khi Mai tự sửa.
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    const first = proposeTaskSlots(busy, now, dur, { deadline: task.dueAt, onDay }).slots[0];
    let start: Date;
    if (first) start = new Date(first.startAt);
    else {
      start = new Date(now);
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      if (start.getHours() >= 21 || start.getHours() < 8) {
        start.setDate(start.getDate() + (start.getHours() >= 21 ? 1 : 0));
        start.setHours(9, 0, 0, 0);
      }
    }
    const end = new Date(start.getTime() + dur * 60_000);
    setDate(toDateInput(start));
    setFrom(toTimeInput(start));
    setTo(toTimeInput(end));
  }, [busy, now, dur, task.dueAt, onDay, touched]);

  const defaultAcct = (() => {
    const byProject = settings.projectCalendar[task.projectId];
    if (byProject && calAccounts.some((c) => c.id === byProject)) return byProject;
    return calAccounts[0]?.id ?? APP_ONLY;
  })();
  const [acctPick, setAcctPick] = useState<string | null>(null);
  const acct = acctPick ?? defaultAcct;
  const targetAcct = calAccounts.find((c) => c.id === acct);

  const startMs = date && from ? localMs(date, from) : NaN;
  const endMs = date && to ? localMs(date, to) : NaN;
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const clash = valid
    ? busy.find((e) => Date.parse(e.startAt) < endMs && Date.parse(e.endAt) > startMs)
    : undefined;
  const flightDay =
    valid &&
    trips.some(
      (t) =>
        isSameDay(t.departAt, new Date(startMs)) || (t.returnAt ? isSameDay(t.returnAt, new Date(startMs)) : false),
    );

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ localId: string; gcalId?: string; account?: string; line: string } | null>(null);

  async function confirm() {
    if (!valid) return;
    setSaving(true);
    const startAt = new Date(startMs).toISOString();
    const endAt = new Date(endMs).toISOString();
    let gcalId: string | undefined;
    let account: string | undefined;
    let remoteFail = false;
    if (targetAcct) {
      const created = await createGcalEvent(
        {
          title: task.title,
          startAt,
          endAt,
          description: `Việc: ${task.title}\nMở trong Lowtechie: ${window.location.origin}/?task=${task.id}`,
        },
        targetAcct.id,
      );
      gcalId = created?.gcalId;
      account = created?.accountId;
      remoteFail = !created;
    }
    const ev = addEvent({
      title: task.title,
      startAt,
      endAt,
      kind: "block",
      projectId: task.projectId,
      categoryId: task.categoryId,
      clientId: task.clientId,
      taskId: task.id,
      gcalId,
      calAccount: account,
    });
    setSaving(false);
    const line = `📅 Đã book “${task.title}” ${fmtDay(startAt)} ${fmtRange(startAt, endAt)}${
      gcalId
        ? ` lên ${targetAcct?.provider === "lark" ? "Lark" : "Google"}`
        : remoteFail
          ? " — lịch ngoài lỗi, mới lưu trong app"
          : " trong app"
    }.`;
    setDone({ localId: ev.id, gcalId, account, line });
    onBooked?.(line);
  }

  async function undo() {
    if (!done) return;
    if (done.gcalId) await deleteGcalEvent(done.gcalId, done.account);
    removeEvent(done.localId);
    setDone(null);
    onBooked?.(`Đã gỡ lịch vừa book cho “${task.title}”.`);
  }

  const inputStyle = { padding: "8px 10px", borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--surface-2)", minWidth: 0 } as const;

  return (
    <div
      role="dialog"
      aria-label={`Book lịch cho việc: ${task.title}`}
      style={{ position: "fixed", inset: 0, background: "rgba(30,33,80,.45)", zIndex: z, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flex: 1 }}>
            <b style={{ fontSize: 16 }}>📅 Book lịch: {task.title}</b>
            <span className="small muted" style={{ display: "block" }}>
              {task.dueAt ? `Hạn ${fmtDue(task.dueAt)}` : "Không có hạn"}
            </span>
          </span>
          <button className="btn ghost small" aria-label="Đóng book lịch" onClick={onClose}>
            ✕
          </button>
        </div>

        {done ? (
          <>
            <div className="note-box small" role="status">
              {done.line}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" onClick={onClose}>
                Xong
              </button>
              <button className="btn ghost small" onClick={() => void undo()}>
                Hoàn tác book
              </button>
            </div>
          </>
        ) : (
          <>
            <select
              className="btn"
              aria-label="Lịch"
              value={acct}
              onChange={(e) => setAcctPick(e.target.value)}
              style={{ textAlign: "left" }}
            >
              {calAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider === "lark" ? "Lark" : "Google"} · {c.email ?? c.id}
                </option>
              ))}
              <option value={APP_ONLY}>Chỉ lưu trong app</option>
            </select>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="date"
                aria-label="Ngày"
                value={date}
                onChange={(e) => {
                  setTouched(true);
                  setDate(e.target.value);
                }}
                style={{ ...inputStyle, flex: "1 1 140px" }}
              />
              <input
                type="time"
                aria-label="Từ"
                value={from}
                onChange={(e) => {
                  setTouched(true);
                  const next = e.target.value;
                  // Giữ nguyên độ dài khi đổi giờ bắt đầu.
                  if (date && from && to && next) {
                    const len = localMs(date, to) - localMs(date, from);
                    const end = new Date(localMs(date, next) + Math.max(len, 15 * 60_000));
                    if (toDateInput(end) === date) setTo(toTimeInput(end));
                  }
                  setFrom(next);
                }}
                style={{ ...inputStyle, flex: "1 1 90px" }}
              />
              <span className="muted">–</span>
              <input
                type="time"
                aria-label="Đến"
                value={to}
                onChange={(e) => {
                  setTouched(true);
                  setTo(e.target.value);
                }}
                style={{ ...inputStyle, flex: "1 1 90px" }}
              />
            </div>
            {date && from && to && !valid && <div className="warn small">Giờ kết thúc phải sau giờ bắt đầu.</div>}
            {clash && (
              <div className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "4px 10px" }}>
                ⚠ Trùng “{clash.title}” ({fmtRange(clash.startAt, clash.endAt)})
              </div>
            )}
            {flightDay && (
              <div className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "4px 10px" }}>
                ⚠ Rơi vào ngày bay
              </div>
            )}
            {valid && (
              <span className="small muted">
                {fmtDayFull(new Date(startMs).toISOString())} · {Math.round((endMs - startMs) / 60_000)} phút
              </span>
            )}
            <button className="btn primary" disabled={!valid || saving} onClick={() => void confirm()}>
              {saving ? "Đang book…" : "Book"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
