import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  Lightbulb,
  CircleHelp,
  Check,
  ListTodo,
  Link2,
  ArrowUpRight,
} from "lucide-react";
import { kindLabels, type Card } from "../lib/model";
export type FlowCard = Node<Card & { projectId: string }, "card">;
const icons = {
  idea: Lightbulb,
  question: CircleHelp,
  decision: Check,
  task: ListTodo,
};
export const CanvasCard = memo(function CanvasCard({
  data,
  selected,
}: NodeProps<FlowCard>) {
  const Icon = icons[data.kind];
  return (
    <div
      className={`canvas-card kind-${data.kind} ${selected ? "is-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="card-kind">
        <Icon size={13} />
        <span>{kindLabels[data.kind]}</span>
        {data.blocking && <b>待取舍</b>}
        {data.status === "done" && <b>已完成</b>}
      </div>
      <h3>{data.title || "未命名的" + kindLabels[data.kind]}</h3>
      {data.body && <p>{data.body}</p>}
      {data.reason && (
        <div className="card-reason">选择理由 · {data.reason}</div>
      )}
      {data.attachments.map((id) => (
        <img
          key={id}
          className="card-image"
          src={`/api/projects/${data.projectId}/attachments/${id}`}
          alt="卡片附件"
          draggable={false}
        />
      ))}
      {data.links.map((link) => (
        <a
          className="card-link nodrag"
          key={link}
          href={link}
          target="_blank"
          rel="noreferrer"
        >
          <Link2 size={12} />
          {new URL(link).hostname}
          <ArrowUpRight size={12} />
        </a>
      ))}
      <div className="card-foot">
        双击编辑<span>···</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
