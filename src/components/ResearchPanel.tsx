"use client";

import { useEffect, useRef, useState } from "react";
import { matchClient } from "@/core/clients";
import { activeProjects, sanitizeTaxonomy } from "@/core/projects";
import type { ProjectId, ResearchNote } from "@/core/types";
import { fmtDayFull } from "@/lib/format";
import { useStore } from "@/lib/store";

interface ResearchResult {
  summary: string;
  details?: string;
  sources: { title: string; url: string }[];
  uncertain?: string;
  followUps: string[];
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Trợ lý nghiên cứu mức Nhanh (§5.9.1 v3.7): tìm web → tóm tắt trước, chi
 * tiết sau, LUÔN kèm nguồn + ngày truy cập; Mai chọn nơi lưu (dự án/khách)
 * trên thẻ; việc tiếp theo đi qua Hộp duyệt như mọi nguồn khác.
 */
export function ResearchPanel({
  query,
  projectId,
  onDone,
}: {
  query: string;
  projectId?: ProjectId;
  onDone: (line: string) => void;
}) {
  const {
    projects,
    categories,
    clients,
    tasks,
    settings,
    researchUsage,
    addResearch,
    countResearch,
    addTriageGroup,
  } = useStore();
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessedAt] = useState(() => new Date().toISOString());
  const client = matchClient(query, clients);
  const [saveTo, setSaveTo] = useState<string>(
    projectId ? `p:${projectId}` : client ? `c:${client.id}` : "",
  );
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const started = useRef(false);

  const used = researchUsage[monthKey()] ?? 0;
  const limit = settings.researchMonthlyLimit;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (used >= limit) {
      setState("error");
      setError(
        `Tháng này đã dùng ${used}/${limit} lượt nghiên cứu (hạn mức Mai đặt ở màn Kết nối) — tăng hạn mức rồi thử lại nhé.`,
      );
      return;
    }
    // Chuẩn bị trước họp: kèm việc + ghi chú nội bộ của khách/dự án liên quan.
    const ctxTasks = tasks
      .filter(
        (t) =>
          (t.status === "todo" || t.status === "doing") &&
          ((client && t.clientId === client.id) || (projectId && t.projectId === projectId)),
      )
      .slice(0, 15)
      .map((t) => `- ${t.title}${t.notes?.length ? ` (ghi chú: ${t.notes.map((n) => n.body).join("; ").slice(0, 160)})` : ""}`);
    const context = [
      client ? `Khách/đối tác: ${client.name}${client.notes ? ` — ${client.notes}` : ""}` : "",
      ctxTasks.length ? `Việc đang mở liên quan:\n${ctxTasks.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void (async () => {
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, context, today: fmtDayFull(new Date().toISOString()) }),
        });
        if (res.status === 501) {
          setState("error");
          setError("Nghiên cứu cần Claude API — thêm ANTHROPIC_API_KEY vào Vercel (Settings → Environment Variables) rồi Redeploy nhé.");
          return;
        }
        const body = (await res.json().catch(() => null)) as (ResearchResult & { detail?: string }) | null;
        if (!res.ok || !body?.summary) {
          setState("error");
          setError(`Chưa tìm được (${body?.detail ?? `mã ${res.status}`}) — Mai thử hỏi cụ thể hơn giúp mình.`);
          return;
        }
        countResearch();
        setResult(body);
        setPicked(Object.fromEntries(body.followUps.map((_, i) => [i, true])));
        setState("done");
      } catch {
        setState("error");
        setError("Mạng chập chờn — chưa gửi được câu hỏi, Mai thử lại nhé.");
      }
    })();
    // Chạy đúng một lần cho mỗi câu hỏi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    if (!result) return;
    const note: Omit<ResearchNote, "id"> = {
      query,
      summary: result.summary,
      details: result.details,
      sources: result.sources,
      uncertain: result.uncertain,
      accessedAt,
      projectId: saveTo.startsWith("p:") ? saveTo.slice(2) : undefined,
      clientId: saveTo.startsWith("c:") ? saveTo.slice(2) : undefined,
    };
    addResearch(note);
    const where = note.projectId
      ? projects.find((p) => p.id === note.projectId)?.name
      : note.clientId
        ? clients.find((c) => c.id === note.clientId)?.name
        : undefined;
    const chosen = result.followUps.filter((_, i) => picked[i]);
    if (chosen.length) {
      const base = sanitizeTaxonomy(
        projects,
        categories,
        note.projectId ?? client?.projectIds[0] ?? "canhan",
        undefined,
      );
      addTriageGroup(
        chosen.map((title) => ({
          title,
          projectId: base.projectId,
          clientId: note.clientId ?? client?.id,
          assignee: "mai",
          source: { channel: "app-chat", quote: `Từ nghiên cứu “${query}”` },
          confidence: 0.7,
        })),
      );
    }
    onDone(
      `🔎 Đã lưu nghiên cứu “${query}”${where ? ` vào ${where}` : ""}${chosen.length ? ` · ${chosen.length} việc tiếp theo đã vào Hộp duyệt` : ""}.`,
    );
  }

  return (
    <div className="parsed cal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="k">Nghiên cứu · nhanh</div>
      <b>{query}</b>
      {state === "running" && <span className="small muted">🌼 Đang tìm và đọc nguồn… (thường dưới một phút)</span>}
      {state === "error" && error && <div className="note-box small">{error}</div>}
      {state === "done" && result && (
        <>
          <span className="small">{result.summary}</span>
          {result.details && (
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>
                Chi tiết
              </summary>
              <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                {result.details}
              </div>
            </details>
          )}
          {result.uncertain && <div className="note-box small">⚠ Chưa chắc: {result.uncertain}</div>}
          <div className="small" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b>Nguồn (truy cập {fmtDayFull(accessedAt)})</b>
            {result.sources.length === 0 && <span className="muted">Không có nguồn — đừng dùng kết quả này.</span>}
            {result.sources.map((s, i) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                [{i + 1}] {s.title}
              </a>
            ))}
          </div>
          {result.followUps.length > 0 && (
            <div className="small" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <b>Việc tiếp theo (vào Hộp duyệt)</b>
              {result.followUps.map((f, i) => (
                <label key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={picked[i] ?? false}
                    onChange={(e) => setPicked((s) => ({ ...s, [i]: e.target.checked }))}
                  />
                  {f}
                </label>
              ))}
            </div>
          )}
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            Lưu vào
            <select className="btn small" aria-label="Lưu nghiên cứu vào" value={saveTo} onChange={(e) => setSaveTo(e.target.value)} style={{ maxWidth: "60%" }}>
              <option value="">— chỉ lưu chung —</option>
              {activeProjects(projects).map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  Dự án {p.name}
                </option>
              ))}
              {clients.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  Khách {c.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary small" onClick={save}>
              Lưu
            </button>
            <button className="btn ghost small" onClick={() => onDone("")}>
              Bỏ
            </button>
          </div>
        </>
      )}
      {state !== "done" && (
        <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => onDone("")}>
          Đóng
        </button>
      )}
    </div>
  );
}
