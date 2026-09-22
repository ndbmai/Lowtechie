"use client";

import Link from "next/link";
import { useState } from "react";
import { categoriesFor, PROJECT_COLORS } from "@/core/projects";
import type { Project } from "@/core/types";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (c: string) => void;
  label: string;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }} role="radiogroup" aria-label={label}>
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          aria-pressed={value === c}
          aria-label={`Màu ${c}`}
          onClick={() => onChange(c)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 7,
            background: c,
            border: value === c ? "2.5px solid var(--ink)" : "2px solid transparent",
            padding: 0,
          }}
        />
      ))}
    </span>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const {
    tasks,
    categories,
    projects,
    updateProject,
    deleteProject,
    addCategory,
    renameCategory,
    deleteCategory,
  } = useStore();
  const [newCat, setNewCat] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const others = projects.filter((p) => p.id !== project.id);
  const [moveTo, setMoveTo] = useState<string>("");

  const cats = categoriesFor(categories, project.id);
  const openCount = tasks.filter(
    (t) => t.projectId === project.id && (t.status === "todo" || t.status === "doing"),
  ).length;
  const archived = project.status === "archived";

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 8, opacity: archived ? 0.65 : 1 }}
    >
      {archived && (
        <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 10px", alignSelf: "flex-start" }}>
          Đang tạm ngưng — ẩn khỏi Hôm nay, Dự án và review
        </span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="transcript"
          style={{ minHeight: 0, padding: 8, flex: 1, minWidth: 120, fontWeight: 600 }}
          value={project.name}
          aria-label="Tên dự án"
          onChange={(e) => updateProject(project.id, { name: e.target.value })}
        />
        <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            min={0}
            max={60}
            value={project.targetHoursPerWeek}
            aria-label="Mục tiêu giờ mỗi tuần"
            onChange={(e) =>
              updateProject(project.id, {
                targetHoursPerWeek: Math.max(0, Number(e.target.value) || 0),
              })
            }
            style={{ width: 52, padding: "5px 7px", borderRadius: 9, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
          />
          h/tuần
        </label>
        <button
          className="btn ghost small"
          onClick={() =>
            updateProject(project.id, { status: archived ? "active" : "archived" })
          }
        >
          {archived ? "Mở lại" : "Tạm ngưng"}
        </button>
        {projects.length > 1 && !deleting && (
          <button className="btn ghost small" onClick={() => setDeleting(true)}>
            Xóa
          </button>
        )}
      </div>

      {deleting && (
        <div className="note-box" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="small">
            {openCount > 0
              ? `${openCount} việc đang mở của "${project.name}" chuyển sang:`
              : `Xóa "${project.name}"? Việc cũ (nếu có) chuyển sang:`}
          </span>
          <select
            className="btn small"
            value={moveTo}
            aria-label="Chuyển việc sang dự án"
            onChange={(e) => setMoveTo(e.target.value)}
          >
            <option value="">— chọn dự án —</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn primary small"
            disabled={!moveTo}
            onClick={() => deleteProject(project.id, moveTo)}
          >
            Xác nhận xóa
          </button>
          <button className="btn ghost small" onClick={() => setDeleting(false)}>
            Thôi
          </button>
        </div>
      )}
      <ColorPicker
        value={project.color}
        onChange={(c) => updateProject(project.id, { color: c })}
        label={`Màu của ${project.name}`}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {cats.map((c) =>
          editingCat === c.id ? (
            <form
              key={c.id}
              style={{ display: "inline-flex", gap: 4 }}
              onSubmit={(e) => {
                e.preventDefault();
                renameCategory(c.id, catName);
                setEditingCat(null);
              }}
            >
              <input
                className="transcript"
                style={{ minHeight: 0, padding: "4px 8px", width: 140 }}
                value={catName}
                autoFocus
                aria-label="Đổi tên category"
                onChange={(e) => setCatName(e.target.value)}
              />
              <button className="btn primary small" type="submit">
                Lưu
              </button>
            </form>
          ) : (
            <span
              key={c.id}
              className="btn small"
              style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "4px 10px" }}
            >
              {c.name}
              <button
                aria-label={`Đổi tên ${c.name}`}
                style={{ border: 0, background: "transparent", padding: 0 }}
                onClick={() => {
                  setEditingCat(c.id);
                  setCatName(c.name);
                }}
              >
                ✎
              </button>
              <button
                aria-label={`Xóa ${c.name}`}
                style={{ border: 0, background: "transparent", padding: 0, color: "var(--ink-2)" }}
                onClick={() => {
                  if (window.confirm(`Xóa category "${c.name}"? Việc đang gắn sẽ chỉ còn dự án.`))
                    deleteCategory(c.id);
                }}
              >
                ×
              </button>
            </span>
          ),
        )}
        <form
          style={{ display: "inline-flex", gap: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) addCategory(project.id, newCat);
            setNewCat("");
          }}
        >
          <input
            className="transcript"
            style={{ minHeight: 0, padding: "4px 8px", width: 130 }}
            placeholder="+ category mới"
            aria-label={`Thêm category cho ${project.name}`}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          {newCat.trim() && (
            <button className="btn primary small" type="submit">
              Thêm
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function ManageProjectsPage() {
  const mounted = useMounted();
  const { projects, addProject } = useStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[2]);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Quản lý dự án</h1>
        <Link href="/du-an" className="muted small">
          ← Dự án
        </Link>
      </div>
      <p className="muted small">
        Đổi tên, màu, mục tiêu giờ/tuần và category của từng dự án. Xóa dự án thì việc đang mở
        chuyển sang Cá nhân — không mất gì.
      </p>

      {mounted && projects.map((p) => <ProjectCard key={p.id} project={p} />)}

      {mounted && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b>Thêm dự án mới</b>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: 9 }}
            placeholder="Tên dự án (ví dụ: Tuyển dụng)"
            aria-label="Tên dự án mới"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ColorPicker value={color} onChange={setColor} label="Màu dự án mới" />
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => {
              addProject(name, color);
              setName("");
            }}
          >
            Thêm dự án
          </button>
        </div>
      )}

      <p className="muted small">
        Mẹo: sửa phân loại ngay trên thẻ xác nhận khi giao việc — mình nhớ và lần sau tự xếp
        đúng dự án mới của Mai (PRD §5.2.1).
      </p>
    </main>
  );
}
