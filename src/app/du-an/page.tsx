"use client";

import { useMemo } from "react";
import { mostStarved, weekStats } from "@/core/stats";
import { rankTasks } from "@/core/priority";
import { TaskRow } from "@/components/TaskRow";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

function Ring({ ratio, color }: { ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <svg viewBox="0 0 36 36" width={46} height={46} aria-hidden="true">
      <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={`${pct} 100`}
        pathLength={100}
        transform="rotate(-90 18 18)"
        strokeLinecap={pct > 0 && pct < 100 ? "round" : undefined}
      />
    </svg>
  );
}

export default function ProjectsPage() {
  const mounted = useMounted();
  const { tasks, projects } = useStore();

  const stats = useMemo(
    () => (mounted ? weekStats(tasks, projects, new Date()) : []),
    [mounted, tasks, projects],
  );
  const starved = mostStarved(stats);
  const weighted = stats.filter((s) => s.targetHours > 0);
  const personal = stats.filter((s) => s.targetHours === 0);
  const openTasks = mounted ? rankTasks(tasks, projects, new Date()) : [];

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Dự án</h1>
        <span className="muted small">thời gian tuần này</span>
      </div>

      <div className="pgrid">
        {weighted.map((s) => (
          <div className="proj" key={s.project.id}>
            <Ring ratio={s.ratio} color={s.project.color} />
            <b>{s.project.name}</b>
            <span className="small muted">
              {Math.round(s.doneHours * 10) / 10}h / mục tiêu {s.targetHours}h
            </span>
          </div>
        ))}
      </div>

      {starved && starved.ratio < 0.5 && (
        <div className="warn">
          {starved.project.name} mới được {Math.round(starved.doneHours * 10) / 10}h trên mục tiêu{" "}
          {starved.targetHours}h tuần này. Muốn mình giữ một block deep work cho{" "}
          {starved.project.name} không? Bấm bông mai và nói &ldquo;book 2 tiếng cho{" "}
          {starved.project.name}&rdquo; là xong.
        </div>
      )}

      {personal.length > 0 && (
        <div className="row">
          <span className="dot" style={{ background: "var(--p-me)" }} />
          <span className="t">
            <b>Cá nhân · Học tập · Admin chung</b>
            <span className="muted small">
              không tính trọng số — tiếng Thái, spa, thuế, hóa đơn nằm ở đây
            </span>
          </span>
        </div>
      )}

      {openTasks.length > 0 && (
        <>
          <div className="group-title">Việc đang mở ({openTasks.length})</div>
          {openTasks.slice(0, 12).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </>
      )}

      <p className="muted small">
        Giờ tuần này tính từ ước lượng của việc đã xong — Google Calendar (sắp có) sẽ thay bằng
        thời gian thật.
      </p>
    </main>
  );
}
