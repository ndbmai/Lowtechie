"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Blossom } from "@/components/Blossom";
import { Bubble } from "@/components/Bubble";
import { parseCommand } from "@/core/parse";
import { detectProject } from "@/core/parse";
import { projectById } from "@/core/projects";
import type { ParseResult, ParsedAction } from "@/core/types";
import { fmtDayTime, fmtRelativeDay, fmtTime } from "@/lib/format";
import { useSpeech } from "@/lib/speech";
import { useStore } from "@/lib/store";

async function parseViaApi(text: string): Promise<ParseResult> {
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        epochMs: Date.now(),
        tzOffsetMin: new Date().getTimezoneOffset(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ParseResult;
  } catch {
    // Không có API key / mất mạng → bộ luật chạy ngay trên trình duyệt,
    // đúng múi giờ của Mai.
    return parseCommand(text);
  }
}

function ActionCard({ action }: { action: ParsedAction }) {
  const projects = useStore((s) => s.projects);
  if (action.kind === "task") {
    const p = projectById(projects, action.projectId);
    return (
      <div className="parsed" style={{ borderLeftColor: p.color }}>
        <div className="k">Việc mới</div>
        <b>{action.title}</b>
        <div className="small muted">
          {p.name}
          {action.dueAt ? ` · ${fmtRelativeDay(action.dueAt)}` : ""}
          {action.dueType === "hard" ? " · hạn cứng" : ""}
          {action.note ? ` · ${action.note}` : ""}
        </div>
      </div>
    );
  }
  if (action.kind === "event") {
    return (
      <div className="parsed cal">
        <div className="k">{action.durationMinutes && !action.startAt ? "Block cần tìm giờ" : "Lịch mới"}</div>
        <b>{action.title}</b>
        <div className="small muted">
          {action.startAt ? fmtDayTime(action.startAt) : `${action.durationMinutes ?? "?"} phút, chưa chốt giờ`}
          {action.location ? ` · ở ${action.location}` : ""}
          {action.mode ? (action.mode === "car" ? " · đi ô tô" : " · đi tàu") : ""}
        </div>
      </div>
    );
  }
  return (
    <div className="parsed cal">
      <div className="k">Đổi lịch</div>
      <b>{action.what}</b>
      <div className="small muted">
        sang {action.toWhen ? (action.keepTime ? fmtRelativeDay(action.toWhen) : fmtDayTime(action.toWhen)) : "…?"}
        {action.note ? ` · ${action.note}` : ""}
      </div>
    </div>
  );
}

