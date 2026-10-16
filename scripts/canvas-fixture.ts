import { kinds, type Canvas, type Operation } from "../src/lib/model";

/** Stable IDs and varied text make browser checks repeatable across runs. */
export function canvasFixture(): Canvas {
  const nodes = Array.from({ length: 200 }, (_, i) => ({
    id: `card-${i + 1}`,
    kind: kinds[i % kinds.length],
    title: `${String(i + 1).padStart(3, "0")} · 项目探索`,
    body: "明确用户遇到的问题，记录假设、取舍与下一步。\n".repeat(1 + (i % 4)),
    x: (i % 20) * 360,
    y: Math.floor(i / 20) * 360,
    status: "open" as const,
    blocking: i % 4 === 1,
    reason: i % 4 === 2 ? "先验证核心流程，再扩展范围。" : "",
    links: [],
    attachments: [],
  }));
  const edges = Array.from({ length: 300 }, (_, i) => ({
    id: `edge-${i + 1}`,
    source: nodes[i % 200].id,
    target: nodes[((i % 200) + (i < 200 ? 1 : 20)) % 200].id,
    label: i % 5 === 0 ? "关联" : "",
  }));
  return { nodes, edges };
}

export function fixtureOperations(canvas: Canvas): Operation[] {
  return [
    ...canvas.nodes.map((node) => ({ type: "node.create" as const, node })),
    ...canvas.edges.map((edge) => ({ type: "edge.create" as const, edge })),
  ];
}
