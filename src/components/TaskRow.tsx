"use client";

import { useEffect, useState } from "react";
import type { Project, Task } from "@/core/types";
import { categoryName, projectById } from "@/core/projects";
import { fmtDue } from "@/lib/format";
import { useStore } from "@/lib/store";
import { TaskDetail } from "@/components/TaskDetail";

export function ProjectChip({ project }: { project: Project }) {
  return (
    <span className="chip" style={{ background: project.color }}>
      {project.name}
    </span>
  );
}

/**
 * Một dòng việc (PRD 5.2.2 v2.6): chạm vào dòng là XEM chi tiết, không
 * đóng việc — chỉ ô tick (hoặc nút Xong trong chi tiết) mới đóng. Tick
 * xong hiện "Đã xong · Hoàn tác" vài giây để cứu tick nhầm.
 */
export function TaskRow({ task, showDue = true }: { task: Task; showDue?: boolean }) {
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const completeTask = useStore((s) => s.completeTask);
  const reopenTask = useStore((s) => s.reopenTask);
  const [open, setOpen] = useState(false);
  const [undoUntil, setUndoUntil] = useState<number | null>(null);
  const p = projectById(projects, task.projectId);
  const done = task.status === "done";

  useEffect(() => {
    if (!undoUntil) return;
    const t = setTimeout(() => setUndoUntil(null), Math.max(0, undoUntil - Date.now()));
    return () => clearTimeout(t);
  }, [undoUntil]);

  return (
    <>
      <div
        className={`row${done ? " done-row" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Xem chi tiết: ${task.title}`}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(true);
        }}
      >
        <input
          type="checkbox"
          className="check"
          checked={done}
          onClick={(e) => e.stopPropagation()}
          onChange={() => {
            if (done) {
              reopenTask(task.id);
              setUndoUntil(null);
            } else {
              completeTask(task.id, "tick");
              setUndoUntil(Date.now() + 6000);
            }
          }}
          aria-label={done ? `Mở lại: ${task.title}` : `Đánh dấu xong: ${task.title}`}
        />
        <span className="t">
          <b>{task.title}</b>
          <span className="small muted">
            <ProjectChip project={p} />
            {categoryName(categories, task.categoryId)
              ? ` ${categoryName(categories, task.categoryId)} ·`
              : ""}
            {showDue && task.dueAt && (
              <>
                {" "}
                hạn {fmtDue(task.dueAt)}
                {task.dueType === "hard" ? " · cứng" : ""}
              </>
            )}
            {(task.notes?.length ?? 0) > 0 && <> · 📝 {task.notes!.length}</>}
            {task.priority === "high" && !done && <> · ⭐</>}
          </span>
        </span>
        {done && undoUntil && (
          <button
            className="btn small"
            onClick={(e) => {
              e.stopPropagation();
              reopenTask(task.id);
              setUndoUntil(null);
            }}
          >
            Hoàn tác
          </button>
        )}
      </div>
      {open && <TaskDetail taskId={task.id} onClose={() => setOpen(false)} />}
    </>
  );
}
