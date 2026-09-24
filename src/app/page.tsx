"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { EventDetail } from "@/components/EventDetail";
import { LeaveCheck } from "@/components/LeaveCheck";
import { TaskDetail } from "@/components/TaskDetail";
import { TaskRow } from "@/components/TaskRow";
import { Blossom } from "@/components/Blossom";
import { composeBrief } from "@/core/brief";
import { activeProjects, projectById } from "@/core/projects";
import { gcalToCal, remoteMetaOf } from "@/lib/calendarActions";
import { fmtDay, fmtRange, fmtRelativeDay, fmtTime, isSameDay, todayLabel } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useDeviceLocation } from "@/lib/location";
import { useStore } from "@/lib/store";
import { useGoogleEvents, useGoogleStatus } from "@/lib/useGoogle";

export default function TodayPage() {
  const mounted = useMounted();
  const { tasks, projects, events, eventMarks, settings } = useStore();
  /** Link "Mở trong Lowtechie" đính trong sự kiện book từ việc (§5.2.2 v3.7). */
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (id) {
      setOpenTask(id);
      window.history.replaceState({}, "", "/");
    }
  }, []);
  const addEvent = useStore((s) => s.addEvent);
  const [suggestionGone, setSuggestionGone] = useState(false);
  const [held, setHeld] = useState(false);

  // Lịch Google hôm nay (nếu đã nối) hòa vào brief — vẫn chỉ đọc, không ghi.
  const gs = useGoogleStatus();
  const [range] = useState(() => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    // 8 ngày: lịch hôm nay + lịch tuần này chưa đặt chỗ (brief §5.4.2 v3.7).
    return { from, to: from + 8 * 86_400_000 };
  });
  const gcal = useGoogleEvents(range.from, range.to, mounted && gs.connected);
  const allEvents = useMemo(() => {
    const localIds = new Set(events.map((e) => e.gcalId).filter(Boolean));
    return [
      ...events,
      ...gcal.events
        .filter((g) => !localIds.has(g.gcalId))
        .map((g) => gcalToCal(g, eventMarks[`g:${g.gcalId}`]?.booking)),
    ];
  }, [events, gcal.events, eventMarks]);

  // Mức "khi app mở" (§5.4.3): theo dõi nhẹ để xác nhận đã đến nơi hẹn.
  useDeviceLocation(mounted && settings.locationMode === "light");
  /** Lịch có địa điểm trong 3 giờ tới → kiểm tra lại giờ đi (§5.4.3 v3.7). */
  const nextOut = useMemo(() => {
    if (!mounted) return undefined;
    const now = Date.now();
    return allEvents
      .filter(
        (e) =>
          e.kind === "event" &&
          e.location &&
          Date.parse(e.startAt) > now - 5 * 60_000 &&
          Date.parse(e.startAt) < now + 3 * 3_600_000,
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  }, [mounted, allEvents]);

  const brief = useMemo(
    () => (mounted ? composeBrief(tasks, activeProjects(projects), allEvents, new Date()) : null),
    [mounted, tasks, projects, allEvents],
  );

  const hasAnything = tasks.length > 0 || events.length > 0;

  return (
    <main className="screen-body">
      <div className="hdr">
        <div>
          <div className="muted small">{mounted ? todayLabel() : "…"}</div>
          <h1>{brief?.greeting ?? "Chào Mai"}</h1>
        </div>
        <Link href="/review" className="small muted" style={{ whiteSpace: "nowrap" }}>
          Review tuần →
        </Link>
      </div>

      {brief?.suggestion && !suggestionGone && (
        <Bubble>
          {held ? (
            <>Đã giữ chỗ rồi nhé. Mình để block này trong Lịch, Mai đổi lúc nào cũng được.</>
          ) : (
            <>
              {brief.suggestion.text}
              <div className="act">
                <button
                  className="btn primary"
                  onClick={() => {
                    addEvent({
                      title: brief.suggestion!.block.title,
                      startAt: brief.suggestion!.block.startAt,
                      endAt: brief.suggestion!.block.endAt,
                      projectId: brief.suggestion!.block.projectId,
                      kind: "block",
                    });
                    setHeld(true);
                  }}
                >
                  Giữ chỗ
                </button>
                <button className="btn ghost" onClick={() => setSuggestionGone(true)}>
                  Để sau
                </button>
              </div>
            </>
          )}
        </Bubble>
      )}

      {nextOut && gs.maps && settings.locationMode !== "off" && (
        <LeaveCheck
          event={nextOut}
          auto={settings.locationMode === "light" && Date.parse(nextOut.startAt) - Date.now() < 90 * 60_000}
        />
      )}

      {/* §5.4.2 v3.7: lịch tuần này chưa đặt chỗ — dấu riêng trong brief sáng. */}
      {brief && brief.unbooked.length > 0 && (
        <Link href="/lich" className="note-box small" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          🔖 <b>{brief.unbooked.length} lịch tuần này chưa đặt chỗ</b>:{" "}
          {brief.unbooked
            .slice(0, 3)
            .map((e) => `${e.title} (${fmtDay(e.startAt)} ${fmtTime(e.startAt)})`)
            .join(" · ")}
          {brief.unbooked.length > 3 ? "…" : ""}
        </Link>
      )}

      {mounted && !hasAnything && (
        <div className="empty card">
          <Blossom size={64} />
          <p>
            Mình là Lowtechie. Giữ <b>bông mai</b> bên dưới và nói một câu — ví dụ{" "}
            <i>&ldquo;Thứ Ba nhắc chị gửi báo giá cho OKR, dự án Circle&rdquo;</i> — mình sẽ tách
            thành việc, gắn dự án và hạn cho Mai duyệt.
          </p>
        </div>
      )}

      {brief && brief.top.length > 0 && (
        <>
          <div className="group-title">Ưu tiên hôm nay</div>
          {brief.top.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </>
      )}

      {brief && brief.waiting.length > 0 && (
        <>
          <div className="group-title">Đang chờ người khác</div>
          {brief.waiting.map((t) => {
            const p = projectById(projects, t.projectId);
            const overdueDays = t.dueAt
              ? Math.floor((Date.now() - new Date(t.dueAt).getTime()) / 86_400_000)
              : 0;
            return (
              <div className="row" key={t.id}>
                <span className="dot" style={{ background: p.color }} />
                <span className="t">
                  <b>
                    {t.waitingOn?.person}: {t.title}
                  </b>
                  <span className="small muted">
                    {overdueDays > 0 ? `quá hạn ${overdueDays} ngày` : "đang chờ"}
                  </span>
                </span>
              </div>
            );
          })}
        </>
      )}

      {brief && brief.todayEvents.length > 0 && (
        <>
          <div className="group-title">Lịch hôm nay</div>
          {brief.todayEvents.map((e) => (
            <div
              className={`block-line${e.kind !== "event" ? " faded" : ""}`}
              key={e.id}
              role="button"
              tabIndex={0}
              aria-label={`Mở sự kiện: ${e.title}`}
              style={{ cursor: "pointer" }}
              onClick={() => setOpenEvent(e.id)}
            >
              <span className="time">{fmtRange(e.startAt, e.endAt)}</span>
              <span style={{ minWidth: 0 }}>
                {e.title}
                {e.location ? <span className="muted small"> · {e.location}</span> : null}
              </span>
            </div>
          ))}
        </>
      )}

      {/* §5.3.3 v2.8: danh sách ĐẦY ĐỦ, tiêu đề có số đếm, nhóm theo ngày;
          dài quá thì thu gọn phần sau bằng "Xem tất cả" — không âm thầm cắt. */}
      {brief &&
        brief.deadlines7d.length > 0 &&
        (() => {
          const sorted = [...brief.deadlines7d].sort(
            (a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime(),
          );
          const groups: (typeof sorted)[] = [];
          for (const t of sorted) {
            const last = groups[groups.length - 1];
            if (last && isSameDay(last[0].dueAt!, new Date(t.dueAt!))) last.push(t);
            else groups.push([t]);
          }
          const head: (typeof sorted)[] = [];
          const rest: (typeof sorted)[] = [];
          let shown = 0;
          for (const g of groups) {
            if (shown < 8) {
              head.push(g);
              shown += g.length;
            } else rest.push(g);
          }
          const dayLabel = (iso: string) => {
            const s = fmtRelativeDay(iso);
            return s.charAt(0).toUpperCase() + s.slice(1);
          };
          const renderGroup = (g: typeof sorted) => (
            <div key={g[0].id}>
              <div className="small muted" style={{ fontWeight: 700, marginTop: 4 }}>
                {dayLabel(g[0].dueAt!)} ({g.length})
              </div>
              {g.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          );
          return (
            <>
              <div className="group-title">Deadline 7 ngày tới ({brief.deadlines7d.length})</div>
              {head.map(renderGroup)}
              {rest.length > 0 && (
                <details>
                  <summary className="small muted" style={{ cursor: "pointer" }}>
                    Xem tất cả ({brief.deadlines7d.length})
                  </summary>
                  {rest.map(renderGroup)}
                </details>
              )}
            </>
          );
        })()}

      {mounted &&
        (() => {
          const doneTasks = tasks
            .filter((t) => t.status === "done")
            .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
          return doneTasks.length > 0 ? (
            <details style={{ marginTop: 8 }}>
              <summary className="group-title" style={{ cursor: "pointer" }}>
                Đã xong ({doneTasks.length})
              </summary>
              {doneTasks.slice(0, 10).map((t) => (
                <TaskRow key={t.id} task={t} showDue={false} />
              ))}
            </details>
          ) : null;
        })()}

      {openTask && tasks.some((t) => t.id === openTask) && (
        <TaskDetail taskId={openTask} onClose={() => setOpenTask(null)} />
      )}
      {openEvent &&
        (() => {
          const ev = allEvents.find((x) => x.id === openEvent);
          const g = gcal.events.find((x) => `g:${x.gcalId}` === openEvent);
          return ev ? (
            <EventDetail
              event={ev}
              remote={g ? remoteMetaOf(g) : undefined}
              context={allEvents}
              onClose={() => setOpenEvent(null)}
              onChanged={() => void gcal.reload()}
            />
          ) : null;
        })()}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Link href="/chuyen-di" className="btn" style={{ textDecoration: "none" }}>
          ✈️ Chuyến đi
        </Link>
        <Link href="/review" className="btn" style={{ textDecoration: "none" }}>
          📊 Review tuần
        </Link>
      </div>
    </main>
  );
}
