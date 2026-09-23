"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { Task } from "@/core/types";
import { categoriesFor } from "@/core/projects";
import { clientsFor } from "@/core/clients";
import { next7DaysRange, projectCounts } from "@/core/stats";
import { TaskRow } from "@/components/TaskRow";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

/**
 * Màn chi tiết dự án (PRD §5.3.0 v2.8): chạm một ô ở màn Dự án là vào
 * đây — 3 cách xem (Theo category · Theo khách hàng · Theo hạn), thêm
 * việc ngay trong từng category, lọc nhanh, lịch sắp tới của dự án.
 */

type Tab = "category" | "client" | "due";
type Filter = "all" | "due" | "nodue" | "high" | "others";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "due", label: "Có hạn" },
  { id: "nodue", label: "Không hạn" },
  { id: "high", label: "⭐ Ưu tiên cao" },
  { id: "others", label: "Của cộng sự" },
];

const isOpenTask = (t: Task) => t.status === "todo" || t.status === "doing";

function passFilter(t: Task, f: Filter): boolean {
  if (f === "due") return Boolean(t.dueAt);
  if (f === "nodue") return !t.dueAt;
  if (f === "high") return t.priority === "high";
  if (f === "others") return t.assignee !== "mai";
  return true;
}

/** Ô "+ Thêm việc" tại chỗ — tự điền dự án (và category nếu có). */
function AddTaskInline({ projectId, categoryId }: { projectId: string; categoryId?: string }) {
  const addTask = useStore((s) => s.addTask);
  const [text, setText] = useState("");
  return (
    <form
      style={{ display: "flex", gap: 6, margin: "4px 0" }}
      onSubmit={(e) => {
        e.preventDefault();
        const title = text.trim();
        if (!title) return;
        addTask({
          title,
          projectId,
          categoryId,
          assignee: "mai",
          source: { channel: "manual" },
          confidence: 1,
        });
        setText("");
      }}
    >
      <input
        className="transcript"
        style={{ minHeight: 0, padding: "6px 10px", flex: 1 }}
        placeholder="+ Thêm việc"
        aria-label={categoryId ? "Thêm việc vào category này" : "Thêm việc vào dự án"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim() && (
        <button className="btn primary small" type="submit">
          Thêm
        </button>
      )}
    </form>
  );
}

function DoneInline({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <details style={{ marginTop: 2 }}>
      <summary className="small muted" style={{ cursor: "pointer" }}>
        Đã xong ({tasks.length})
      </summary>
      {tasks.slice(0, 20).map((t) => (
        <TaskRow key={t.id} task={t} showDue={false} />
      ))}
    </details>
  );
}

