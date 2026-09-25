"use client";

import { useMemo } from "react";
import { Bubble } from "@/components/Bubble";
import { chronicallyDeferred, weekStats, weekSummary } from "@/core/stats";
import { activeProjects, projectById } from "@/core/projects";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Weekly review (PRD §5.10 v2.8): việc xong và việc trễ THEO SỐ ĐẾM —
 * không so số giờ vì Mai không bấm giờ; dự án còn việc mà cả tuần không
 * tiến triển được gọi tên riêng.
 */
export default function ReviewPage() {
  const mounted = useMounted();
  const { tasks, projects, dropTask, deferTask, delegateTask } = useStore();

  const now = mounted ? new Date() : null;
  const stats = useMemo(
    () =>
      now
        ? weekStats(tasks, activeProjects(projects), now).filter(
            (s) => s.doneCount > 0 || s.openCount > 0,
          )
        : [],
    [now, tasks, projects],
  );
  const idle = stats.filter((s) => s.openCount > 0 && !s.progressed);
  const summary = now ? weekSummary(tasks, now) : { done: 0, deferred: 0 };
  const stuck = chronicallyDeferred(tasks);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>{now ? `Tuần ${isoWeek(now)}` : "Review tuần"}</h1>
        <span className="muted small">
          {summary.done} xong · {summary.deferred} dời
        </span>
      </div>

      {stats.map((s) => (
        <div className="row" key={s.project.id}>
          <span className="dot" style={{ background: s.project.color }} />
          <span className="t">
            <b>{s.project.name}</b>
            <span className="small muted">
              {s.doneCount} xong tuần này
              {s.lateCount > 0 && (
                <span style={{ color: "var(--rose, #FF8FA3)", fontWeight: 600 }}>
                  {" "}
                  · {s.lateCount} đang trễ hạn
                </span>
              )}
              {s.openCount > 0 && <> · {s.openCount} còn mở</>}
            </span>
          </span>
        </div>
      ))}

      {idle.length > 0 && (
        <div className="warn">
          {idle.map((s) => s.project.name).join(", ")} tuần này chưa xong việc nào dù còn việc
          đang mở.
        </div>
      )}

      {stuck.length > 0 ? (
        <>
          <Bubble>
            Nói thẳng nhé: {stuck.length} việc dưới đây đã dời từ 3 lần trở lên. Bỏ hoặc giao đi
            thì tuần sau nhẹ đầu hơn hẳn.
          </Bubble>
          {stuck.map((t) => (
            <div className="row" key={t.id}>
              <span
                className="dot"
                style={{ background: projectById(projects, t.projectId).color }}
              />
              <span className="t">
                <b>{t.title}</b>
                <span className="small muted">đã dời {t.deferCount} lần</span>
              </span>
              <button className="btn" onClick={() => dropTask(t.id)}>
                Bỏ
              </button>
              <button
                className="btn"
                onClick={() => {
                  const person = window.prompt("Giao cho ai?");
                  if (person?.trim()) delegateTask(t.id, person.trim());
                }}
              >
                Giao
              </button>
              <button className="btn" onClick={() => deferTask(t.id)}>
                Hoãn
              </button>
            </div>
          ))}
        </>
      ) : (
        mounted && (
          <Bubble>
            Không có việc nào bị dời quá 3 lần — tuần này Mai giữ lời với chính mình rồi đó. 🌼
          </Bubble>
        )
      )}
    </main>
  );
}
