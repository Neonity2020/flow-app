import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  Lightbulb,
  ListTodo,
  MessageSquare,
  PanelRightClose,
  Plus,
  Redo2,
  Sparkles,
  Square,
  Undo2,
  X,
  Maximize2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/client";
import {
  newCard,
  type Card,
  type Kind,
  type Operation,
  type Workspace as WorkspaceData,
  type Run,
} from "../lib/model";
import { CanvasCard, type FlowCard } from "./CanvasCard";
import { Editor } from "./Editor";
import { SpecPanel } from "./SpecPanel";
const nodeTypes = { card: CanvasCard };
const starterQuestions = [
  "帮我把一个模糊的项目想法问清楚",
  "挑战一下这个项目的核心假设",
  "我们现在最需要做什么取舍？",
];
export function Workspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const key = ["workspace", projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<WorkspaceData>(`projects/${projectId}`),
  });
  const codex = useQuery({
    queryKey: ["codex"],
    queryFn: () => api<{ state: string; message: string }>("codex"),
    staleTime: 30000,
  });
  const w = query.data;
  const wRef = useRef(w);
  wRef.current = w;
  const [nodes, setNodes] = useState<FlowCard[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const selectedRef = useRef<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<FlowCard, Edge> | null>(
    null,
  );
  const [editor, setEditor] = useState<Card | null>(null);
  const [conversation, setConversation] = useState(
    () => typeof window === "undefined" || window.innerWidth > 800,
  );
  const [specOpen, setSpecOpen] = useState(false);
  const [specDirty, setSpecDirty] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("已保存");
  const [stream, setStream] = useState("");
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const queue = useRef(Promise.resolve());
  const [mutating, setMutating] = useState(false);
  const pending = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const running = w?.run?.status === "running";
  const runId = w?.run?.id;
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["workspace", projectId] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  }, [client, projectId]);
  function accept(next: WorkspaceData) {
    wRef.current = next;
    client.setQueryData(key, next);
    void client.invalidateQueries({ queryKey: ["projects"] });
  }
  useEffect(() => {
    if (!w) return;
    setNodes((previous) =>
      w.canvas.nodes.map((n) => ({
        id: n.id,
        type: "card",
        position: { x: n.x, y: n.y },
        data: { ...n, projectId },
        selected: previous.find((p) => p.id === n.id)?.selected || false,
      })),
    );
    setEdges(
      w.canvas.edges.map((e) => ({
        ...e,
        type: "smoothstep",
        style: { stroke: "#b9b6ca", strokeWidth: 1.5 },
      })),
    );
  }, [w?.canvas, projectId]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [w?.messages.length, stream]);
  useEffect(() => {
    if (!runId || !running) return;
    setStream("");
    let lastSequence = 0;
    const events = new EventSource(
      `/api/projects/${projectId}/events?runId=${runId}`,
    );
    events.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      if (event.type === "message.delta")
        setStream((value) => value + event.payload.text);
      if (event.type === "message.reset") setStream("");
      if (event.type === "operations.committed") refresh();
      if (event.type === "spec.committed") {
        setSpecOpen(true);
        refresh();
      }
      if (
        ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
      ) {
        events.close();
        setStream("");
        refresh();
      }
    };
    events.onerror = () => {
      void query.refetch().then((result) => {
        if (result.data?.run?.status !== "running") events.close();
      });
    };
    return () => events.close();
  }, [runId, running, projectId, refresh]);
  function apply(operations: Operation[]): Promise<void> {
    let failed = false;
    pending.current++;
    setMutating(true);
    setSaveStatus("保存中");
    const task = queue.current
      .catch(() => {})
      .then(async () => {
        if (!wRef.current) throw new Error("项目尚未加载");
        const result = await api<WorkspaceData>(
          `projects/${projectId}/operations`,
          {
            batchId: crypto.randomUUID(),
            revision: wRef.current.project.revision,
            operations,
          },
        );
        accept(result);
        setError("");
      });
    queue.current = task;
    return task
      .catch((e) => {
        failed = true;
        setError(e.message);
        setSaveStatus("保存失败");
        refresh();
        throw e;
      })
      .finally(() => {
        pending.current--;
        if (!pending.current) {
          setMutating(false);
          if (!failed) setSaveStatus("已保存");
        }
      });
  }
  async function add(kind: Kind) {
    setAdding(false);
    if (!flow) return;
    const rect = document
      .querySelector(".canvas-stage")!
      .getBoundingClientRect();
    const p = flow.screenToFlowPosition({
      x: rect.left + rect.width / 2 - 140,
      y: rect.top + rect.height / 2 - 100,
    });
    const card = newCard(kind, p.x, p.y);
    try {
      await apply([{ type: "node.create", node: card }]);
      setEditor(card);
    } catch {}
  }
  async function send(kind: "chat" | "spec" = "chat", message = input) {
    if (
      starting ||
      running ||
      mutating ||
      specDirty ||
      !w ||
      (kind === "chat" && !message.trim())
    )
      return;
    setStarting(true);
    setError("");
    setConversation(true);
    try {
      await api<Run>(
        `projects/${projectId}/${kind === "chat" ? "chat" : "generate"}`,
        {
          requestId: crypto.randomUUID(),
          message,
          selected: kind === "chat" ? selected : [],
        },
      );
      if (kind === "chat") setInput("");
      await query.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function travel(direction: "undo" | "redo") {
    if (mutating || !wRef.current) return;
    try {
      accept(
        await api<WorkspaceData>(`projects/${projectId}/${direction}`, {
          revision: wRef.current.project.revision,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"]',
        ) ||
        editor ||
        specOpen
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void travel(e.shiftKey ? "redo" : "undo");
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [mutating, editor, specOpen]);
  if (query.isLoading)
    return (
      <main className="fallback">
        <div className="brand-mark">f</div>
        <p>正在打开思考空间…</p>
      </main>
    );
  if (!w)
    return (
      <main className="fallback">
        <h2>无法打开项目</h2>
        <p>{query.error?.message}</p>
        <Link to="/">返回项目列表</Link>
      </main>
    );
  return (
    <div className="workspace">
      <header className="workspace-header">
        <div className="workspace-title">
          <Link to="/" className="icon-button" aria-label="返回项目">
            <ArrowLeft size={17} />
          </Link>
          <span className="brand-mark small">f</span>
          <button
            className="project-name"
            onClick={async () => {
              const name = prompt("项目名称", w.project.name);
              if (name?.trim()) {
                try {
                  await api(`projects/${projectId}/rename`, { name });
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }
            }}
          >
            {w.project.name}
            <ChevronDown size={13} />
          </button>
          <span className="header-divider" />
          <span className="save-indicator">
            <Check size={12} />
            {saveStatus}
          </span>
        </div>
        <div className="header-actions">
          <button
            className={`secondary ${specOpen ? "active" : ""}`}
            onClick={() => {
              if (!specOpen) setSpecOpen(true);
            }}
          >
            <FileText size={15} />
            Spec
          </button>
          <button
            className="primary"
            onClick={() => void send("spec")}
            disabled={running || starting || mutating || specDirty}
          >
            <Sparkles size={15} />
            {w.spec.content ? "更新 spec" : "生成 spec"}
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <div className="canvas-stage">
          <ReactFlow<FlowCard, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              setFlow(instance);
              const v = localStorage.getItem(`flow:viewport:${projectId}`);
              if (v) {
                try {
                  void instance.setViewport(JSON.parse(v));
                } catch {}
              } else if (w.canvas.nodes.length)
                void instance.fitView({ padding: 0.3, maxZoom: 1 });
            }}
            onNodesChange={(changes) =>
              setNodes((n) =>
                applyNodeChanges(
                  changes.filter((c) => c.type !== "remove"),
                  n,
                ),
              )
            }
            onEdgesChange={(changes) =>
              setEdges((e) =>
                applyEdgeChanges(
                  changes.filter((c) => c.type !== "remove"),
                  e,
                ),
              )
            }
            onNodeDragStop={(_, __, dragged) => {
              void apply(
                dragged.map((n) => ({
                  type: "node.update",
                  id: n.id,
                  patch: { x: n.position.x, y: n.position.y },
                })),
              ).catch(() => {});
            }}
            onSelectionChange={({ nodes: selection }) => {
              const ids = selection.map((n) => n.id);
              selectedRef.current = ids;
              setSelected(ids);
            }}
            onNodeDoubleClick={(_, node) =>
              setEditor(
                wRef.current?.canvas.nodes.find((n) => n.id === node.id) ||
                  null,
              )
            }
            onEdgeDoubleClick={(_, edge) => {
              const label = prompt("关系描述", String(edge.label || ""));
              if (label !== null)
                void apply([{ type: "edge.update", id: edge.id, label }]).catch(
                  () => {},
                );
            }}
            onConnect={(connection) => {
              if (connection.source && connection.target)
                void apply([
                  {
                    type: "edge.create",
                    edge: {
                      id: crypto.randomUUID(),
                      source: connection.source,
                      target: connection.target,
                      label: "",
                    },
                  },
                ]).catch(() => {});
            }}
            onBeforeDelete={async ({ nodes: deleted, edges: deletedEdges }) => {
              const ids = new Set(deleted.map((n) => n.id));
              const ops: Operation[] = [
                ...deletedEdges
                  .filter((e) => !ids.has(e.source) && !ids.has(e.target))
                  .map((e) => ({ type: "edge.delete" as const, id: e.id })),
                ...deleted.map((n) => ({
                  type: "node.delete" as const,
                  id: n.id,
                })),
              ];
              if (ops.length) await apply(ops).catch(() => {});
              return false;
            }}
            onMoveEnd={(_, viewport) =>
              localStorage.setItem(
                `flow:viewport:${projectId}`,
                JSON.stringify(viewport),
              )
            }
            minZoom={0.15}
            maxZoom={2}
            panOnScroll
            selectionOnDrag
            panOnDrag={[1, 2]}
            deleteKeyCode={editor || specOpen ? null : ["Backspace", "Delete"]}
            fitView={false}
          >
            <Background gap={24} size={1} color="#d8d6df" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) =>
                ({
                  idea: "#bdade7",
                  question: "#e8c58d",
                  decision: "#99c4b4",
                  task: "#aac2e0",
                })[n.data.kind as Kind]
              }
              maskColor="rgba(247,247,249,.7)"
            />
          </ReactFlow>
          <div className="canvas-top">
            <div className="canvas-caption">
              <span className="eyebrow">THINKING CANVAS</span>
              <span>
                {w.canvas.nodes.length} 张卡片 <i /> 自由连接你的想法
              </span>
            </div>
            <div className="canvas-actions">
              <button
                className="icon-button"
                title="撤销 ⌘Z"
                aria-label="撤销"
                disabled={!w.canUndo || mutating}
                onClick={() => void travel("undo")}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                title="重做 ⇧⌘Z"
                aria-label="重做"
                disabled={!w.canRedo || mutating}
                onClick={() => void travel("redo")}
              >
                <Redo2 size={17} />
              </button>
              <span />
              <button
                className="icon-button"
                title="查看全部卡片"
                aria-label="查看全部卡片"
                onClick={() =>
                  void flow?.fitView({ padding: 0.25, maxZoom: 1 })
                }
              >
                <Maximize2 size={16} />
              </button>
              <button className="secondary" onClick={() => setAdding(!adding)}>
                <Plus size={16} />
                添加卡片
              </button>
              {!conversation && (
                <button
                  className="icon-button"
                  aria-label="打开对话"
                  onClick={() => setConversation(true)}
                >
                  <MessageSquare size={18} />
                </button>
              )}
            </div>
          </div>
          {adding && (
            <div className="add-menu">
              {(
                [
                  ["idea", Lightbulb, "想法"],
                  ["question", CircleHelp, "问题"],
                  ["decision", Check, "决策"],
                  ["task", ListTodo, "待办"],
                ] as const
              ).map(([kind, Icon, label]) => (
                <button key={kind} onClick={() => void add(kind)}>
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {!w.canvas.nodes.length && (
            <div className="canvas-empty">
              <div className="empty-orbit">
                <Lightbulb size={26} />
                <span />
                <i />
              </div>
              <span className="eyebrow">EVERYTHING STARTS WITH A THOUGHT</span>
              <h2>还没想清楚，也没关系。</h2>
              <p>
                写下你的第一个想法，
                <br />
                我们一起找到值得继续的问题。
              </p>
              <button className="secondary" onClick={() => void add("idea")}>
                <Plus size={15} />
                放下第一张卡片
              </button>
            </div>
          )}
          {error && (
            <div className="workspace-error error-banner">
              {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          <div className="composer-wrap">
            <div className="composer">
              <div className="composer-context">
                <Sparkles size={13} />
                <span>
                  {selected.length
                    ? `围绕 ${selected.length} 张卡片思考`
                    : "和 AI 一起，把想法问清楚"}
                </span>
                {selected.length > 0 && (
                  <button
                    className="icon-button"
                    aria-label="清除选择"
                    onClick={() => {
                      setNodes((ns) =>
                        ns.map((n) => ({ ...n, selected: false })),
                      );
                      setSelected([]);
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
                <span className="composer-mode">GRILL MODE</span>
              </div>
              <textarea
                aria-label="与 AI 对话"
                placeholder="你想做什么项目？从一个粗糙的想法开始…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <span>
                  <i
                    className={
                      codex.data?.state === "ready"
                        ? "connected"
                        : "disconnected"
                    }
                  />
                  {codex.data?.state === "ready"
                    ? "本机 Codex"
                    : codex.data?.message || "检查 Codex…"}
                </span>
                {running ? (
                  <button
                    className="send-button stop"
                    aria-label="停止 AI"
                    onClick={() =>
                      api(`projects/${projectId}/cancel`, { runId })
                        .then(refresh)
                        .catch((e) => setError(e.message))
                    }
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="发送消息"
                    disabled={!input.trim() || starting || mutating}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
            <div className="composer-hint">
              Enter 发送 · Shift + Enter 换行
              <span>想法留在本机，思考可以走远。</span>
            </div>
          </div>
        </div>
        {conversation && (
          <aside className="conversation">
            <div className="conversation-heading">
              <div>
                <MessageSquare size={16} />
                <strong>一起想清楚</strong>
                <span>AI</span>
              </div>
              <button
                className="icon-button"
                aria-label="收起对话"
                onClick={() => setConversation(false)}
              >
                <PanelRightClose size={17} />
              </button>
            </div>
            <div className="chat-scroll">
              {w.messages.length === 0 ? (
                <div className="chat-welcome">
                  <span className="ai-avatar">
                    <Sparkles size={19} />
                  </span>
                  <h3>好问题，比快答案更重要。</h3>
                  <p>
                    告诉我你想做什么。我会追问、挑战假设，把确认的想法整理到画布上。
                  </p>
                  <div className="chat-suggestions">
                    {starterQuestions.map((text) => (
                      <button key={text} onClick={() => setInput(text)}>
                        {text}
                        <ArrowUp size={13} />
                      </button>
                    ))}
                  </div>
                  <div className="chat-guide">
                    <span>
                      01 <b>说出想法</b>
                    </span>
                    <span>
                      02 <b>一起做取舍</b>
                    </span>
                    <span>
                      03 <b>生成可执行的 Spec</b>
                    </span>
                  </div>
                </div>
              ) : (
                w.messages.map((m) => (
                  <div className={`chat-message role-${m.role}`} key={m.id}>
                    <div className="message-author">
                      {m.role === "assistant" ? (
                        <Sparkles size={12} />
                      ) : (
                        <span className="user-dot" />
                      )}
                      {m.role === "assistant" ? "Flow" : "你"}
                    </div>
                    <div className="markdown">
                      <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                    </div>
                  </div>
                ))
              )}
              {running && (
                <div className="chat-message role-assistant">
                  <div className="message-author">
                    <Sparkles size={12} />
                    Flow<span className="thinking-pulse">正在思考</span>
                  </div>
                  <div className="markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{stream || "正在梳理你的想法…"}</Markdown>
                  </div>
                </div>
              )}
              {w.run &&
                ["failed", "interrupted", "cancelled"].includes(
                  w.run.status,
                ) && (
                  <div className="run-error">
                    {w.run.error || "本轮已停止，已完成的修改保留在画布中。"}
                  </div>
                )}
              <div ref={chatEnd} />
            </div>
            <div className="conversation-footer">
              <span className="tiny-dot" />
              AI 可以整理画布，所有修改都可撤销。
            </div>
          </aside>
        )}
        {specOpen && (
          <SpecPanel
            projectId={projectId}
            spec={w.spec}
            projectRevision={w.project.revision}
            onClose={() => setSpecOpen(false)}
            onSaved={refresh}
            onDirty={setSpecDirty}
          />
        )}
      </div>
      {editor && (
        <Editor
          key={editor.id}
          card={editor}
          projectId={projectId}
          onClose={() => setEditor(null)}
          onSave={async (card) => {
            const { id, ...patch } = card;
            await apply([{ type: "node.update", id, patch }]);
          }}
          onDelete={() => apply([{ type: "node.delete", id: editor.id }])}
        />
      )}
    </div>
  );
}
