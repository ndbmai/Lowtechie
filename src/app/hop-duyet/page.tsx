"use client";

import { useState } from "react";
import { Blossom } from "@/components/Blossom";
import { CONFIDENCE_THRESHOLD, learnableTerms } from "@/core/classify";
import { categoriesFor, categoryName, projectById } from "@/core/projects";
import type { ProjectId, SourceChannel } from "@/core/types";
import { fmtDayTime } from "@/lib/format";
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

export default function TriagePage() {
  const mounted = useMounted();
  const {
    triage,
    triageImages,
    projects,
    categories,
    acceptTriage,
    dismissTriage,
    acceptGroup,
    dismissGroup,
    addTriage,
    recordFeedback,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [combo, setCombo] = useState("canhan|");

  const top = triage[0];
  const p = top ? projectById(projects, top.draft.projectId) : null;
  const groupItems = top?.groupId ? triage.filter((x) => x.groupId === top.groupId) : [];
  const groupImage = top?.groupId ? triageImages[top.groupId] : undefined;

  function startEdit() {
    if (!top) return;
    setTitle(top.draft.title);
    setCombo(`${top.draft.projectId}|${top.draft.categoryId ?? ""}`);
    setEditing(true);
  }

  function saveEdit() {
    if (!top) return;
    const [projectId, categoryId] = combo.split("|") as [ProjectId, string];
    const finalTitle = title.trim() || top.draft.title;
    // Sửa xong là nhận: thành task thẳng, thẻ rời hộp duyệt.
    useStore.getState().addTask({
      ...top.draft,
      title: finalTitle,
      projectId,
      categoryId: categoryId || undefined,
      confidence: 1,
    });
    // Mai đổi phân loại → học cho lần sau (PRD §5.2.1).
    if (projectId !== top.draft.projectId || (categoryId || undefined) !== top.draft.categoryId) {
      const terms = learnableTerms(finalTitle);
      if (terms.length) {
        recordFeedback(
          terms.map((term) => ({ term, projectId, categoryId: categoryId || undefined })),
        );
      }
    }
    dismissTriage(top.id);
    setEditing(false);
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

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Hộp duyệt</h1>
        {mounted && triage.length > 0 && <span className="muted small">1 / {triage.length}</span>}
      </div>
      <p className="muted small">
        Việc mình tự trích từ chat, ảnh và cuộc họp nằm chờ ở đây — Mai duyệt thì mới vào danh
        sách (PRD §5.2). Luôn kèm trích dẫn gốc và độ chắc chắn.
      </p>

      {mounted && !top && (
        <div className="empty card">
          <Blossom size={56} />
          <p>
            Chưa có gì chờ duyệt. Gửi một tấm ảnh checklist ở màn Giao việc, hoặc đợi bot
            Zalo/WhatsApp (Giai đoạn 2) trích việc từ group chat.
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={addDemo}>
            Xem thử một thẻ ví dụ
          </button>
        </div>
      )}

      {mounted && top && p && (
        <>
          {top.groupId && groupItems.length > 1 && (
            <div className="card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
                <span className="muted">Duyệt từng dòng, hoặc xử cả nhóm một lần.</span>
              </span>
              <button className="btn primary small" onClick={() => acceptGroup(top.groupId!)}>
                Nhận cả {groupItems.length}
              </button>
              <button className="btn ghost small" onClick={() => dismissGroup(top.groupId!)}>
                Bỏ nhóm
              </button>
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
                <select
                  className="btn"
                  value={combo}
                  onChange={(e) => setCombo(e.target.value)}
                  aria-label="Chọn dự án / category"
                >
                  {projects.map((pr) => {
                    const cats = categoriesFor(categories, pr.id);
                    return cats.length ? (
                      <optgroup key={pr.id} label={pr.name}>
                        <option value={`${pr.id}|`}>{pr.name}</option>
                        {cats.map((c) => (
                          <option key={c.id} value={`${pr.id}|${c.id}`}>
                            {pr.name} · {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <option key={pr.id} value={`${pr.id}|`}>
                        {pr.name}
                      </option>
                    );
                  })}
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={saveEdit}>
                    Lưu & nhận
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                    Thôi
                  </button>
                </div>
                <p className="muted small">
                  Đổi dự án/category ở đây là mình nhớ cho các việc tương tự sau này.
                </p>
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
            <div className="swipe">
              <button className="btn" onClick={() => dismissTriage(top.id)}>
                Bỏ
              </button>
              <button className="btn" onClick={startEdit}>
                Sửa
              </button>
              <button className="btn primary" onClick={() => acceptTriage(top.id)}>
                Nhận
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