function CategoryGroup({
  category,
  open,
  done,
  projectId,
}: {
  category: { id?: string; name: string };
  open: Task[];
  done: Task[];
  projectId: string;
}) {
  return (
    <details open={open.length > 0}>
      <summary className="group-title" style={{ cursor: "pointer" }}>
        {category.name} ({open.length})
      </summary>
      {open.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
      <AddTaskInline projectId={projectId} categoryId={category.id} />
      <DoneInline tasks={done} />
    </details>
  );
}

export default function ProjectDetailPage() {
  const mounted = useMounted();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(typeof params.id === "string" ? params.id : "");
  const router = useRouter();
  const { tasks, projects, categories, clients, events, setPendingBlock } = useStore();
  const [tab, setTab] = useState<Tab>("category");
  const [filter, setFilter] = useState<Filter>("all");

  const project = projects.find((p) => p.id === id);
  if (!mounted) return <main className="screen-body" />;
  if (!project) {
    return (
      <main className="screen-body">
        <div className="hdr">
          <h1>Dự án</h1>
        </div>
        <div className="warn">Không tìm thấy dự án này — có thể đã bị xóa.</div>
        <Link href="/du-an" className="btn" style={{ textDecoration: "none", textAlign: "center" }}>
          ← Về màn Dự án
        </Link>
      </main>
    );
  }

  const now = new Date();
  const counts = projectCounts(tasks, project.id, now);
  const mine = tasks.filter((t) => t.projectId === project.id);
  const open = mine.filter((t) => isOpenTask(t) && passFilter(t, filter));
  const doneAll = mine
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const cats = categoriesFor(categories, project.id);
  const upcoming = events
    .filter(
      (e) =>
        e.projectId === project.id &&
        (e.kind === "event" || e.kind === "block") &&
        new Date(e.endAt).getTime() >= now.getTime(),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 5);

  // Nhóm "Theo hạn": quá hạn → hôm nay → tuần này → sau đó → không hạn.
  const { end: endOf7 } = next7DaysRange(now);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const dueBucket = (t: Task): string => {
    if (!t.dueAt) return "Không hạn";
    const due = new Date(t.dueAt).getTime();
    if (due < now.getTime()) return "Quá hạn";
    if (due <= endOfToday) return "Hôm nay";
    if (due <= endOf7) return "Tuần này";
    return "Sau đó";
  };

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{ width: 14, height: 14, borderRadius: 5, background: project.color, flex: "0 0 14px" }}
          />
          {project.name}
        </h1>
        <Link href="/du-an" className="muted small">
          ← Dự án
        </Link>
      </div>

      {project.goal && <p className="muted small" style={{ marginTop: -4 }}>{project.goal}</p>}
      <p className="small" style={{ marginTop: -2 }}>
        <b>{counts.open}</b> đang mở
        {counts.overdue > 0 && (
          <>
            {" · "}
            <span style={{ color: "var(--rose, #FF8FA3)", fontWeight: 600 }}>{counts.overdue} quá hạn</span>
          </>
        )}
        {counts.due7d > 0 && <span className="muted"> · {counts.due7d} đến hạn 7 ngày</span>}
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          className="btn small"
          onClick={() => {
            setPendingBlock({
              title: `Deep work: ${project.name}`,
              projectId: project.id,
              durationMinutes: 120,
            });
            router.push("/lich");
          }}
        >
          📅 Book block làm việc
        </button>
        <Link href="/du-an/quan-ly" className="btn small" style={{ textDecoration: "none" }}>
          ⚙️ Quản lý
        </Link>
      </div>
      <AddTaskInline projectId={project.id} />

      <div style={{ display: "flex", gap: 6 }}>
        {(
          [
            ["category", "Theo category"],
            ["client", "Theo khách hàng"],
            ["due", "Theo hạn"],
          ] as const
        ).map(([tid, label]) => (
          <button
            key={tid}
            className="btn small"
            aria-pressed={tab === tid}
            style={tab === tid ? { background: "var(--ink)", color: "var(--surface)" } : undefined}
            onClick={() => setTab(tid)}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className="btn ghost small"
            aria-pressed={filter === f.id}
            style={filter === f.id ? { borderColor: "var(--ink)", fontWeight: 700 } : undefined}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {counts.open === 0 && doneAll.length === 0 && (
        <div className="warn">
          Chưa có việc nào trong {project.name}. Thêm bằng ô “+ Thêm việc” ở trên, hoặc bấm bông
          mai và nói “thêm việc … cho {project.name}”.
        </div>
      )}

      {tab === "category" && (
        <>
          {cats.map((c) => (
            <CategoryGroup
              key={c.id}
              category={c}
              projectId={project.id}
              open={open.filter((t) => t.categoryId === c.id)}
              done={doneAll.filter((t) => t.categoryId === c.id)}
            />
          ))}
          <CategoryGroup
            category={{ id: undefined, name: "Chưa có category" }}
            projectId={project.id}
            open={open.filter((t) => !t.categoryId || !cats.some((c) => c.id === t.categoryId))}
            done={doneAll.filter((t) => !t.categoryId || !cats.some((c) => c.id === t.categoryId))}
          />
        </>
      )}

      {tab === "client" && (
        <>
          {clientsFor(clients, project.id).map((c) => {
            const theirs = open.filter((t) => t.clientId === c.id);
            if (theirs.length === 0) return null;
            return (
              <div key={c.id}>
                <div className="group-title">🤝 {c.name} ({theirs.length})</div>
                {theirs.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            );
          })}
          {(() => {
            const known = new Set(clients.map((c) => c.id));
            const noClient = open.filter((t) => !t.clientId || !known.has(t.clientId));
            if (noClient.length === 0) return null;
            return (
              <div>
                <div className="group-title">Chưa gắn khách ({noClient.length})</div>
                {noClient.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            );
          })()}
        </>
      )}

      {tab === "due" && (
        <>
          {["Quá hạn", "Hôm nay", "Tuần này", "Sau đó", "Không hạn"].map((bucket) => {
            const list = open
              .filter((t) => dueBucket(t) === bucket)
              .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
            if (list.length === 0) return null;
            return (
              <div key={bucket}>
                <div className="group-title">{bucket} ({list.length})</div>
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            );
          })}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="group-title">Lịch sắp tới của {project.name}</div>
          {upcoming.map((e) => {
            const d = new Date(e.startAt);
            return (
              <div className="row" key={e.id}>
                <span className="dot" style={{ background: project.color }} />
                <span className="t">
                  <b>{e.title}</b>
                  <span className="small muted">
                    {d.getDate()}/{d.getMonth() + 1} · {d.getHours()}:
                    {String(d.getMinutes()).padStart(2, "0")}
                  </span>
                </span>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
