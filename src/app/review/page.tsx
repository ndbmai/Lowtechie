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

export default function ReviewPage() {
  const mounted = useMounted();
  const { tasks, projects, dropTask, deferTask, delegateTask } = useStore();

  const now = mounted ? new Date() : null;
  const stats = useMemo(
    () => (now ? weekStats(tasks, activeProjects(projects), now).filter((s) => s.targetHours > 0) : []),
    [now, tasks, projects],
  );
  const summary = now ? weekSummary(tasks, now) : { done: 0, deferred: 0 };
  const stuck = chronicallyDeferred(tasks);
  const scale = Math.max(1, ...stats.map((s) => Math.max(s.doneHours, s.targetHours))) * 1.15;
  const savedHours = Math.round(stuck.reduce((h, t) => h + (t.estMinutes ?? 60), 0) / 60);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>{now ? `Tuần ${isoWeek(now)}` : "Review tuần"}</h1>
        <span className="muted small">
          {summary.done} xong · {summary.deferred} dời
        </span>
      </div>

      {stats.length > 0 && (
        <>
          <div className="bars">
            {stats.map((s) => (
              <div className="bar" key={s.project.id}>
                <span>{s.project.name}</span>
                <div className="track">
                  <span
                    style={{
                      width: `${Math.min(100, (s.doneHours / scale) * 100)}%`,
                      background: s.project.color,
                    }}
                  />
                  <em style={{ left: `${Math.min(97, (s.targetHours / scale) * 100)}%` }} />
                </div>
                <span>{Math.round(s.doneHours * 10) / 10}h</span>
              </div>
            ))}
          </div>
          <p className="muted small">Vạch đậm là mục tiêu Mai đặt (trọng số × quỹ giờ tuần).</p>
        </>
      )}

      {stuck.length > 0 ? (
        <>
          <Bubble>
            Nói thẳng nhé: {stuck.length} việc dưới đây đã dời từ 3 lần trở lên. Bỏ hoặc giao đi
            thì tuần sau nhẹ hơn khoảng {Math.max(1, savedHours)} tiếng.
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
