"use client";

import { useState } from "react";
import type { Project, Task } from "@/core/types";
import { duePresets } from "@/core/due";
import { categoryName, projectById } from "@/core/projects";
import { deleteEventEverywhere } from "@/lib/calendarActions";
import type { CalEvent } from "@/core/types";
import { fmtDay, fmtDue, fmtTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { BookTaskSheet } from "@/components/BookTaskSheet";
import { EventDetail } from "@/components/EventDetail";
import { TaskDetail } from "@/components/TaskDetail";

/**
 * Đã đóng việc (tick hoặc Xong): "Đã xong · Hoàn tác" trong khay chung, và
 * nếu việc còn lịch sắp tới thì hỏi MỘT câu có xóa luôn không (§5.2.2 v3.7).
 */
export function announceDone(taskId: string, title: string, futureBlocks: CalEvent[]) {
  showToast({
    text: `Đã xong “${title}”`,
    actions: [
      {
        label: "Hoàn tác",
        run: () => {
          useStore.getState().reopenTask(taskId);
        },
      },
    ],
  });
  if (futureBlocks.length === 0) return;
  showToast({
    text: `Việc này còn lịch ${futureBlocks.map((e) => `${fmtDay(e.startAt)} ${fmtTime(e.startAt)}`).join(", ")} — xóa luôn khỏi lịch?`,
    ttlMs: 20_000,
    actions: [
      {
        label: "Xóa lịch",
        primary: true,
        run: async () => {
          for (const e of futureBlocks) await deleteEventEverywhere(e, undefined, {});
          return "Đã xóa lịch còn lại của việc.";
        },
      },
      { label: "Giữ", run: () => undefined },
    ],
  });
}

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
 * xong hiện "Đã xong · Hoàn tác" vài giây (khay chung — announceDone).
 * v3.7: nút ⋯ (Book lịch, dời hạn nhanh) và giờ đã đặt ngay trên dòng.
 */
export function TaskRow({
  task,
  showDue = true,
  trailing,
}: {
  task: Task;
  showDue?: boolean;
  /** Nút phụ cuối dòng (vd. gắn khách một chạm, v2.9) — tự chặn click lan ra dòng. */
  trailing?: React.ReactNode;
}) {
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const events = useStore((s) => s.events);
  const completeTask = useStore((s) => s.completeTask);
  const reopenTask = useStore((s) => s.reopenTask);
  const setTaskDue = useStore((s) => s.setTaskDue);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [booking, setBooking] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const p = projectById(projects, task.projectId);
  const done = task.status === "done";

  /** Lịch đã book cho việc này (§5.2.2 v3.7) — cái sắp tới gần nhất hiện trên dòng. */
  const futureBlocks = events
    .filter((e) => e.taskId === task.id && Date.parse(e.endAt) > Date.now())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const nextBlock = futureBlocks[0];
  const openEv = openEvent ? events.find((e) => e.id === openEvent) : undefined;

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
            } else {
              completeTask(task.id, "tick");
              // Dòng có thể biến khỏi danh sách ngay → Hoàn tác nằm ở khay chung.
              announceDone(task.id, task.title, futureBlocks);
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
            {nextBlock && !done && (
              <>
                {" · "}
                <button
                  className="linkish"
                  aria-label={`Mở lịch đã đặt: ${fmtDay(nextBlock.startAt)} ${fmtTime(nextBlock.startAt)}`}
                  style={{ border: 0, background: "transparent", padding: 0, color: "var(--ink)", fontWeight: 600, cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenEvent(nextBlock.id);
                  }}
                >
                  📅 {fmtDay(nextBlock.startAt)} {fmtTime(nextBlock.startAt)}
                </button>
              </>
            )}
          </span>
        </span>
        {trailing}
        {!done && (
          <button
            className="btn ghost small"
            aria-label={`Thêm thao tác cho: ${task.title}`}
            aria-expanded={menu}
            style={{ padding: "2px 8px" }}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            ⋯
          </button>
        )}
      </div>
      {menu && !done && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: -2 }}>
          <button
            className="btn primary small"
            onClick={() => {
              setMenu(false);
              setBooking(true);
            }}
          >
            📅 Book lịch
          </button>
          <span className="muted">Dời hạn:</span>
          {duePresets(new Date())
            .filter((d) => d.key === "tomorrow" || d.key === "friday" || d.key === "nextweek")
            .map((d) => (
              <button
                key={d.key}
                className="btn small"
                onClick={() => {
                  setTaskDue(task.id, d.at.toISOString());
                  setMenu(false);
                }}
              >
                {d.label}
              </button>
            ))}
        </div>
      )}
      {open && <TaskDetail taskId={task.id} onClose={() => setOpen(false)} />}
      {booking && <BookTaskSheet task={task} onClose={() => setBooking(false)} />}
      {openEv && <EventDetail event={openEv} onClose={() => setOpenEvent(null)} />}
    </>
  );
}
