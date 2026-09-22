"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Blossom } from "@/components/Blossom";
import { Bubble } from "@/components/Bubble";
import { classify, findDuplicate, learnableTerms, CONFIDENCE_THRESHOLD } from "@/core/classify";
import { detectProject, parseCommand, parseWhen } from "@/core/parse";
import {
  activeProjects,
  categoriesFor,
  categoryName,
  projectById,
  sanitizeTaxonomy,
} from "@/core/projects";
import type {
  Category,
  ImageParseResult,
  ParseResult,
  ParsedAction,
  Project,
  ProjectId,
} from "@/core/types";
import { fmtDayTime, fmtRelativeDay, fmtTime } from "@/lib/format";
import { compressImage } from "@/lib/image";
import { useSpeech } from "@/lib/speech";
import { useStore, type TaskDraft } from "@/lib/store";

async function parseViaApi(
  text: string,
  taxonomy: { projects: Project[]; categories: Category[] },
): Promise<ParseResult> {
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        epochMs: Date.now(),
        tzOffsetMin: new Date().getTimezoneOffset(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Taxonomy thật của Mai — dự án/category tự thêm cũng phân loại được.
        taxonomy: {
          projects: taxonomy.projects.map((p) => ({ id: p.id, name: p.name })),
          categories: taxonomy.categories.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            name: c.name,
          })),
        },
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

interface Resolved {
  projectId: ProjectId;
  categoryId?: string;
  confidence: number;
  alternatives: { projectId: ProjectId; categoryId?: string }[];
}

type Override = { projectId: ProjectId; categoryId?: string };

