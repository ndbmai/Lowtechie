"use client";

import { useState } from "react";
import { Blossom } from "@/components/Blossom";
import { DueEditor } from "@/components/DueEditor";
import { SearchSelect, type PickOption } from "@/components/SearchSelect";
import { CONFIDENCE_THRESHOLD, learnableTerms } from "@/core/classify";
import { clientsFor, findClientByName, orderClientsForPick } from "@/core/clients";
import { activeProjects, categoriesFor, categoryName, projectById, PROJECT_COLORS } from "@/core/projects";
import type { DueType, ProjectId, SourceChannel } from "@/core/types";
import { fmtDayFull, fmtDayTime } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
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

const CLIENT_TYPE_LABELS = { khachhang: "khách hàng", doitac: "đối tác", nhacungcap: "nhà cung cấp" };

export default function TriagePage() {
  const mounted = useMounted();
  const {
    triage,
    triageImages,
    projects,
    categories,
    clients,
    trips,
    events,
    acceptTriage,
    dismissTriage,
    dismissGroup,
    addTriage,
    recordFeedback,
    addProject,
    addCategory,
    addClient,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<ProjectId>("canhan");
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  /** Tên khách Mai đang gõ dở trong ô chọn — Lưu là vào danh bạ (v2.3). */
  const [clientQuery, setClientQuery] = useState("");
  const [dueAt, setDueAt] = useState<string | undefined>();
  const [dueType, setDueType] = useState<DueType | undefined>();
  /** Ghi chú của Mai (3d) — tách riêng với trích dẫn Nguồn. */
  const [noteText, setNoteText] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  /** Nhắc "chưa có deadline" đúng một lần cho thẻ đang mở (3c). */
  const [askDue, setAskDue] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [gProject, setGProject] = useState<ProjectId | undefined>();
  const [gCategory, setGCategory] = useState<string | undefined>();
  const [gClient, setGClient] = useState<string | undefined>();
  const [gDue, setGDue] = useState<string | undefined>();
  const [gDueType, setGDueType] = useState<DueType | undefined>();

  const top = triage[0];
  const p = top ? projectById(projects, top.draft.projectId) : null;
  const groupItems = top?.groupId ? triage.filter((x) => x.groupId === top.groupId) : [];
  const groupImage = top?.groupId ? triageImages[top.groupId] : undefined;

  const projectOptions = (): PickOption[] =>
    activeProjects(projects).map((pr) => ({ id: pr.id, label: pr.name, color: pr.color }));
  const categoryOptions = (pid: ProjectId): PickOption[] =>
    categoriesFor(categories, pid).map((c) => ({ id: c.id, label: c.name }));
  // Gợi ý: vừa dùng gần đây → hay dùng nhất → thứ tự Mai đặt (v2.3).
  const clientOptions = (pid: ProjectId): PickOption[] =>
    orderClientsForPick(clientsFor(clients, pid)).map((c) => ({
      id: c.id,
      label: c.name,
      hint: CLIENT_TYPE_LABELS[c.type],
    }));
  const nextColor = () => PROJECT_COLORS[projects.length % PROJECT_COLORS.length];

  function resetCardState() {
    setEditing(false);
    setAskDue(false);
    setDueTouched(false);
    setGroupOpen(false);
    setClientQuery("");
    setNoteText("");
  }

  function startEdit() {
    if (!top) return;
    setTitle(top.draft.title);
    setProjectId(top.draft.projectId);
    setCategoryId(top.draft.categoryId);
    setClientId(top.draft.clientId);
    setDueAt(top.draft.dueAt);
    setDueType(top.draft.dueType);
    setDueTouched(false);
    setAskDue(false);
    setEditing(true);
  }

  function saveEdit(noDeadlineOk = false) {
    if (!top) return;
    // Nhắc một lần khi Lưu & nhận mà ô Deadline vẫn trống (3c).
    if (!dueAt && !noDeadlineOk && !askDue) {
      setAskDue(true);
      return;
    }
    const finalTitle = title.trim() || top.draft.title;
    // Nhập một lần (v2.3): tên khách gõ tay chưa bấm "Tạo mới" vẫn vào
    // danh bạ — khớp tên gần giống (khác dấu/hoa thường) thì dùng lại.
    let finalClient = clientId;
    if (!finalClient && clientQuery.trim()) {
      const found = findClientByName(clients, clientQuery);
      finalClient = found?.id ?? useStore.getState().addClient(clientQuery, projectId)?.id;
    }
    if (finalClient) useStore.getState().touchClient(finalClient);
    const noteBody = noteText.trim();
    useStore.getState().addTask({
      ...top.draft,
      title: finalTitle,
      projectId,
      categoryId,
      clientId: finalClient,
      notes: noteBody
        ? [
            { id: `n-${Date.now()}`, body: noteBody, at: new Date().toISOString() },
            ...(top.draft.notes ?? []),
          ]
        : top.draft.notes,
      dueAt,
      dueType: dueAt ? (dueType ?? "soft") : undefined,
      dueSource: dueAt ? (dueTouched ? "mai" : (top.draft.dueSource ?? "nguon")) : undefined,
      confidence: 1,
    });
    // Mai đổi phân loại → nhớ cho lần sau.
    if (projectId !== top.draft.projectId || categoryId !== top.draft.categoryId) {
      const terms = learnableTerms(finalTitle);
      if (terms.length) {
        recordFeedback(terms.map((term) => ({ term, projectId, categoryId })));
      }
    }
    dismissTriage(top.id);
    resetCardState();
  }

  function quickAccept(noDeadlineOk = false) {
    if (!top) return;
    if (!top.draft.dueAt && !noDeadlineOk && !askDue) {
      setAskDue(true);
      return;
    }
    acceptTriage(top.id);
    resetCardState();
  }

  /** Nhận cả nhóm, áp các trường chung Mai đặt (nếu có) cho mọi dòng (3b). */
  function acceptWholeGroup() {
    if (!top?.groupId) return;
    const st = useStore.getState();
    for (const it of groupItems) {
      st.addTask({
        ...it.draft,
        projectId: gProject ?? it.draft.projectId,
        categoryId: gProject ? gCategory : it.draft.categoryId,
        clientId: gClient ?? it.draft.clientId,
        dueAt: gDue ?? it.draft.dueAt,
        dueType: (gDue ?? it.draft.dueAt) ? (gDue ? (gDueType ?? "soft") : it.draft.dueType) : undefined,
        dueSource: gDue ? "mai" : it.draft.dueSource,
      });
    }
    dismissGroup(top.groupId);
    resetCardState();
    setGProject(undefined);
    setGCategory(undefined);
    setGClient(undefined);
    setGDue(undefined);
    setGDueType(undefined);
  }

  function addDemo() {
    addTriage({
      title: "Gửi báo giá gói AIO cho anh Tuấn bên OKR",
      projectId: "circle",
      categoryId: "circle:banhang",
      assignee: "mai",
      dueAt: undefined,
      source: {
        channel: "zalo",
        quote: "“chị gửi em báo giá gói AIO trước thứ Sáu nha chị” (thẻ ví dụ)",
      },
      confidence: 0.86,
    });
  }

  const topClient = top?.draft.clientId
    ? clients.find((c) => c.id === top.draft.clientId)
    : undefined;

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Hộp duyệt</h1>
        {mounted && triage.length > 0 && <span className="muted small">1 / {triage.length}</span>}
      </div>

      {mounted && !top && (
        <div className="empty card">
          <Blossom size={56} />
          <p>
            Chưa có gì chờ duyệt. Việc mình trích từ chat và ảnh sẽ nằm đây, kèm trích dẫn gốc —
            Mai duyệt thì mới vào danh sách.
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={addDemo}>
            Xem thử một thẻ ví dụ
          </button>
        </div>
      )}

      {mounted && top && p && (
        <>
          {top.groupId && groupItems.length > 1 && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {groupImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={groupImage}
                    alt="Ảnh nguồn của nhóm việc"
                    style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10, flex: "0 0 56px" }}
                  />
                ) : null}
                <span className="t small">
                  <b>Nhóm từ ảnh · còn {groupItems.length} dòng</b>
                </span>
                <button className="btn primary small" onClick={() => setGroupOpen((v) => !v)}>
                  Nhận cả {groupItems.length}
                </button>
                <button className="btn ghost small" onClick={() => dismissGroup(top.groupId!)}>
                  Bỏ nhóm
                </button>
              </div>
              {groupOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="muted small">Đặt chung cho cả nhóm (bỏ trống = giữ như từng thẻ):</span>
                  <SearchSelect
                    label="Dự án"
                    value={gProject}
                    options={projectOptions()}
                    emptyLabel="Giữ như từng thẻ"
                    onPick={(id) => {
                      setGProject(id);
                      setGCategory(undefined);
                    }}
                    onCreate={(name) => {
                      const pr = addProject(name, nextColor());
                      if (pr) {
                        setGProject(pr.id);
                        setGCategory(undefined);
                      }
                    }}
                  />
                  {gProject && (
                    <SearchSelect
                      label="Category"
                      value={gCategory}
                      options={categoryOptions(gProject)}
                      emptyLabel="Không có"
                      onPick={setGCategory}
                      onCreate={(name) => {
                        const c = addCategory(gProject, name);
                        if (c) setGCategory(c.id);
                      }}
                    />
                  )}
                  <SearchSelect
                    label="Khách hàng / đối tác"
                    value={gClient}
                    options={clientOptions(gProject ?? top.draft.projectId)}
                    emptyLabel="Giữ như từng thẻ"
                    onPick={setGClient}
                    onCreate={(name) => {
                      const c = addClient(name, gProject ?? top.draft.projectId);
                      if (c) setGClient(c.id);
                    }}
                  />
                  <DueEditor
                    value={gDue}
                    dueType={gDueType}
                    onChange={(d, t) => {
                      setGDue(d);
                      setGDueType(t);
                    }}
                    trips={trips}
                    events={events}
                  />
                  <button className="btn primary" onClick={acceptWholeGroup}>
                    Nhận cả nhóm
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ boxShadow: "0 10px 24px -14px rgba(30,33,80,.5)" }}>
            <div className="src">
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  background: top.draft.source.channel === "zalo" ? "#0068FF" : "#25D366",
                  display: "inline-block",
                }}
              />
              {CHANNEL_LABELS[top.draft.source.channel]} · {fmtDayTime(top.receivedAt)}
            </div>

            {editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <input
                  className="transcript"
                  style={{ minHeight: 0, padding: 10 }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Sửa tiêu đề việc"
                />
                {/* 3 trường riêng, sửa độc lập — không danh sách phẳng (3b). */}
                <SearchSelect
                  label="Dự án"
                  value={projectId}
                  options={projectOptions()}
                  onPick={(id) => {
                    if (!id) return;
                    setProjectId(id);
                    setCategoryId(undefined);
                    setClientId(undefined);
                  }}
                  onCreate={(name) => {
                    const pr = addProject(name, nextColor());
                    if (pr) {
                      setProjectId(pr.id);
                      setCategoryId(undefined);
                      setClientId(undefined);
                    }
                  }}
                />
                <SearchSelect
                  label="Category"
                  value={categoryId}
                  options={categoryOptions(projectId)}
                  emptyLabel="Không có"
                  onPick={setCategoryId}
                  onCreate={(name) => {
                    const c = addCategory(projectId, name);
                    if (c) setCategoryId(c.id);
                  }}
                />
                <SearchSelect
                  label="Khách hàng / đối tác"
                  value={clientId}
                  options={clientOptions(projectId)}
                  emptyLabel="Không có"
                  onPick={setClientId}
                  onQueryChange={setClientQuery}
                  onCreate={(name) => {
                    const c = findClientByName(clients, name) ?? addClient(name, projectId);
                    if (c) setClientId(c.id);
                  }}
                />
                <DueEditor
                  value={dueAt}
                  dueType={dueType}
                  quote={top.draft.dueSource !== "mai" && top.draft.dueAt === dueAt ? top.draft.source.quote : undefined}
                  onChange={(d, t) => {
                    setDueAt(d);
                    setDueType(t);
                    setDueTouched(true);
                    setAskDue(false);
                  }}
                  trips={trips}
                  events={events}
                />
                <input
                  className="transcript"
                  style={{ minHeight: 0, padding: "6px 10px" }}
                  placeholder="Ghi chú (tùy chọn)…"
                  aria-label="Ghi chú cho việc"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                {askDue && (
                  <div className="note-box small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    Chưa có deadline — thêm hay để không hạn?
                    <button className="btn small" onClick={() => setAskDue(false)}>
                      Thêm hạn
                    </button>
                    <button className="btn primary small" onClick={() => saveEdit(true)}>
                      Không có hạn, nhận luôn
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={() => saveEdit()}>
                    Lưu & nhận
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => resetCardState()}>
                    Thôi
                  </button>
                </div>
              </div>
            ) : (
              <>
                <b style={{ display: "block", marginTop: 6, fontSize: 15.5 }}>{top.draft.title}</b>
                <div className="small" style={{ marginTop: 4 }}>
                  <span className="chip" style={{ background: p.color }}>
                    {p.name}
                  </span>
                  {categoryName(categories, top.draft.categoryId) && (
                    <span className="muted"> · {categoryName(categories, top.draft.categoryId)}</span>
                  )}
                  {topClient && (
                    <span className="muted"> · {topClient.name}</span>
                  )}
                  {top.draft.assignee && top.draft.assignee !== "mai" && (
                    <>
                      {" "}
                      · Người làm: <b>{top.draft.assignee}</b>
                    </>
                  )}
                  {top.draft.confidence < CONFIDENCE_THRESHOLD && (
                    <span
                      className="small"
                      style={{ marginLeft: 6, color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 8px" }}
                    >
                      cần xem lại
                    </span>
                  )}
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {top.draft.dueAt ? (
                    <>Deadline: <b>{fmtDayFull(top.draft.dueAt)}</b>{top.draft.dueType === "hard" ? " · hạn cứng" : ""}</>
                  ) : (
                    <span style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 10px" }}>
                      Chưa có deadline
                    </span>
                  )}
                </div>
                {top.draft.source.quote && <div className="quote">{top.draft.source.quote}</div>}
                <div
                  className="meter"
                  role="meter"
                  aria-valuenow={Math.round(top.draft.confidence * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Độ chắc chắn"
                >
                  <span style={{ width: `${Math.round(top.draft.confidence * 100)}%` }} />
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Chắc chắn {Math.round(top.draft.confidence * 100)}%
                </div>
              </>
            )}
          </div>

          {triage[1] && (
            <div className="card" style={{ opacity: 0.55 }}>
              <div className="src">{CHANNEL_LABELS[triage[1].draft.source.channel]}</div>
              <b style={{ display: "block", marginTop: 6 }}>{triage[1].draft.title}</b>
            </div>
          )}

          {!editing && (
            <>
              {askDue && (
                <div className="note-box small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  Chưa có deadline — thêm hay để không hạn?
                  <button className="btn small" onClick={() => startEdit()}>
                    Thêm hạn
                  </button>
                  <button className="btn primary small" onClick={() => quickAccept(true)}>
                    Không có hạn, nhận luôn
                  </button>
                </div>
              )}
              <div className="swipe">
                <button className="btn" onClick={() => { dismissTriage(top.id); resetCardState(); }}>
                  Bỏ
                </button>
                <button className="btn" onClick={() => startEdit()}>
                  Sửa
                </button>
                <button className="btn primary" onClick={() => quickAccept()}>
                  Nhận
                </button>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
