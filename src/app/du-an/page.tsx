"use client";

import Link from "next/link";
import { projectCounts } from "@/core/stats";
import { activeProjects } from "@/core/projects";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";

/**
 * Màn Dự án (§5.3.0 v2.8): CHỈ là lưới ô dự án như thư mục — mỗi dự án
 * một ô chạm được (kể cả Cá nhân, Học tập, Admin chung), mở màn chi
 * tiết bên trong. Không vòng giờ, không danh sách việc ở đây (trùng
 * với Hôm nay — lỗi thấy 23/9).
 */
export default function ProjectsPage() {
  const mounted = useMounted();
  const { tasks, projects } = useStore();
  const live = activeProjects(projects);
  const now = mounted ? new Date() : null;

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Dự án</h1>
        <Link href="/du-an/quan-ly" className="btn small" style={{ textDecoration: "none" }}>
          ⚙️ Quản lý
        </Link>
      </div>

      <div className="pgrid">
        {live.map((p) => {
          const c = now ? projectCounts(tasks, p.id, now) : { open: 0, overdue: 0, due7d: 0 };
          return (
            <Link
              key={p.id}
              href={`/du-an/${p.id}`}
              className="proj"
              style={{
                textDecoration: "none",
                color: "inherit",
                borderTop: `4px solid ${p.color}`,
                display: "block",
              }}
            >
              <b>{p.name}</b>
              <span className="small muted" style={{ display: "block" }}>
                {c.open} việc đang mở
              </span>
              <span className="small" style={{ display: "block", minHeight: 18 }}>
                {c.overdue > 0 && (
                  <span style={{ color: "var(--rose, #FF8FA3)", fontWeight: 600 }}>
                    {c.overdue} quá hạn
                  </span>
                )}
                {c.overdue > 0 && c.due7d > 0 && <span className="muted"> · </span>}
                {c.due7d > 0 && <span className="muted">{c.due7d} hạn 7 ngày</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
