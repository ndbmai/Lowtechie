"use client";

import type { Project, Task } from "@/core/types";
import { categoryName, projectById } from "@/core/projects";
import { fmtRelativeDay, fmtTime } from "@/lib/format";
import { useStore } from "@/lib/store";

export function ProjectChip({ project }: { project: Project }) {
  return (
    <span className="chip" style={{ background: project.color }}>
      {project.name}
    </span>
  );
}

export function TaskRow({ task, showDue = true }: { task: Task; showDue?: boolean }) {
  const projects = useStore((s) => s.projects);
  const toggleTask = useStore((s) => s.toggleTask);
  const p = projectById(projects, task.projectId);
  const done = task.status === "done";

  return (
    <label className={`row${done ? " done-row" : ""}`}>
      <input
        type="checkbox"
        className="check"
        checked={done}
        onChange={() => toggleTask(task.id)}
        aria-label={`Đánh dấu xong: ${task.title}`}
      />
      <span className="t">
        <b>{task.title}</b>
        <span className="small muted">
          <ProjectChip project={p} />
          {categoryName(task.categoryId) ? ` ${categoryName(task.categoryId)} ·` : ""}
          {showDue && task.dueAt && (
            <>
              {" "}
              hạn {fmtRelativeDay(task.dueAt)}
              {new Date(task.dueAt).getHours() !== 9 ? ` ${fmtTime(task.dueAt)}` : ""}
              {task.dueType === "hard" ? " · cứng" : ""}
            </>
          )}
        </span>
      </span>
    </label>
  );
}
