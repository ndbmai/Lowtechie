"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { DueType, ParsedAction, ParseResult, Project, Task } from "@/core/types";
import { categoriesFor } from "@/core/projects";
import {
  clientsFor,
  findClientByName,
  matchClient,
  orderClientsForPick,
  sanitizeClientId,
  withLearnedAlias,
} from "@/core/clients";
import { duePresets } from "@/core/due";
import { parseCommand } from "@/core/parse";
import { next7DaysRange, projectCounts } from "@/core/stats";
import { DueEditor } from "@/components/DueEditor";
import { SearchSelect } from "@/components/SearchSelect";
import { TaskRow } from "@/components/TaskRow";
import { useMounted } from "@/lib/hooks";
import { useSpeech } from "@/lib/speech";
import { useStore } from "@/lib/store";

/**
 * Màn chi tiết dự án (PRD §5.3.0 v2.9): ô "+ Thêm việc" đầy đủ trường
 * (gõ hoặc nói, thiếu trường thì hỏi đúng một câu), hai dropdown một
 * dòng Nhóm theo · Lọc (app nhớ lựa chọn), nhóm "Chưa gắn khách" gắn
 * nhanh cả nhóm hoặc từng việc. Không hiện dòng mô tả dự án.
 */

type GroupBy = "category" | "client" | "due";
type Filter = "all" | "due" | "nodue" | "high" | "others" | "overdue";

const isOpenTask = (t: Task) => t.status === "todo" || t.status === "doing";

function passFilter(t: Task, f: Filter, nowMs: number): boolean {
  if (f === "due") return Boolean(t.dueAt);
  if (f === "nodue") return !t.dueAt;
  if (f === "high") return t.priority === "high";
  if (f === "others") return t.assignee !== "mai";
  if (f === "overdue") return Boolean(t.dueAt) && new Date(t.dueAt!).getTime() < nowMs;
  return true;
}

/** Tách câu Mai nói/gõ thành các trường — Claude khi có key, luật khi không. */
async function parseToTask(
  text: string,
): Promise<Extract<ParsedAction, { kind: "task" }> | undefined> {
  const { projects, categories, clients } = useStore.getState();
  let result: ParseResult;
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        epochMs: Date.now(),
        tzOffsetMin: new Date().getTimezoneOffset(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        taxonomy: {
          projects: projects.map((p) => ({ id: p.id, name: p.name })),
          categories: categories.map((c) => ({ id: c.id, projectId: c.projectId, name: c.name })),
          clients: clients.map((c) => ({
            id: c.id,
            name: c.name,
            aliases: c.aliases,
            projectIds: c.projectIds,
          })),
        },
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    result = (await res.json()) as ParseResult;
  } catch {
    result = parseCommand(text);
  }
  return result.actions.find(
    (x): x is Extract<ParsedAction, { kind: "task" }> => x.kind === "task",
  );
}

/**
 * Ô "+ Thêm việc" đầy đủ trường (v2.9): Tên · Ghi chú · Category · Khách
 * · Deadline · Ưu tiên, micro ngay trong ô; lưu xong ô trống lại nhưng
 * GIỮ category vừa dùng để nhập liên tiếp.
 */
