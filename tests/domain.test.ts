import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvas, newCard, operationSchema } from "../src/lib/model";
import { contentPrefix } from "../src/server/codex";
test("invalid batch never mutates input and rejects dangling edge", () => {
  const n = newCard();
  const before = { nodes: [n], edges: [] };
  assert.throws(() =>
    applyCanvas(before, [
      { type: "node.update", id: n.id, patch: { title: "changed" } },
      {
        type: "edge.create",
        edge: { id: "edge", source: n.id, target: "missing", label: "" },
      },
    ]),
  );
  assert.equal(before.nodes[0].title, "");
});
test("selection scope rejects unrelated writes and allows newly created nodes", () => {
  const a = newCard(),
    b = newCard();
  const c = newCard();
  assert.throws(() =>
    applyCanvas(
      { nodes: [a, b], edges: [] },
      [{ type: "node.update", id: b.id, patch: { title: "no" } }],
      new Set([a.id]),
    ),
  );
  const result = applyCanvas(
    { nodes: [a, b], edges: [] },
    [
      { type: "node.create", node: c },
      {
        type: "edge.create",
        edge: { id: "edge", source: a.id, target: c.id, label: "next" },
      },
    ],
    new Set([a.id]),
  );
  assert.equal(result.edges.length, 1);
});
test("deleting a node removes its edges; strict schema rejects arbitrary code", () => {
  const a = newCard(),
    b = newCard();
  assert.equal(
    applyCanvas(
      {
        nodes: [a, b],
        edges: [{ id: "edge", source: a.id, target: b.id, label: "" }],
      },
      [{ type: "node.delete", id: a.id }],
    ).edges.length,
    0,
  );
  assert.equal(
    operationSchema.safeParse({
      type: "node.delete",
      id: a.id,
      sql: "DROP TABLE projects",
    }).success,
    false,
  );
});
test("stream decoder exposes content, not structured operations", () => {
  assert.equal(
    contentPrefix('{"content":"你好\\n世界\\u4f60" ,"operations":"[]"}'),
    "你好\n世界你",
  );
  assert.equal(contentPrefix('{"content":"partial\\u4f'), "partial");
});
