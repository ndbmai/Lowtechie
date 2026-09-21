"use client";

import { useState } from "react";
import { Blossom } from "@/components/Blossom";
import { projectById } from "@/core/projects";
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
  const { triage, projects, acceptTriage, dismissTriage, addTriage } = useStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<ProjectId>("canhan");

  const top = triage[0];
  const p = top ? projectById(projects, top.draft.projectId) : null;

  function startEdit() {
    if (!top) return;
    setTitle(top.draft.title);
    setProjectId(top.draft.projectId);
    setEditing(true);
  }

  function saveEdit() {
    if (!top) return;
    // Sửa xong là nhận: thành task thẳng, thẻ rời hộp duyệt.
    useStore
      .getState()
      .addTask({ ...top.draft, title: title.trim() || top.draft.title, projectId, confidence: 1 });
    dismissTriage(top.id);
    setEditing(false);
  }

  function addDemo() {
    addTriage({
      title: "Gửi báo cáo OTA tháng 9 cho khách sạn Rạng Đông",
      projectId: "favstay",
      assignee: "Linh",
      dueAt: undefined,
      source: {
        channel: "zalo",
        quote: "“ok chị, thứ 2 em gửi bản OTA tháng 9 cho bên Rạng Đông nha” (thẻ ví dụ)",
      },
      confidence: 0.86,
    });
  }

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Hộp duyệt</h1>
        {mounted && triage.length > 0 && (
          <span className="muted small">1 / {triage.length}</span>
        )}
      </div>
      <p className="muted small">
        Việc mình tự trích từ chat và cuộc họp nằm chờ ở đây — Mai duyệt thì mới vào danh sách
        (PRD §5.2). Luôn kèm trích dẫn gốc và độ chắc chắn.
      </p>

      {mounted && !top && (
        <div className="empty card">
          <Blossom size={56} />
          <p>
            Chưa có gì chờ duyệt. Khi bot Zalo/WhatsApp (Giai đoạn 2) hoặc recap cuộc họp trích
            được việc, thẻ sẽ hiện ở đây.
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={addDemo}>
            Xem thử một thẻ ví dụ
          </button>
        </div>
      )}

      {mounted && top && p && (
        <>
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
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value as ProjectId)}
                  aria-label="Chọn dự án"
                >
                  {projects.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={saveEdit}>
                    Lưu & nhận
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                    Thôi
                  </button>
                </div>
              </div>
            ) : (
              <>
                <b style={{ display: "block", marginTop: 6, fontSize: 15.5 }}>{top.draft.title}</b>
                <div className="small" style={{ marginTop: 4 }}>
                  Dự án: <span className="chip" style={{ background: p.color }}>{p.name}</span>
                  {top.draft.assignee && top.draft.assignee !== "mai" && (
                    <>
                      {" "}
                      · Người làm: <b>{top.draft.assignee}</b>
                    </>
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
