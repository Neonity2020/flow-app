import { z } from "zod";
export const kinds = ["idea", "question", "decision", "task"] as const;
export type Kind = (typeof kinds)[number];
export const kindLabels: Record<Kind, string> = {
  idea: "想法",
  question: "问题",
  decision: "决策",
  task: "待办",
};
const id = z.string().min(1).max(100);
const point = z.number().finite().min(-1e6).max(1e6);
export const cardSchema = z
  .object({
    id,
    kind: z.enum(kinds),
    title: z.string().max(300),
    body: z.string().max(30000),
    x: point,
    y: point,
    status: z.enum(["open", "done"]),
    blocking: z.boolean(),
    reason: z.string().max(10000),
    links: z
      .array(
        z
          .string()
          .url()
          .refine((v) => /^https?:/.test(v), "仅支持 HTTP(S) 链接"),
      )
      .max(30),
    attachments: z.array(id).max(20),
  })
  .strict();
export type Card = z.infer<typeof cardSchema>;
export const edgeSchema = z
  .object({ id, source: id, target: id, label: z.string().max(300) })
  .strict();
export type LinkEdge = z.infer<typeof edgeSchema>;
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("node.create"), node: cardSchema }).strict(),
  z
    .object({
      type: z.literal("node.update"),
      id,
      patch: cardSchema.omit({ id: true }).partial(),
    })
    .strict(),
  z.object({ type: z.literal("node.delete"), id }).strict(),
  z.object({ type: z.literal("edge.create"), edge: edgeSchema }).strict(),
  z
    .object({ type: z.literal("edge.update"), id, label: z.string().max(300) })
    .strict(),
  z.object({ type: z.literal("edge.delete"), id }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export interface Canvas {
  nodes: Card[];
  edges: LinkEdge[];
}
export interface Project {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  count: number;
}
export interface Spec {
  content: string;
  revision: number;
  sourceRevision: number;
  updatedAt: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  runId: string | null;
}
export interface Run {
  id: string;
  kind: "chat" | "spec";
  status: string;
  error: string | null;
  createdAt: string;
}
export interface Workspace {
  project: Project;
  canvas: Canvas;
  messages: Message[];
  spec: Spec;
  run: Run | null;
  canUndo: boolean;
  canRedo: boolean;
}
export function newCard(kind: Kind = "idea", x = 0, y = 0): Card {
  return {
    id: crypto.randomUUID(),
    kind,
    title: "",
    body: "",
    x,
    y,
    status: "open",
    blocking: false,
    reason: "",
    links: [],
    attachments: [],
  };
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function applyCanvas(
  canvas: Canvas,
  operations: Operation[],
  scope?: Set<string>,
): Canvas {
  const next = structuredClone(canvas);
  const allowed = scope ? new Set(scope) : null;
  for (const op of operations) {
    if (op.type === "node.create") {
      if (next.nodes.some((n) => n.id === op.node.id))
        throw new AppError("VALIDATION_ERROR", "卡片 ID 已存在");
      next.nodes.push(op.node);
      allowed?.add(op.node.id);
    } else if (op.type === "node.update" || op.type === "node.delete") {
      const node = next.nodes.find((n) => n.id === op.id);
      if (!node) throw new AppError("NOT_FOUND", "卡片不存在", 404);
      if (allowed && !allowed.has(op.id))
        throw new AppError("VALIDATION_ERROR", "操作超出选中范围");
      if (op.type === "node.update") Object.assign(node, op.patch);
      else {
        next.nodes = next.nodes.filter((n) => n.id !== op.id);
        next.edges = next.edges.filter(
          (e) => e.source !== op.id && e.target !== op.id,
        );
      }
    } else {
      const edge =
        op.type === "edge.create"
          ? op.edge
          : next.edges.find((e) => e.id === op.id);
      if (!edge) throw new AppError("NOT_FOUND", "连线不存在", 404);
      if (allowed && (!allowed.has(edge.source) || !allowed.has(edge.target)))
        throw new AppError("VALIDATION_ERROR", "连线超出选中范围");
      if (op.type === "edge.create") {
        if (next.edges.some((e) => e.id === op.edge.id))
          throw new AppError("VALIDATION_ERROR", "连线 ID 已存在");
        next.edges.push(op.edge);
      } else if (op.type === "edge.update") edge.label = op.label;
      else next.edges = next.edges.filter((e) => e.id !== op.id);
    }
  }
  const ids = new Set(next.nodes.map((n) => n.id));
  const signatures = new Set<string>();
  for (const e of next.edges) {
    const sig = JSON.stringify([e.source, e.target, e.label]);
    if (
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      e.source === e.target ||
      signatures.has(sig)
    )
      throw new AppError("VALIDATION_ERROR", "连线端点无效或关系重复");
    signatures.add(sig);
  }
  for (const n of next.nodes) {
    cardSchema.parse(n);
    if (n.kind !== "question") n.blocking = false;
    if (n.kind !== "decision") n.reason = "";
    if (n.kind === "idea" || n.kind === "decision") n.status = "open";
  }
  return next;
}
