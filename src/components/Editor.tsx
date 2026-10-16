import { useEffect, useRef, useState } from "react";
import { X, ImagePlus, Trash2 } from "lucide-react";
import { kinds, kindLabels, type Card } from "../lib/model";
export function Editor({
  card,
  projectId,
  onSave,
  onClose,
  onDelete,
}: {
  card: Card;
  projectId: string;
  onSave: (card: Card) => Promise<void>;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(card);
  const [status, setStatus] = useState("已保存");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const last = useRef(JSON.stringify(card));
  const saving = useRef<Promise<void> | null>(null);
  const current = useRef(draft);
  current.current = draft;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  function save(): Promise<void> {
    if (saving.current) return saving.current;
    const task = (async () => {
      try {
        while (JSON.stringify(current.current) !== last.current) {
          const value = current.current;
          const encoded = JSON.stringify(value);
          setStatus("保存中");
          await saveRef.current(value);
          last.current = encoded;
        }
        setError("");
        setStatus("已保存");
      } catch (e) {
        setError((e as Error).message);
        setStatus("保存失败");
      }
    })();
    saving.current = task;
    void task.finally(() => {
      saving.current = null;
    });
    return task;
  }
  useEffect(() => {
    if (JSON.stringify(draft) === last.current) return;
    setStatus("等待保存");
    const t = setTimeout(() => void save(), 650);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (JSON.stringify(current.current) !== last.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function close() {
    await save();
    if (JSON.stringify(current.current) === last.current) onClose();
  }
  function update(patch: Partial<Card>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  async function attach(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setDraft((d) => ({ ...d, attachments: [...d.attachments, result.id] }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal card-editor"
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            e.preventDefault();
            void attach(file);
          }
        }}
      >
        <div className="panel-heading">
          <h2>编辑卡片</h2>
          <button
            className="icon-button"
            aria-label="关闭编辑"
            onClick={() => void close()}
          >
            <X size={18} />
          </button>
        </div>
        <div className="kind-picker">
          {kinds.map((kind) => (
            <button
              key={kind}
              className={draft.kind === kind ? "active" : ""}
              onClick={() => update({ kind })}
            >
              {kindLabels[kind]}
            </button>
          ))}
        </div>
        <label>
          标题
          <input
            autoFocus
            value={draft.title}
            maxLength={300}
            placeholder="给这个想法一个名字"
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label>
          内容
          <textarea
            value={draft.body}
            rows={5}
            placeholder="记录想法、事实，或一个值得追问的问题…"
            onChange={(e) => update({ body: e.target.value })}
          />
        </label>
        {draft.kind === "decision" && (
          <label>
            选择理由
            <textarea
              rows={2}
              value={draft.reason}
              onChange={(e) => update({ reason: e.target.value })}
            />
          </label>
        )}
        {(draft.kind === "question" || draft.kind === "task") && (
          <div className="check-row">
            <label>
              <input
                type="checkbox"
                checked={draft.status === "done"}
                onChange={(e) =>
                  update({ status: e.target.checked ? "done" : "open" })
                }
              />
              {draft.kind === "question" ? "问题已解决" : "待办已完成"}
            </label>
            {draft.kind === "question" && (
              <label>
                <input
                  type="checkbox"
                  checked={draft.blocking}
                  onChange={(e) => update({ blocking: e.target.checked })}
                />
                需要先做取舍
              </label>
            )}
          </div>
        )}
        <div className="url-input">
          <input
            aria-label="参考链接"
            placeholder="粘贴参考链接 https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="secondary"
            onClick={() => {
              try {
                const u = new URL(url);
                if (!["https:", "http:"].includes(u.protocol))
                  throw new Error();
                update({ links: [...new Set([...draft.links, u.href])] });
                setUrl("");
              } catch {
                setError("请输入 HTTP(S) 链接");
              }
            }}
          >
            添加
          </button>
        </div>
        {draft.links.map((link) => (
          <div className="attachment-row" key={link}>
            <span>{link}</span>
            <button
              className="icon-button"
              onClick={() =>
                update({ links: draft.links.filter((l) => l !== link) })
              }
              aria-label="移除链接"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="attachment-previews">
          {draft.attachments.map((id) => (
            <div key={id}>
              <img
                src={`/api/projects/${projectId}/attachments/${id}`}
                alt="图片附件"
              />
              <button
                onClick={() =>
                  update({
                    attachments: draft.attachments.filter((a) => a !== id),
                  })
                }
                aria-label="移除图片"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <label className="file-button">
          <ImagePlus size={16} />
          添加图片，或直接粘贴
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) void attach(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => void save()}>重试保存</button>
          </div>
        )}
        <div className="editor-footer">
          <button
            className="danger ghost"
            onClick={async () => {
              await save();
              try {
                await onDelete();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Trash2 size={15} />
            删除卡片
          </button>
          <span>{status}</span>
          <button className="primary" onClick={() => void close()}>
            完成
          </button>
        </div>
      </section>
    </div>
  );
}
