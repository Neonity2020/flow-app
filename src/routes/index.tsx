import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowUpRight,
  Plus,
  Sparkles,
  Layers,
  MoreHorizontal,
  ArrowRight,
} from "lucide-react";
import { api } from "../lib/client";
import type { Project } from "../lib/model";
export const Route = createFileRoute("/")({ component: Projects });
function Projects() {
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("projects"),
  });
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = await api<Project>("projects", {
        id: crypto.randomUUID(),
        name: name.trim(),
      });
      await client.invalidateQueries({ queryKey: ["projects"] });
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: p.id },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: Project) {
    if (!confirm(`删除「${p.name}」及其全部内容？此操作无法撤销。`)) return;
    try {
      await api(`projects/${p.id}/delete`, {});
      await query.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="project-page">
      <header className="home-header">
        <Link to="/" className="brand">
          <span className="brand-mark">f</span>flow
          <span className="brand-tag">THINKING SPACE</span>
        </Link>
        <span className="local-pill">
          <i /> 本地工作空间
        </span>
      </header>
      <main className="projects-main">
        <div className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</div>
        <div className="home-title">
          <div>
            <h1>
              让想法，慢慢成形<span>。</span>
            </h1>
            <p>放下一个念头，问一个好问题。和 AI 一起，把下一步想清楚。</p>
          </div>
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={17} />
            新建项目
          </button>
        </div>
        <div className="section-heading">
          <h2>
            我的项目 <span>{query.data?.length || 0}</span>
          </h2>
          <span>从一个问题开始</span>
        </div>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {query.isLoading ? (
          <div className="empty-state">正在打开工作空间…</div>
        ) : query.isError ? (
          <div className="empty-state">
            {query.error.message}
            <button onClick={() => query.refetch()}>重试</button>
          </div>
        ) : (
          <div className="project-grid">
            {query.data?.map((p, i) => (
              <article className="project-tile" key={p.id}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="project-link"
                >
                  <div className={`tile-art art-${i % 3}`}>
                    <div className="mini-note note-one" />
                    <div className="mini-line" />
                    <div className="mini-note note-two" />
                    <div className="mini-note note-three" />
                    <span className="tile-open">
                      <ArrowUpRight size={20} />
                    </span>
                  </div>
                  <div className="tile-info">
                    <h3>{p.name}</h3>
                    <p>
                      {p.count} 张卡片<span>·</span>
                      {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                </Link>
                <button
                  className="tile-menu icon-button"
                  aria-label={`删除 ${p.name}`}
                  title="删除项目"
                  onClick={() => remove(p)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </article>
            ))}
            <button
              className="new-project-tile"
              onClick={() => setCreating(true)}
            >
              <span className="new-circle">
                <Plus size={22} />
              </span>
              <strong>一个新想法</strong>
              <span>给还没想清楚的事，留一点空间</span>
            </button>
          </div>
        )}
        <div className="home-note">
          <Sparkles size={17} />
          <span>不急着找答案。先找到值得回答的问题。</span>
        </div>
      </main>
      <footer className="home-footer">
        <span>
          <Layers size={14} /> 你的想法，保存在你的设备上。
        </span>
        <span>FLOW / 01</span>
      </footer>
      {creating && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreating(false);
          }}
        >
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <span className="eyebrow">NEW SPACE</span>
            <h2>你想探索什么？</h2>
            <p>先给它一个名字，之后随时可以修改。</p>
            <input
              autoFocus
              aria-label="项目名称"
              placeholder="比如：一个更好的白板笔记工具"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button className="primary" disabled={!name.trim() || busy}>
                创建项目 <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