export default function CapturePage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [merge, setMerge] = useState<Record<number, boolean>>({});
  const [savedLines, setSavedLines] = useState<string[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    tasks,
    projects,
    categories,
    feedback,
    addTask,
    addEvent,
    reschedule,
    setPendingBlock,
    addTriageGroup,
    recordFeedback,
  } = useStore();

  const runParse = useCallback(
    async (t: string) => {
      if (!t.trim()) return;
      setBusy(true);
      setSavedLines(null);
      setOverrides({});
      setMerge({});
      const r = await parseViaApi(t.trim(), { projects, categories });
      setResult(r);
      setBusy(false);
    },
    [projects, categories],
  );

  const onSpeech = useCallback(
    (final: string) => {
      setText(final);
      void runParse(final);
    },
    [runParse],
  );
  const { supported, listening, start, stop } = useSpeech(onSpeech);

  /** Hợp nhất đề xuất của parser/Claude + học từ sửa + override của Mai,
   *  rồi đối chiếu với taxonomy thật (dự án đã xóa → rơi về Cá nhân). */
  const resolveTask = useCallback(
    (a: Extract<ParsedAction, { kind: "task" }>, index: number): Resolved => {
      const clean = (projectId: ProjectId | undefined, categoryId?: string) =>
        sanitizeTaxonomy(projects, categories, projectId, categoryId);
      const o = overrides[index];
      if (o) return { ...clean(o.projectId, o.categoryId), confidence: 1, alternatives: [] };
      const cls = classify(a.title, feedback);
      // Điều Mai đã dạy (feedback) thắng cả đề xuất của parser.
      if (cls.confidence >= 0.9) {
        return { ...clean(cls.projectId, cls.categoryId), confidence: cls.confidence, alternatives: [] };
      }
      const categoryId =
        a.categoryId ?? (cls.projectId === a.projectId ? cls.categoryId : undefined);
      const alternatives = (
        cls.projectId !== a.projectId
          ? [{ projectId: cls.projectId, categoryId: cls.categoryId }, ...cls.alternatives].slice(0, 2)
          : cls.alternatives
      )
        .map((alt) => clean(alt.projectId, alt.categoryId))
        .filter((alt, i, arr) => arr.findIndex((x) => x.projectId === alt.projectId) === i);
      const main = clean(a.projectId, categoryId);
      return {
        ...main,
        confidence: a.confidence,
        alternatives: alternatives.filter((alt) => alt.projectId !== main.projectId),
      };
    },
    [overrides, feedback, projects, categories],
  );

  const taskActions = useMemo(
    () =>
      (result?.actions ?? [])
        .map((a, i) => ({ a, i }))
        .filter((x): x is { a: Extract<ParsedAction, { kind: "task" }>; i: number } => x.a.kind === "task"),
    [result],
  );

  const duplicates = useMemo(() => {
    const m: Record<number, string> = {};
    for (const { a, i } of taskActions) {
      const dup = findDuplicate(a.title, tasks);
      if (dup) m[i] = dup.title;
    }
    return m;
  }, [taskActions, tasks]);

  const summary = useMemo(() => {
    if (!result) return "";
    const byProject = new Map<string, number>();
    for (const { a, i } of taskActions) {
      const r = resolveTask(a, i);
      const name = projectById(projects, r.projectId).name;
      byProject.set(name, (byProject.get(name) ?? 0) + 1);
    }
    const parts: string[] = [];
    if (taskActions.length) {
      const detail = [...byProject.entries()].map(([n, c]) => `${c} ${n}`).join(" · ");
      parts.push(`${taskActions.length} việc mới (${detail})`);
    }
    const events = result.actions.filter((a) => a.kind === "event").length;
    const moves = result.actions.filter((a) => a.kind === "reschedule").length;
    if (events) parts.push(`${events} lịch`);
    if (moves) parts.push(`${moves} đổi lịch`);
    const dupCount = Object.keys(duplicates).length;
    if (dupCount) parts.push(`${dupCount} trùng (đề xuất gộp)`);
    return parts.join(" · ");
  }, [result, taskActions, duplicates, resolveTask, projects]);

  function applyOverride(index: number, title: string, next: Override) {
    setOverrides((s) => ({ ...s, [index]: next }));
    // Học từ sửa đổi: tên riêng trong tiêu đề → dự án/category này (PRD §5.2.1).
    const terms = learnableTerms(title);
    if (terms.length) {
      recordFeedback(
        terms.map((term) => ({ term, projectId: next.projectId, categoryId: next.categoryId })),
      );
    }
  }

  function saveAll() {
    if (!result) return;
    const lines: string[] = [];
    let goCalendar = false;

    result.actions.forEach((a, i) => {
      if (a.kind === "task") {
        if (duplicates[i] && (merge[i] ?? true)) {
          lines.push(`“${a.title}” trùng với việc đang có — mình gộp, không tạo mới.`);
          return;
        }
        const r = resolveTask(a, i);
        addTask({
          title: a.title,
          projectId: r.projectId,
          categoryId: r.categoryId,
          assignee: a.assignee ?? "mai",
          dueAt: a.dueAt,
          dueType: a.dueType,
          estMinutes: undefined,
          source: { channel: "app-chat", quote: text.trim() },
          confidence: a.confidence,
        });
        lines.push(`Đã tạo “${a.title}”${a.dueAt ? ` — hạn ${fmtRelativeDay(a.dueAt)}` : ""}.`);
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
      } else if (a.toWhen) {
        const hit = reschedule(a.what, a.toWhen, a.keepTime ?? true);
        lines.push(
          hit
            ? `Đã dời “${a.what}” sang ${fmtRelativeDay(a.toWhen)}${hit === "event" && a.keepTime ? " (giữ giờ cũ)" : ""}.`
            : `Mình chưa tìm thấy “${a.what}” trong lịch hay danh sách việc — Mai kiểm tra giúp mình nhé.`,
        );
      }
    });

    setSavedLines(lines);
    setResult(null);
    setText("");
    if (goCalendar) router.push("/lich");
  }

  async function pickImages(files: FileList | null) {
    if (!files?.length) return;
    setImgError(null);
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        out.push(await compressImage(f));
      } catch {
        setImgError("Có ảnh không đọc được, mình bỏ qua ảnh đó.");
      }
    }
    setImages((s) => [...s, ...out].slice(0, 4));
  }

  async function runImageParse() {
    if (!images.length) return;
    setImgBusy(true);
    setImgError(null);
    try {
      const res = await fetch("/api/parse-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images,
          caption: text.trim(),
          epochMs: Date.now(),
          tzOffsetMin: new Date().getTimezoneOffset(),
          taxonomy: {
            projects: projects.map((p) => ({ id: p.id, name: p.name })),
            categories: categories.map((c) => ({
              id: c.id,
              projectId: c.projectId,
              name: c.name,
            })),
          },
        }),
      });
      if (res.status === 501) {
        setImgError(
          "Đọc ảnh cần Claude API — Mai thêm ANTHROPIC_API_KEY vào server (Vercel → Settings → Environment Variables), Redeploy, rồi thử lại nhé. Phần chat/voice vẫn chạy không cần key.",
        );
        return;
      }
      if (res.status === 413) {
        setImgError("Ảnh nặng quá cho server — Mai bỏ bớt, gửi 1–2 ảnh một lần nhé.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        setImgError(
          `Đọc ảnh không thành công (mã ${res.status}${body?.detail ? ` — ${body.detail}` : ""}). Mai chụp màn hình lỗi này gửi mình là mình biết đường sửa.`,
        );
        return;
      }
      const data = (await res.json()) as ImageParseResult;

      const caption = text.trim();
      const capProject = caption ? detectProject(caption) : { id: "canhan" as ProjectId, explicit: false };
      const capWhen = caption ? parseWhen(caption, new Date()) : { at: undefined, hasTime: false, spans: [] };
      const active = data.items.filter((it) => !it.done);
      const skipped = data.items.length - active.length;

      const drafts: TaskDraft[] = active.map((it) => {
        const cls = classify(it.title, feedback);
        const rawProject = capProject.explicit ? capProject.id : (it.projectId ?? cls.projectId);
        const rawCategory =
          it.categoryId ?? (cls.projectId === rawProject ? cls.categoryId : undefined);
        const { projectId, categoryId } = sanitizeTaxonomy(
          projects,
          categories,
          rawProject,
          rawCategory,
        );
        return {
          title: it.title,
          projectId,
          categoryId,
          assignee: it.assignee ?? "mai",
          dueAt: it.dueAt ?? capWhen.at?.toISOString(),
          dueType: it.dueAt || capWhen.at ? "soft" : undefined,
          estMinutes: undefined,
          source: {
            channel: "app-chat",
            quote: `Từ ảnh${it.group ? ` · mục "${it.group}"` : ""}${caption ? ` — "${caption}"` : ""}`,
          },
          confidence: it.confidence,
        };
      });

      if (drafts.length === 0) {
        setImgError(
          skipped > 0
            ? `Cả ${skipped} mục trong ảnh đều đã tick xong — không có việc mới.`
            : "Mình không đọc được dòng việc nào trong ảnh.",
        );
        return;
      }

      addTriageGroup(drafts, images[0]);
      setImages([]);
      setText("");
      setSavedLines([
        `${drafts.length} việc từ ảnh đã vào Hộp duyệt${skipped ? ` (bỏ qua ${skipped} mục đã tick)` : ""}.`,
      ]);
      router.push("/hop-duyet");
    } catch {
      setImgError("Không gửi được ảnh lên server (mạng chập chờn?) — Mai thử lại giúp mình nhé.");
    } finally {
      setImgBusy(false);
    }
  }

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Mai nói đi</h1>
        <span className="muted small">VI · gõ, nói hoặc gửi ảnh</span>
      </div>

      <textarea
        ref={inputRef}
        className="transcript"
        placeholder='Ví dụ: "Thứ Ba tuần sau nhắc chị gọi anh Tuấn bên OKR về hợp đồng Circle, rồi dời spa sang thứ Năm nha." — hoặc chọn ảnh rồi ghi chú "việc của Favstay, hạn thứ Sáu".'
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
        <button
          className="btn"
          style={{ padding: "11px 13px" }}
          onClick={() => fileRef.current?.click()}
          aria-label="Gửi ảnh checklist"
        >
          📷 Ảnh
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void pickImages(e.target.files);
            e.target.value = "";
          }}
        />
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
        ) : null}
      </div>
      {listening && <div className="muted small">🌼 Đang nghe… thả tay để mình tách việc.</div>}

      {images.length > 0 && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {images.map((src, i) => (
              <span key={i} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Ảnh ${i + 1}`}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10 }}
                />
                <button
                  className="btn small"
                  style={{ position: "absolute", top: -6, right: -6, padding: "0 7px" }}
                  aria-label="Bỏ ảnh"
                  onClick={() => setImages((s) => s.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="muted small">
            Lời nhắn ở ô trên (nếu có) áp cho cả danh sách — ví dụ “việc của Favstay, hạn thứ Sáu”.
          </div>
          <button className="btn primary" disabled={imgBusy} onClick={() => void runImageParse()}>
            {imgBusy ? "Đang đọc ảnh…" : `Trích việc từ ${images.length} ảnh → Hộp duyệt`}
          </button>
        </div>
      )}
      {imgError && <div className="note-box">{imgError}</div>}

      {result && (
        <>
          {summary && <div className="muted small">{summary}:</div>}
          {result.actions.map((a, i) => {
            if (a.kind !== "task") {
              return a.kind === "event" ? (
                <div className="parsed cal" key={i}>
                  <div className="k">{a.durationMinutes && !a.startAt ? "Block cần tìm giờ" : "Lịch mới"}</div>
                  <b>{a.title}</b>
                  <div className="small muted">
                    {a.startAt ? fmtDayTime(a.startAt) : `${a.durationMinutes ?? "?"} phút, chưa chốt giờ`}
                    {a.location ? ` · ở ${a.location}` : ""}
                    {a.mode ? (a.mode === "car" ? " · đi ô tô" : " · đi tàu") : ""}
                  </div>
                </div>
              ) : (
                <div className="parsed cal" key={i}>
                  <div className="k">Đổi lịch</div>
                  <b>{a.what}</b>
                  <div className="small muted">
                    sang {a.toWhen ? (a.keepTime ? fmtRelativeDay(a.toWhen) : fmtDayTime(a.toWhen)) : "…?"}
                    {a.note ? ` · ${a.note}` : ""}
                  </div>
                </div>
              );
            }

            const r = resolveTask(a, i);
            const p = projectById(projects, r.projectId);
            const cat = categoryName(categories, r.categoryId);
            const pastDue = a.dueAt && new Date(a.dueAt).getTime() < Date.now();
            return (
              <div className="parsed" style={{ borderLeftColor: p.color }} key={i}>
                <div className="k">Việc mới</div>
                <b>{a.title}</b>
                <div className="small muted">
                  {a.dueAt ? `${fmtRelativeDay(a.dueAt)}` : "chưa có hạn"}
                  {a.dueType === "hard" ? " · hạn cứng" : ""}
                  {a.note ? ` · ${a.note}` : ""}
                  {pastDue ? " · ⚠ hạn đã qua, kiểm tra lại?" : ""}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                  <span className="chip" style={{ background: p.color }}>
                    {p.name}
                  </span>
                  {cat && <span className="small muted">{cat}</span>}
                  {r.confidence < CONFIDENCE_THRESHOLD && (
                    <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 8px" }}>
                      chưa chắc
                    </span>
                  )}
                  {r.alternatives.map((alt) => {
                    const ap = projectById(projects, alt.projectId);
                    return (
                      <button
                        key={alt.projectId + (alt.categoryId ?? "")}
                        className="btn small"
                        style={{ padding: "3px 10px" }}
                        onClick={() => applyOverride(i, a.title, alt)}
                      >
                        → {ap.name}
                        {categoryName(categories, alt.categoryId)
                          ? ` · ${categoryName(categories, alt.categoryId)}`
                          : ""}
                      </button>
                    );
                  })}
                  <select
                    className="btn small"
                    style={{ padding: "3px 8px", maxWidth: 140 }}
                    aria-label="Chọn dự án / category"
                    value={`${r.projectId}|${r.categoryId ?? ""}`}
                    onChange={(e) => {
                      const [projectId, categoryId] = e.target.value.split("|");
                      applyOverride(i, a.title, {
                        projectId: projectId as ProjectId,
                        categoryId: categoryId || undefined,
                      });
                    }}
                  >
                    {activeProjects(projects).map((pr) => {
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
                </div>
                {duplicates[i] && (
                  <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "6px 10px" }}>
                    <input
                      type="checkbox"
                      className="check"
                      checked={merge[i] ?? true}
                      onChange={(e) => setMerge((s) => ({ ...s, [i]: e.target.checked }))}
                    />
                    Giống việc đang có: “{duplicates[i]}” — gộp, không tạo mới
                  </label>
                )}
              </div>
            );
          })}
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
              Sửa câu
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

      {!supported && (
        <p className="muted small">Trình duyệt này chưa hỗ trợ voice — Mai gõ hoặc gửi ảnh nhé.</p>
      )}
      <p className="muted small" style={{ marginTop: "auto" }}>
        Sửa dự án/category một chạm là mình nhớ cho lần sau (PRD §5.2.1). Việc từ ảnh và chat nhóm
        luôn nằm chờ ở Hộp duyệt kèm nguồn gốc.
      </p>
    </main>
  );
}
