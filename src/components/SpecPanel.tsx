import { useEffect, useRef, useState } from "react";
import {
  X,
  Download,
  History,
  FileText,
  Pencil,
  RotateCcw,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/client";
import type { Spec } from "../lib/model";
export function SpecPanel({
  projectId,
  spec,
  projectRevision,
  onClose,
  onSaved,
  onDirty,
}: {
  projectId: string;
  spec: Spec;
  projectRevision: number;
  onClose: () => void;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState(spec.content);
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState("已保存");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<
    { id: string; content: string; reason: string; createdAt: string }[] | null
  >(null);
  const revision = useRef(spec.revision);
  const last = useRef(spec.content);
  const latest = useRef(content);
  latest.current = content;
  const busy = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (spec.revision !== revision.current && latest.current === last.current) {
      revision.current = spec.revision;
      last.current = spec.content;
      setContent(spec.content);
    }
  }, [spec]);
  function save(): Promise<void> {
    if (busy.current) return busy.current;
    const task = (async () => {
      try {
        while (latest.current !== last.current) {
          setStatus("保存中");
          const value = latest.current;
          const next = await api<Spec>(`projects/${projectId}/spec`, {
            content: value,
            revision: revision.current,
          });
          revision.current = next.revision;
          last.current = value;
        }
        setStatus("已保存");
        setError("");
        onSaved();
      } catch (e) {
        setStatus("保存失败");
        setError((e as Error).message);
      } finally {
        onDirty(latest.current !== last.current);
      }
    })();
    busy.current = task;
    void task.finally(() => {
      busy.current = null;
    });
    return task;
  }
  useEffect(() => {
    const dirty = content !== last.current;
    onDirty(dirty);
    if (!dirty) return;
    setStatus("等待保存");
    const t = setTimeout(() => void save(), 800);
    return () => clearTimeout(t);
  }, [content]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (latest.current !== last.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function close() {
    await save();
    if (latest.current === last.current) {
      onDirty(false);
      onClose();
    }
  }
  return (
    <section className="spec-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROJECT DOCUMENT</span>
          <h2>
            <FileText size={19} />
            项目 Spec
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭 spec"
          onClick={() => void close()}
        >
          <X size={19} />
        </button>
      </div>
      <div className="spec-toolbar">
        <button
          className={edit ? "secondary active" : "secondary"}
          onClick={() => setEdit(!edit)}
        >
          <Pencil size={14} />
          {edit ? "预览" : "编辑"}
        </button>
        <button
          className="secondary"
          onClick={() =>
            api<typeof history>(`projects/${projectId}/snapshots`)
              .then(setHistory)
              .catch((e) => setError(e.message))
          }
        >
          <History size={14} />
          恢复记录
        </button>
        <a
          className="secondary"
          href={`/api/projects/${projectId}/export`}
          download="spec.md"
        >
          <Download size={14} />
          导出
        </a>
        <span>{status}</span>
      </div>
      {spec.content && spec.sourceRevision !== projectRevision && (
        <div className="spec-notice">画布已有变化，spec 可能需要更新。</div>
      )}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => void save()}>重试</button>
        </div>
      )}
      {history ? (
        <div className="history-list">
          <button className="ghost" onClick={() => setHistory(null)}>
            ← 返回文档
          </button>
          {!history.length && <p>更新或恢复 spec 前，会自动保留一份记录。</p>}
          {history.map((s) => (
            <div className="history-entry" key={s.id}>
              <strong>{s.reason}</strong>
              <small>{new Date(s.createdAt).toLocaleString("zh-CN")}</small>
              <pre>{s.content.slice(0, 240)}…</pre>
              <button
                className="secondary"
                onClick={async () => {
                  await save();
                  if (latest.current !== last.current) return;
                  try {
                    const next = await api<Spec>(
                      `projects/${projectId}/restore`,
                      { snapshotId: s.id, revision: revision.current },
                    );
                    last.current = next.content;
                    revision.current = next.revision;
                    setContent(next.content);
                    setHistory(null);
                    onSaved();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <RotateCcw size={13} />
                恢复这一份
              </button>
            </div>
          ))}
        </div>
      ) : edit ? (
        <textarea
          className="spec-editor"
          aria-label="Spec 正文"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      ) : (
        <article className="markdown spec-body">
          {content ? (
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          ) : (
            <div className="spec-empty">
              <FileText size={32} />
              <h3>让讨论成为下一步</h3>
              <p>先和 AI 澄清项目想法，再点击顶部的「生成 spec」。</p>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
