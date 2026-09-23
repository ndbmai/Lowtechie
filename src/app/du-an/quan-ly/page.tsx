"use client";

import Link from "next/link";
import { useState } from "react";
import { clientsFor } from "@/core/clients";
import { categoriesFor, PROJECT_COLORS } from "@/core/projects";
import type { Client, Project } from "@/core/types";
import { useMounted } from "@/lib/hooks";
import { useStore, type MoveDir } from "@/lib/store";

const CLIENT_TYPES: { id: Client["type"]; label: string }[] = [
  { id: "khachhang", label: "khách hàng" },
  { id: "doitac", label: "đối tác" },
  { id: "nhacungcap", label: "nhà cung cấp" },
];
const CLIENT_STATUS: { id: Client["status"]; label: string }[] = [
  { id: "danglam", label: "đang làm" },
  { id: "tiemnang", label: "tiềm năng" },
  { id: "ketthuc", label: "đã kết thúc" },
];

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

/** Cụm nút đổi vị trí: Lên đầu · Lên · Xuống · Xuống cuối (§5.3.1). */
function MoveButtons({ onMove, label }: { onMove: (d: MoveDir) => void; label: string }) {
  const btn = (d: MoveDir, glyph: string, name: string) => (
    <button
      className="btn ghost small"
      style={{ padding: "2px 8px" }}
      aria-label={`${name} ${label}`}
      onClick={() => onMove(d)}
    >
      {glyph}
    </button>
  );
  return (
    <span style={{ display: "inline-flex", gap: 2, marginLeft: "auto" }}>
      {btn("top", "⤒", "Lên đầu")}
      {btn("up", "↑", "Lên")}
      {btn("down", "↓", "Xuống")}
      {btn("bottom", "⤓", "Xuống cuối")}
    </span>
  );
}