function AddTaskForm({ project }: { project: Project }) {
  const { categories, clients, trips, events, addTask, addCategory, addClient, touchClient } =
    useStore();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  const [clientQuery, setClientQuery] = useState("");
  const [dueAt, setDueAt] = useState<string | undefined>();
  const [dueType, setDueType] = useState<DueType | undefined>();
  const [high, setHigh] = useState(false);
  const [viaVoice, setViaVoice] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [skipped, setSkipped] = useState<
    Partial<Record<"category" | "client" | "due", boolean>>
  >({});

  const cats = categoriesFor(categories, project.id);
  const myClients = orderClientsForPick(clientsFor(clients, project.id));

  const { supported, listening, processing, error, start, stop } = useSpeech((text) => {
    setViaVoice(true);
    setParsing(true);
    void parseToTask(text)
      .then((a) => {
        if (!a) {
          setTitle(text.trim());
          return;
        }
        setTitle(a.title);
        if (a.note) setNote(a.note);
        const cat = categories.find((c) => c.id === a.categoryId && c.projectId === project.id);
        if (cat) setCategoryId(cat.id);
        const cid =
          sanitizeClientId(clients, a.clientId) ?? matchClient(`${a.title} ${text}`, clients)?.id;
        if (cid) setClientId(cid);
        if (a.dueAt) {
          setDueAt(a.dueAt);
          setDueType(a.dueType);
        }
      })
      .finally(() => setParsing(false));
  });

  if (!open) {
    return (
      <button
        className="transcript"
        style={{ minHeight: 0, padding: "9px 12px", textAlign: "left", color: "var(--ink-2)" }}
        onClick={() => setOpen(true)}
      >
        ＋ Thêm việc
      </button>
    );
  }

  // Thiếu trường phân loại → hỏi ngắn, MỖI LẦN MỘT CÂU (5.3.0 v2.9).
  const asks: ("category" | "client" | "due")[] = [];
  if (title.trim()) {
    if (!categoryId && !skipped.category && cats.length > 0) asks.push("category");
    if (!clientId && !clientQuery.trim() && !skipped.client && myClients.length > 0)
      asks.push("client");
    if (!dueAt && !skipped.due) asks.push("due");
  }
  const ask = asks[0];
  const skip = (k: "category" | "client" | "due") => setSkipped((s) => ({ ...s, [k]: true }));

  function save() {
    const t = title.trim();
    if (!t) return;
    let cid = clientId;
    if (!cid && clientQuery.trim()) {
      const found = findClientByName(clients, clientQuery);
      if (found) {
        const aliases = withLearnedAlias(found, clientQuery);
        if (aliases) useStore.getState().updateClient(found.id, { aliases });
      }
      cid = (found ?? addClient(clientQuery, project.id))?.id;
    }
    if (cid) touchClient(cid);
    const noteBody = note.trim();
    addTask({
      title: t,
      projectId: project.id,
      categoryId,
      clientId: cid,
      notes: noteBody
        ? [{ id: `n-${Date.now()}`, body: noteBody, at: new Date().toISOString() }]
        : undefined,
      assignee: "mai",
      dueAt,
      dueType: dueAt ? (dueType ?? "soft") : undefined,
      dueSource: dueAt ? "mai" : undefined,
      priority: high ? "high" : undefined,
      source: { channel: viaVoice ? "app-voice" : "manual" },
      confidence: 1,
    });
    // Ô trống lại nhưng GIỮ category vừa dùng — nhập liên tiếp (v2.9).
    setTitle("");
    setNote("");
    setClientId(undefined);
    setClientQuery("");
    setDueAt(undefined);
    setDueType(undefined);
    setHigh(false);
    setViaVoice(false);
    setSkipped({});
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="transcript"
          style={{ minHeight: 0, padding: "8px 10px", flex: 1 }}
          placeholder="Tên việc…"
          aria-label={`Thêm việc vào ${project.name}`}
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        {supported && (
          <button
            className="btn small"
            aria-pressed={listening}
            style={listening ? { background: "var(--mai)", borderColor: "var(--mai)" } : undefined}
            onClick={() => (listening ? stop() : start())}
          >
            {listening ? "⏹" : "🎤"}
          </button>
        )}
      </div>
      {(processing || parsing) && <span className="muted small">Đang xử lý câu nói…</span>}
      {error && <span className="small" style={{ color: "var(--rose, #FF8FA3)" }}>{error}</span>}
      <input
        className="transcript"
        style={{ minHeight: 0, padding: "6px 10px" }}
        placeholder="Ghi chú (tùy chọn)…"
        aria-label="Ghi chú cho việc mới"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <SearchSelect
        label="Category"
        value={categoryId}
        options={cats.map((c) => ({ id: c.id, label: c.name }))}
        emptyLabel="Không có"
        onPick={setCategoryId}
        onCreate={(name) => {
          const c = addCategory(project.id, name);
          if (c) setCategoryId(c.id);
        }}
      />
      <SearchSelect
        label="Khách hàng / đối tác"
        value={clientId}
        options={myClients.map((c) => ({ id: c.id, label: c.name }))}
        emptyLabel="Không có"
        onPick={setClientId}
        onQueryChange={setClientQuery}
        onCreate={(name) => {
          const existing = findClientByName(clients, name);
          if (existing) {
            const aliases = withLearnedAlias(existing, name);
            if (aliases) useStore.getState().updateClient(existing.id, { aliases });
          }
          const c = existing ?? addClient(name, project.id);
          if (c) setClientId(c.id);
        }}
      />
      <DueEditor
        value={dueAt}
        dueType={dueType}
        onChange={(d, t) => {
          setDueAt(d);
          setDueType(t);
        }}
        trips={trips}
        events={events}
      />
      <button
        className="btn small"
        aria-pressed={high}
        style={{
          alignSelf: "flex-start",
          ...(high ? { background: "var(--mai)", borderColor: "var(--mai)" } : {}),
        }}
        onClick={() => setHigh((v) => !v)}
      >
        ⭐ Ưu tiên cao
      </button>

      {ask === "category" && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          Việc này thuộc category nào?
          {cats.slice(0, 3).map((c) => (
            <button key={c.id} className="btn small" onClick={() => setCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
          <button className="btn ghost small" onClick={() => skip("category")}>
            Bỏ qua
          </button>
        </div>
      )}
      {ask === "client" && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          Việc này cho khách / đối tác nào?
          {myClients.slice(0, 3).map((c) => (
            <button
              key={c.id}
              className="btn small"
              onClick={() => {
                setClientId(c.id);
                touchClient(c.id);
              }}
            >
              {c.name}
            </button>
          ))}
          <button className="btn ghost small" onClick={() => skip("client")}>
            Bỏ qua
          </button>
        </div>
      )}
      {ask === "due" && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          Hạn khi nào?
          {duePresets(new Date())
            .slice(0, 3)
            .map((p) => (
              <button
                key={p.key}
                className="btn small"
                onClick={() => {
                  setDueAt(p.at.toISOString());
                  setDueType("soft");
                }}
              >
                {p.label}
              </button>
            ))}
          <button className="btn ghost small" onClick={() => skip("due")}>
            Bỏ qua
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} disabled={!title.trim()} onClick={save}>
          Lưu việc
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Đóng
        </button>
      </div>
    </div>
  );
}

/** Chọn khách cho MỘT việc ngay trên dòng — không cần mở chi tiết (v2.9). */
function QuickClientPick({ task, project }: { task: Task; project: Project }) {
  const { clients, setTaskClient, addClient, touchClient } = useStore();
  const myClients = orderClientsForPick(clientsFor(clients, project.id));
  const assign = (cid: string) => {
    setTaskClient(task.id, cid);
    touchClient(cid);
  };
  return (
    <select
      className="btn small"
      value=""
      aria-label={`Gắn khách cho ${task.title}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        if (v === "__new") {
          const name = window.prompt("Tên khách / đối tác mới?");
          if (!name?.trim()) return;
          const c = findClientByName(clients, name) ?? addClient(name, project.id);
          if (c) assign(c.id);
          return;
        }
        assign(v);
      }}
    >
      <option value="">🤝 gắn…</option>
      {myClients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="__new">＋ Tạo khách mới…</option>
    </select>
  );
}

/** Nhóm "Chưa gắn khách": chạm tiêu đề → gắn nhanh cho CẢ nhóm (v2.9). */
function NoClientGroup({ tasks, project }: { tasks: Task[]; project: Project }) {
  const { clients, setTaskClient, addClient, touchClient } = useStore();
  const [pickAll, setPickAll] = useState(false);
  const myClients = orderClientsForPick(clientsFor(clients, project.id));
  const assignAll = (cid: string) => {
    for (const t of tasks) setTaskClient(t.id, cid);
    touchClient(cid);
    setPickAll(false);
  };
  return (
    <div>
      <button
        className="group-title"
        style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
        aria-expanded={pickAll}
        onClick={() => setPickAll((v) => !v)}
      >
        Chưa gắn khách ({tasks.length}) ▾
      </button>
      {pickAll && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          Gắn cả nhóm cho:
          {myClients.map((c) => (
            <button key={c.id} className="btn small" onClick={() => assignAll(c.id)}>
              {c.name}
            </button>
          ))}
          <button
            className="btn ghost small"
            onClick={() => {
              const name = window.prompt("Tên khách / đối tác mới?");
              if (!name?.trim()) return;
              const c = findClientByName(clients, name) ?? addClient(name, project.id);
              if (c) assignAll(c.id);
            }}
          >
            ＋ Tạo khách mới
          </button>
        </div>
      )}
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} trailing={<QuickClientPick task={t} project={project} />} />
      ))}
    </div>
  );
}

function CategoryGroup({ name, open, done }: { name: string; open: Task[]; done: Task[] }) {
  return (
    <details open={open.length > 0}>
      <summary className="group-title" style={{ cursor: "pointer" }}>
        {name} ({open.length})
      </summary>
      {open.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
      {done.length > 0 && (
        <details style={{ marginTop: 2 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Đã xong ({done.length})
          </summary>
          {done.slice(0, 20).map((t) => (
            <TaskRow key={t.id} task={t} showDue={false} />
          ))}
        </details>
      )}
    </details>
  );
}

export default function ProjectDetailPage() {
  const mounted = useMounted();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(typeof params.id === "string" ? params.id : "");
  const router = useRouter();
  const { tasks, projects, categories, clients, events, research, setPendingBlock, setProjectView, deleteResearch } =
    useStore();
  const groupBy = useStore((s) => s.settings.projectGroupBy);
  const filter = useStore((s) => s.settings.projectFilter);

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
  const open = mine.filter((t) => isOpenTask(t) && passFilter(t, filter, now.getTime()));
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

      <AddTaskForm project={project} />

      {/* Hai dropdown MỘT DÒNG thay tab + hàng chip (v2.9) — app nhớ lựa chọn. */}
      <div style={{ display: "flex", gap: 8 }}>
        <select
          className="btn small"
          style={{ flex: 1, minWidth: 0 }}
          value={groupBy}
          aria-label="Nhóm theo"
          onChange={(e) => setProjectView({ groupBy: e.target.value as GroupBy })}
        >
          {/* Nhãn NGẮN để không bị cắt chữ trên màn hẹp (bài học "+ khách hàng / đối t"). */}
          <option value="category">Nhóm: Category</option>
          <option value="client">Nhóm: Khách</option>
          <option value="due">Nhóm: Hạn</option>
        </select>
        <select
          className="btn small"
          style={{ flex: 1, minWidth: 0 }}
          value={filter}
          aria-label="Lọc"
          onChange={(e) => setProjectView({ filter: e.target.value as Filter })}
        >
          <option value="all">Lọc: Tất cả</option>
          <option value="due">Lọc: Có hạn</option>
          <option value="nodue">Lọc: Không hạn</option>
          <option value="high">Lọc: ⭐ Cao</option>
          <option value="others">Lọc: Cộng sự</option>
          <option value="overdue">Lọc: Quá hạn</option>
        </select>
      </div>

      {counts.open === 0 && doneAll.length === 0 && (
        <div className="warn">
          Chưa có việc nào trong {project.name}. Thêm bằng ô “+ Thêm việc” ở trên — gõ hoặc bấm
          🎤 nói một câu, mình tự điền các ô cho Mai duyệt.
        </div>
      )}

      {groupBy === "category" && (
        <>
          {cats.map((c) => (
            <CategoryGroup
              key={c.id}
              name={c.name}
              open={open.filter((t) => t.categoryId === c.id)}
              done={doneAll.filter((t) => t.categoryId === c.id)}
            />
          ))}
          <CategoryGroup
            name="Chưa có category"
            open={open.filter((t) => !t.categoryId || !cats.some((c) => c.id === t.categoryId))}
            done={doneAll.filter((t) => !t.categoryId || !cats.some((c) => c.id === t.categoryId))}
          />
        </>
      )}

      {groupBy === "client" && (
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
            return <NoClientGroup tasks={noClient} project={project} />;
          })()}
        </>
      )}

      {groupBy === "due" && (
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

      {/* §5.9.1 v3.7: nghiên cứu đã lưu vào dự án (hoặc khách của dự án) — luôn kèm nguồn. */}
      {(() => {
        const mine = research.filter(
          (r) =>
            r.projectId === project.id ||
            (r.clientId && clients.find((c) => c.id === r.clientId)?.projectIds.includes(project.id)),
        );
        if (mine.length === 0) return null;
        return (
          <details>
            <summary className="group-title" style={{ cursor: "pointer" }}>
              🔎 Nghiên cứu đã lưu ({mine.length})
            </summary>
            {mine.map((r) => (
              <div key={r.id} className="card small" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                <b>{r.query}</b>
                <span>{r.summary}</span>
                {r.uncertain && <span className="muted">⚠ Chưa chắc: {r.uncertain}</span>}
                <span className="muted">
                  Nguồn (truy cập {new Date(r.accessedAt).toLocaleDateString("vi-VN")}):{" "}
                  {r.sources.slice(0, 5).map((src, i) => (
                    <a key={src.url} href={src.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                      [{i + 1}]
                    </a>
                  ))}
                </span>
                <button
                  className="btn ghost small"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    if (window.confirm(`Xóa nghiên cứu “${r.query}”?`)) deleteResearch(r.id);
                  }}
                >
                  Xóa
                </button>
              </div>
            ))}
          </details>
        );
      })()}
    </main>
  );
}