export default function CapturePage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [savedLines, setSavedLines] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { addTask, addEvent, reschedule, setPendingBlock } = useStore();

  const runParse = useCallback(async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    setSavedLines(null);
    const r = await parseViaApi(t.trim());
    setResult(r);
    setBusy(false);
  }, []);

  const onSpeech = useCallback(
    (final: string) => {
      setText(final);
      void runParse(final);
    },
    [runParse],
  );
  const { supported, listening, start, stop } = useSpeech(onSpeech);

  function saveAll() {
    if (!result) return;
    const lines: string[] = [];
    let goCalendar = false;

    for (const a of result.actions) {
      if (a.kind === "task") {
        addTask({
          title: a.title,
          projectId: a.projectId,
          assignee: a.assignee ?? "mai",
          dueAt: a.dueAt,
          dueType: a.dueType,
          estMinutes: undefined,
          source: { channel: "app-chat", quote: text.trim() },
          confidence: a.confidence,
        });
        lines.push(`Đã tạo việc “${a.title}”${a.dueAt ? ` — hạn ${fmtRelativeDay(a.dueAt)}` : ""}.`);
      } else if (a.kind === "event") {
        if (a.startAt) {
          const start = new Date(a.startAt);
          const end = new Date(start.getTime() + (a.durationMinutes ?? 60) * 60_000);
          addEvent({
            title: a.title,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            location: a.location,
            kind: "event",
          });
          lines.push(
            `Đã thêm “${a.title}” lúc ${fmtTime(a.startAt)} ${fmtRelativeDay(a.startAt)}. Vào Lịch để khóa block chuẩn bị + di chuyển${a.mode === "car" ? " (ô tô)" : " (BTS)"}.`,
          );
        } else if (a.durationMinutes) {
          setPendingBlock({
            title: a.title,
            projectId: detectProject(a.title).id,
            durationMinutes: a.durationMinutes,
          });
          lines.push(`“${a.title}” cần ${a.durationMinutes} phút — mình đề xuất khung giờ trong Lịch nhé.`);
          goCalendar = true;
        }
      } else {
        const what = a.what;
        if (a.toWhen) {
          const hit = reschedule(what, a.toWhen, a.keepTime ?? true);
          lines.push(
            hit
              ? `Đã dời “${what}” sang ${fmtRelativeDay(a.toWhen)}${hit === "event" && a.keepTime ? " (giữ giờ cũ)" : ""}.`
              : `Mình chưa tìm thấy “${what}” trong lịch hay danh sách việc — Mai kiểm tra giúp mình nhé.`,
          );
        }
      }
    }

    setSavedLines(lines);
    setResult(null);
    setText("");
    if (goCalendar) router.push("/lich");
  }

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Mai nói đi</h1>
        <span className="muted small">VI · gõ hoặc giữ để nói</span>
      </div>

      <textarea
        ref={inputRef}
        className="transcript"
        placeholder='Ví dụ: "Thứ Ba tuần sau nhắc chị gọi anh Tuấn bên OKR về hợp đồng Circle, rồi dời spa sang thứ Năm nha."'
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn primary"
          style={{ flex: 1, padding: "11px" }}
          disabled={busy || !text.trim()}
          onClick={() => void runParse(text)}
        >
          {busy ? "Đang hiểu…" : "Tách việc"}
        </button>
        {supported ? (
          <button
            className={`blossom-btn${listening ? " listening" : ""}`}
            style={{ margin: 0, flex: "0 0 58px" }}
            onPointerDown={start}
            onPointerUp={stop}
            onPointerLeave={stop}
            aria-pressed={listening}
            aria-label={listening ? "Đang nghe — thả để dừng" : "Giữ để nói"}
          >
            <Blossom size={40} />
          </button>
        ) : (
          <span className="small muted" style={{ maxWidth: 130 }}>
            Trình duyệt này chưa hỗ trợ voice — Mai gõ giúp mình nhé
          </span>
        )}
      </div>
      {listening && <div className="muted small">🌼 Đang nghe… thả tay để mình tách việc.</div>}

      {result && (
        <>
          <div className="muted small">
            Mình hiểu thành {result.actions.length} hành động
            {result.source === "rules" ? " (bộ phân tích trên máy)" : ""}:
          </div>
          {result.actions.map((a, i) => (
            <ActionCard key={i} action={a} />
          ))}
          {result.question && (
            <Bubble>
              {result.question}
              <div className="small muted" style={{ marginTop: 4 }}>
                Mai sửa lại câu ở trên hoặc cứ lưu, chỉnh sau cũng được.
              </div>
            </Bubble>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={saveAll}>
              {result.actions.length > 1 ? `Lưu cả ${result.actions.length}` : "Lưu"}
            </button>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => {
                setResult(null);
                inputRef.current?.focus();
              }}
            >
              Sửa
            </button>
          </div>
        </>
      )}

      {savedLines && (
        <Bubble>
          {savedLines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </Bubble>
      )}

      <p className="muted small" style={{ marginTop: "auto" }}>
        Việc Mai tự giao đi thẳng vào danh sách; việc mình tự trích từ chat sẽ nằm chờ ở Hộp duyệt
        kèm nguồn gốc (PRD §5.2).
      </p>
    </main>
  );
}
