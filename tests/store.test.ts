import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newCard } from "../src/lib/model";
import { canvasFixture, fixtureOperations } from "../scripts/canvas-fixture";
const directory = mkdtempSync(join(tmpdir(), "flow-test-"));
process.env.FLOW_DATA_DIR = directory;
const s = await import("../src/server/store");
after(() => {
  s.db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("transaction, revision checks, idempotency, undo and redo", () => {
  s.createProject("test", "p1");
  const a = newCard(),
    b = newCard();
  const ops = [
    { type: "node.create" as const, node: a },
    { type: "node.create" as const, node: b },
    {
      type: "edge.create" as const,
      edge: { id: "e", source: a.id, target: b.id, label: "" },
    },
  ];
  s.applyOperations("p1", "batch", 0, ops);
  s.applyOperations("p1", "batch", 0, ops);
  assert.equal(s.getWorkspace("p1").project.revision, 1);
  assert.throws(() =>
    s.applyOperations("p1", "stale", 0, [{ type: "node.delete", id: a.id }]),
  );
  assert.throws(() =>
    s.applyOperations("p1", "broken", 1, [
      { type: "node.delete", id: a.id },
      { type: "node.update", id: "missing", patch: { title: "bad" } },
    ]),
  );
  assert.equal(s.getWorkspace("p1").canvas.nodes.length, 2);
  s.applyOperations("p1", "delete", 1, [{ type: "node.delete", id: a.id }]);
  assert.equal(s.getWorkspace("p1").canvas.edges.length, 0);
  s.travel("p1", "undo", 2);
  assert.equal(s.getWorkspace("p1").canvas.edges.length, 1);
  s.travel("p1", "redo", 3);
  assert.equal(s.getWorkspace("p1").canvas.nodes.length, 1);
  s.travel("p1", "undo", 4);
  s.applyOperations("p1", "branch", 5, [
    { type: "node.update", id: a.id, patch: { title: "branch" } },
  ]);
  assert.equal(s.getWorkspace("p1").canRedo, false);
});
test("spec stale overwrite is rejected and snapshot restores old content", () => {
  s.createProject("spec", "p2");
  s.saveSpec("p2", "manual", 0);
  assert.throws(() => s.saveSpec("p2", "stale", 0, 0, "AI"));
  assert.equal(s.getSpec("p2").content, "manual");
  s.saveSpec("p2", "new", 1, 0, "AI");
  const snapshot = s.snapshots("p2")[0] as { id: string };
  s.restoreSpec("p2", snapshot.id, 2);
  assert.equal(s.getSpec("p2").content, "manual");
  assert.equal(s.snapshots("p2").length, 2);
  assert.throws(() => s.restoreSpec("p1", snapshot.id, 0));
});
test("single AI run, persisted events and repeat start do not duplicate messages", () => {
  s.createProject("ai", "p3");
  s.beginRun("p3", "r1", "chat", "hi");
  s.beginRun("p3", "r1", "chat", "hi");
  assert.equal(s.getWorkspace("p3").messages.length, 1);
  assert.throws(() => s.beginRun("p3", "r2", "chat", "hi"));
  s.addEvent("r1", "message.delta", { text: "hello" });
  assert.equal(s.runEvents("p3", "r1", 1).length, 1);
  assert.throws(() => s.runEvents("p2", "r1", 0));
  s.finishRun("p3", "r1", "cancelled");
  s.beginRun("p3", "r2", "chat", "again");
  assert.equal(s.getWorkspace("p3").run?.id, "r2");
});

test("200 cards and 300 edges preserve group move and deletion undo as atomic batches", () => {
  const canvas = canvasFixture();
  s.createProject("large canvas", "large");
  s.applyOperations("large", "large-seed", 0, fixtureOperations(canvas));
  assert.deepEqual(s.getWorkspace("large").canvas, canvas);
  const moved = s.applyOperations("large", "group-move", 1, [
    { type: "node.update", id: "card-105", patch: { x: 1488, y: 1848 } },
    { type: "node.update", id: "card-106", patch: { x: 1848, y: 1848 } },
  ]);
  assert.equal(moved.project.revision, 2);
  assert.equal(moved.canvas.nodes[104].x, 1488);
  assert.equal(moved.canvas.nodes[105].x, 1848);
  s.travel("large", "undo", 2);
  assert.deepEqual(s.getWorkspace("large").canvas, canvas);
  s.travel("large", "redo", 3);
  assert.deepEqual(s.getWorkspace("large").canvas, moved.canvas);
  const deleted = s.applyOperations("large", "group-delete", 4, [
    { type: "node.delete", id: "card-105" },
    { type: "node.delete", id: "card-106" },
  ]);
  assert.equal(deleted.canvas.nodes.length, 198);
  assert.ok(deleted.canvas.edges.length < 300);
  assert.ok(
    deleted.canvas.edges.every(
      (e) =>
        ![e.source, e.target].some(
          (id) => id === "card-105" || id === "card-106",
        ),
    ),
  );
  s.travel("large", "undo", 5);
  assert.deepEqual(s.getWorkspace("large").canvas, moved.canvas);
});