/** Chế độ Sắp xếp: đổi thứ tự dự án, category và khách trong từng dự án. */
function SortMode({ onDone }: { onDone: () => void }) {
  const { projects, categories, clients, moveProject, moveCategory, moveClient, setOrders } =
    useStore();
  const [snapshot] = useState(() => ({
    projects: projects.map((p) => p.id),
    categories: categories.map((c) => c.id),
    clients: clients.map((c) => c.id),
  }));

  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={onDone}>
          Xong
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setOrders(snapshot)}>
          Hoàn tác
        </button>
      </div>
      {projects.map((p) => (
        <div key={p.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: p.color, flex: "0 0 12px" }} />
            <b>{p.name}</b>
            <MoveButtons label={p.name} onMove={(d) => moveProject(p.id, d)} />
          </div>
          {categoriesFor(categories, p.id).map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 20 }}>
              <span className="small">{c.name}</span>
              <MoveButtons label={c.name} onMove={(d) => moveCategory(c.id, d)} />
            </div>
          ))}
          {clientsFor(clients, p.id).map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 20 }}>
              <span className="small muted">🤝 {c.name}</span>
              <MoveButtons label={c.name} onMove={(d) => moveClient(c.id, p.id, d)} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function ClientChip({ client, projectId }: { client: Client; projectId: string }) {
  const { projects, updateClient, deleteClient } = useStore();
  const [open, setOpen] = useState(false);
  const [aliasText, setAliasText] = useState(client.aliases.join(", "));

  if (!open) {
    return (
      <span
        className="btn small"
        style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "4px 10px", opacity: client.status === "ketthuc" ? 0.55 : 1 }}
      >
        🤝 {client.name}
        <span className="muted small">{CLIENT_TYPES.find((t) => t.id === client.type)?.label}</span>
        <button
          aria-label={`Sửa ${client.name}`}
          style={{ border: 0, background: "transparent", padding: 0 }}
          onClick={() => {
            setAliasText(client.aliases.join(", "));
            setOpen(true);
          }}
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <div className="note-box" style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <input
        className="transcript"
        style={{ minHeight: 0, padding: 8 }}
        value={client.name}
        aria-label="Tên khách hàng"
        onChange={(e) => updateClient(client.id, { name: e.target.value })}
      />
      <input
        className="transcript"
        style={{ minHeight: 0, padding: 8 }}
        placeholder="Tên gọi tắt, cách gọi khác (phẩy ngăn cách)"
        aria-label="Tên gọi tắt"
        value={aliasText}
        onChange={(e) => setAliasText(e.target.value)}
        onBlur={() => updateClient(client.id, { aliases: aliasText.split(",") })}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select
          className="btn small"
          value={client.type}
          aria-label="Loại"
          onChange={(e) => updateClient(client.id, { type: e.target.value as Client["type"] })}
        >
          {CLIENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="btn small"
          value={client.status}
          aria-label="Trạng thái"
          onChange={(e) => updateClient(client.id, { status: e.target.value as Client["status"] })}
        >
          {CLIENT_STATUS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">Thuộc dự án:</span>
        {projects.map((p) => {
          const on = client.projectIds.includes(p.id);
          return (
            <button
              key={p.id}
              className="btn small"
              aria-pressed={on}
              style={on ? { background: p.color, color: "#fff", borderColor: p.color } : undefined}
              onClick={() =>
                updateClient(client.id, {
                  projectIds: on
                    ? client.projectIds.filter((x) => x !== p.id)
                    : [...client.projectIds, p.id],
                })
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary small" onClick={() => setOpen(false)}>
          Xong
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            if (window.confirm(`Xóa "${client.name}" khỏi danh bạ? Việc đang gắn sẽ bỏ trống ô khách hàng.`))
              deleteClient(client.id);
          }}
        >
          Xóa khỏi danh bạ
        </button>
      </div>
      <span className="muted small">Đang mở từ dự án: {projects.find((p) => p.id === projectId)?.name}</span>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const {
    tasks,
    categories,
    clients,
    projects,
    updateProject,
    deleteProject,
    addCategory,
    renameCategory,
    deleteCategory,
    moveCategoryToProject,
    addClient,
  } = useStore();
  const [newCat, setNewCat] = useState("");
  const [newClient, setNewClient] = useState("");
  const [newClientType, setNewClientType] = useState<Client["type"]>("khachhang");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const others = projects.filter((p) => p.id !== project.id);
  const [moveTo, setMoveTo] = useState<string>("");

  const cats = categoriesFor(categories, project.id);
  const myClients = clientsFor(clients, project.id);
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
              className="note-box"
              style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", width: "100%" }}
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
              {others.length > 0 && (
                <select
                  className="btn small"
                  value=""
                  aria-label={`Chuyển ${c.name} sang dự án khác`}
                  onChange={(e) => {
                    const to = e.target.value;
                    const toName = others.find((p) => p.id === to)?.name;
                    if (
                      to &&
                      window.confirm(
                        `Chuyển category "${c.name}" (kèm việc bên trong) sang "${toName}"?`,
                      )
                    ) {
                      moveCategoryToProject(c.id, to);
                      setEditingCat(null);
                    }
                  }}
                >
                  <option value="">Chuyển sang dự án…</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn ghost small" type="button" onClick={() => setEditingCat(null)}>
                Thôi
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
                aria-label={`Sửa ${c.name}`}
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

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {myClients.map((c) => (
          <ClientChip key={c.id} client={c} projectId={project.id} />
        ))}
        {/* Chữ gợi ý NGẮN để không bị cắt ("+ khách hàng / đối t" — lỗi 22/9);
            form giữ nguyên sau khi Thêm để nhập nhiều tên liên tiếp (v2.8). */}
        <form
          style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (newClient.trim()) addClient(newClient, project.id, newClientType);
            setNewClient("");
          }}
        >
          <input
            className="transcript"
            style={{ minHeight: 0, padding: "4px 8px", width: 150 }}
            placeholder="+ khách hàng"
            aria-label={`Thêm khách hàng / đối tác cho ${project.name}`}
            value={newClient}
            onChange={(e) => setNewClient(e.target.value)}
          />
          {newClient.trim() && (
            <>
              <select
                className="btn small"
                value={newClientType}
                aria-label="Loại khách mới"
                onChange={(e) => setNewClientType(e.target.value as Client["type"])}
              >
                {CLIENT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button className="btn primary small" type="submit">
                Thêm
              </button>
            </>
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
  const [sorting, setSorting] = useState(false);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Quản lý dự án</h1>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {mounted && (
            <button className="btn ghost small" onClick={() => setSorting((v) => !v)}>
              {sorting ? "Thoát sắp xếp" : "Sắp xếp"}
            </button>
          )}
          <Link href="/du-an" className="muted small">
            ← Dự án
          </Link>
        </span>
      </div>

      {mounted && sorting && <SortMode onDone={() => setSorting(false)} />}

      {mounted && !sorting && projects.map((p) => <ProjectCard key={p.id} project={p} />)}

      {mounted && !sorting && (
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
    </main>
  );
}
