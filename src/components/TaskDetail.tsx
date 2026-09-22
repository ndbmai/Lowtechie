"use client";

import { useState } from "react";
import { DueEditor } from "@/components/DueEditor";
import { categoryName, projectById } from "@/core/projects";
import type { SourceChannel } from "@/core/types";
import { fmtDayFull, fmtDayTime, fmtDue } from "@/lib/format";
import { useStore } from "@/lib/store";

const CHANNEL_LABELS: Record<SourceChannel, string> = {
  "app-chat": "Chat trong app",
  "app-voice": "Voice trong app",
  zalo: "Zalo",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
  meeting: "Cuộc họp",
  manual: "Tự thêm",
};

/**
 * Màn chi tiết việc (PRD 5.2.2 v2.6) — chạm vào việc là mở màn này, KHÔNG
 * đóng việc. Đóng chỉ bằng ô tick ở dòng hoặc nút Xong ở đây. Kèm nhật ký
 * Ghi chú (3d) tách riêng với trích dẫn Nguồn.
 */
export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const {
    tasks,
    projects,
    categories,
    clients,
    trips,
    events,
    dueChanges,
    completeTask,
    reopenTask,
    dropTask,
    setTaskDue,
    setTaskPriority,
    updateTaskTitle,
    addTaskNote,
    updateTaskNote,
    deleteTaskNote,
  } = useStore();
  const task = tasks.find((t) => t.id === taskId);
  const [editingTitle, setEditingTitle] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [reopenHint, setReopenHint] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteEdit, setNoteEdit] = useState("");

  if (!task) return null;
  const p = projectById(projects, task.projectId);
  const client = clients.find((c) => c.id === task.clientId);
  const done = task.status === "done";
  const myDueChanges = dueChanges.filter((d) => d.taskId === task.id);

  return (
    <div
      role="dialog"
      aria-label={`Chi tiết việc: ${task.title}`}
      style={{ position: "fixed", inset: 0, background: "rgba(30,33,80,.45)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {editingTitle ? (
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 8, flex: 1, fontWeight: 600 }}
              value={task.title}
              autoFocus
              aria-label="Sửa tên việc"
              onChange={(e) => updateTaskTitle(task.id, e.target.value)}
              onBlur={() => setEditingTitle(false)}
            />
          ) : (
            <b style={{ flex: 1, fontSize: 17, textDecoration: done ? "line-through" : undefined, opacity: done ? 0.7 : 1 }}>
              {task.title}
            </b>
          )}
          <button className="btn ghost small" aria-label="Đóng chi tiết" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="chip" style={{ background: p.color }}>
            {p.name}
          </span>
          {categoryName(categories, task.categoryId) && (
            <span className="small muted">{categoryName(categories, task.categoryId)}</span>
          )}
          {client && <span className="small muted">🤝 {client.name}</span>}
          {task.assignee !== "mai" && <span className="small muted">Người làm: {task.assignee}</span>}
          {!done && (
            <button
              className="btn small"
              aria-pressed={task.priority === "high"}
              style={task.priority === "high" ? { background: "var(--mai)", borderColor: "var(--mai)" } : undefined}
              onClick={() => setTaskPriority(task.id, task.priority === "high" ? undefined : "high")}
            >
              ⭐ Ưu tiên hôm nay
            </button>
          )}
        </div>

        <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {task.dueAt ? (
            <span>
              Deadline: <b>{fmtDayFull(task.dueAt)}</b>
              {(() => {
                const t = fmtDue(task.dueAt).match(/\d{1,2}:\d{2}$/)?.[0];
                return t ? `, ${t}` : "";
              })()}
              {task.dueType === "hard" ? " · hạn cứng" : ""}
            </span>
          ) : (
            <span className="muted">Không có hạn</span>
          )}
          {!done && (
            <button className="btn ghost small" onClick={() => setDueOpen((v) => !v)}>
              Dời hạn
            </button>
          )}
        </div>
        {reopenHint && (
          <div className="note-box small">Hạn cũ đã qua — Mai chọn hạn mới bên dưới nhé.</div>
        )}
        {(dueOpen || reopenHint) && !done && (
          <DueEditor
            value={task.dueAt}
            dueType={task.dueType}
            onChange={(dueAt, dueType) => {
              setTaskDue(task.id, dueAt, dueType);
              setReopenHint(false);
            }}
            trips={trips}
            events={events}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b className="small">Ghi chú</b>
          <form
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              addTaskNote(task.id, noteText);
              setNoteText("");
            }}
          >
            <input
              className="transcript"
              style={{ minHeight: 0, padding: 8, flex: 1 }}
              placeholder="Thêm ghi chú…"
              aria-label="Thêm ghi chú"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            {noteText.trim() && (
              <button className="btn primary small" type="submit">
                Thêm
              </button>
            )}
          </form>
          {(task.notes ?? []).map((n) => (
            <div key={n.id} className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              {editingNote === n.id ? (
                <>
                  <input
                    className="transcript"
                    style={{ minHeight: 0, padding: 6, flex: 1 }}
                    value={noteEdit}
                    autoFocus
                    aria-label="Sửa ghi chú"
                    onChange={(e) => setNoteEdit(e.target.value)}
                  />
                  <button
                    className="btn primary small"
                    onClick={() => {
                      updateTaskNote(task.id, n.id, noteEdit);
                      setEditingNote(null);
                    }}
                  >
                    Lưu
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>
                    {n.body}
                    <span className="muted"> — {fmtDayTime(n.at)}{n.updatedAt ? " (đã sửa)" : ""}</span>
                  </span>
                  <button
                    aria-label="Sửa ghi chú này"
                    style={{ border: 0, background: "transparent", padding: 0 }}
                    onClick={() => {
                      setEditingNote(n.id);
                      setNoteEdit(n.body);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    aria-label="Xóa ghi chú này"
                    style={{ border: 0, background: "transparent", padding: 0, color: "var(--ink-2)" }}
                    onClick={() => deleteTaskNote(task.id, n.id)}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {task.source.quote && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <b className="small">Nguồn · {CHANNEL_LABELS[task.source.channel]}</b>
            <div className="quote">{task.source.quote}</div>
          </div>
        )}

        <div className="small muted" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>Tạo {fmtDayTime(task.createdAt)}</span>
          {myDueChanges.slice(-3).map((d, i) => (
            <span key={i}>
              Đổi hạn {d.oldDue ? fmtDayFull(d.oldDue) : "—"} → {d.newDue ? fmtDayFull(d.newDue) : "bỏ hạn"} ({fmtDayTime(d.changedAt)})
            </span>
          ))}
          {task.completedAt && (
            <span>
              Xong {fmtDayTime(task.completedAt)}
              {task.completedVia === "chat" ? " · qua chat" : task.completedVia === "tick" ? " · tick" : ""}
            </span>
          )}
          {task.reopenedAt && <span>Mở lại {fmtDayTime(task.reopenedAt)}</span>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {done ? (
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => {
                reopenTask(task.id);
                if (task.dueAt && Date.parse(task.dueAt) < Date.now()) setReopenHint(true);
              }}
            >
              Mở lại
            </button>
          ) : (
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => {
                completeTask(task.id, "button");
                onClose();
              }}
            >
              Xong ✓
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              if (window.confirm(`Xóa việc "${task.title}"?`)) {
                dropTask(task.id);
                onClose();
              }
            }}
          >
            Xóa
          </button>
        </div>
      </div>
    </div>
  );
}
