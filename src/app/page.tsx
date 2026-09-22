"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { TaskRow } from "@/components/TaskRow";
import { Blossom } from "@/components/Blossom";
import { composeBrief } from "@/core/brief";
import { activeProjects, projectById } from "@/core/projects";
import { fmtRange, fmtRelativeDay, todayLabel } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { useGoogleEvents, useGoogleStatus } from "@/lib/useGoogle";
import type { CalEvent } from "@/core/types";

export default function TodayPage() {
  const mounted = useMounted();
  const { tasks, projects, events } = useStore();
  const addEvent = useStore((s) => s.addEvent);
  const [suggestionGone, setSuggestionGone] = useState(false);
  const [held, setHeld] = useState(false);

  // Lịch Google hôm nay (nếu đã nối) hòa vào brief — vẫn chỉ đọc, không ghi.
  const gs = useGoogleStatus();
  const [range] = useState(() => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return { from, to: from + 86_400_000 };
  });
  const gcal = useGoogleEvents(range.from, range.to, mounted && gs.connected);
  const allEvents = useMemo(() => {
    const localIds = new Set(events.map((e) => e.gcalId).filter(Boolean));
    return [
      ...events,
      ...gcal.events
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
    ];
  }, [events, gcal.events]);

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
            <div className={`block-line${e.kind !== "event" ? " faded" : ""}`} key={e.id}>
              <span className="time">{fmtRange(e.startAt, e.endAt)}</span>
              <span style={{ minWidth: 0 }}>
                {e.title}
                {e.location ? <span className="muted small"> · {e.location}</span> : null}
              </span>
            </div>
          ))}
        </>
      )}

      {brief && brief.deadlines7d.length > 0 && (
        <>
          <div className="group-title">Deadline 7 ngày tới</div>
          {brief.deadlines7d.slice(0, 5).map((t) => (
            <div className="row" key={t.id}>
              <span
                className="dot"
                style={{ background: projectById(projects, t.projectId).color }}
              />
              <span className="t">
                <b>{t.title}</b>
                <span className="small muted">{t.dueAt ? fmtRelativeDay(t.dueAt) : ""}</span>
              </span>
            </div>
          ))}
        </>
      )}

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
