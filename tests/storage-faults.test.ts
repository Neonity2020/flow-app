import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newCard } from "../src/lib/model";

const directory = mkdtempSync(join(tmpdir(), "flow-storage-faults-"));
process.env.FLOW_DATA_DIR = directory;
const store = await import("../src/server/store");
const { handle } = await import("../src/server/api");
after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
function pages(pragma: "page_count" | "max_page_count") {
  return (store.db.prepare(`PRAGMA ${pragma}`).get() as Record<string, number>)[
    pragma
  ];
}

test("SQLITE_FULL preserves the original error, spec and snapshots, then allows retry", () => {
  const id = "full-spec";
  store.createProject("Full spec", id);
  store.saveSpec(id, "Manual draft".repeat(500), 0);
  const before = store.getSpec(id);
  const maximum = pages("max_page_count");
  store.db.exec(`PRAGMA max_page_count=${pages("page_count") + 4}`);
  try {
    assert.throws(
      () => store.saveSpec(id, "x".repeat(180000), 1, 0, "AI"),
      (error: unknown) => {
        assert.equal(
          (error as { errcode?: number }).errcode,
          13,
          "Keep SQLITE_FULL instead of a secondary ROLLBACK error",
        );
        return true;
      },
    );
    assert.equal(store.db.isTransaction, false);
    assert.deepEqual(store.getSpec(id), before);
    assert.equal(store.snapshots(id).length, 0);
  } finally {
    store.db.exec(`PRAGMA max_page_count=${maximum}`);
  }
  store.saveSpec(id, "Recovered", 1, 0, "AI");
  assert.equal(store.getSpec(id).content, "Recovered");
  assert.equal(store.snapshots(id).length, 1);
});

test("SQLITE_FULL rolls back canvas history and request ID so the same batch can retry", () => {
  const id = "full-canvas";
  store.createProject("Full canvas", id);
  const before = store.getWorkspace(id);
  const node = newCard();
  node.body = "x".repeat(30000);
  const operations = [{ type: "node.create" as const, node }];
  const maximum = pages("max_page_count");
  store.db.exec(`PRAGMA max_page_count=${pages("page_count") + 1}`);
  try {
    assert.throws(() => store.applyOperations(id, "retry-full", 0, operations));
    assert.deepEqual(store.getWorkspace(id), before);
    assert.equal(store.db.isTransaction, false);
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM requests WHERE projectId=?")
        .get(id)?.count,
      0,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM history WHERE projectId=?")
        .get(id)?.count,
      0,
    );
  } finally {
    store.db.exec(`PRAGMA max_page_count=${maximum}`);
  }
  store.applyOperations(id, "retry-full", 0, operations);
  assert.equal(store.getWorkspace(id).project.revision, 1);
  assert.equal(store.getWorkspace(id).canvas.nodes[0].body, node.body);
});

test("another connection holding a writer lock rejects writes without losing the retry", () => {
  const id = "busy";
  store.createProject("Busy", id);
  const other = new DatabaseSync(join(directory, "flow.sqlite"));
  store.db.exec("PRAGMA busy_timeout=20");
  const node = newCard();
  const operations = [{ type: "node.create" as const, node }];
  try {
    other.exec("BEGIN IMMEDIATE");
    assert.throws(() => store.applyOperations(id, "retry-busy", 0, operations));
    assert.equal(store.getWorkspace(id).project.revision, 0);
    assert.equal(store.db.isTransaction, false);
  } finally {
    other.exec("ROLLBACK");
    other.close();
    store.db.exec("PRAGMA busy_timeout=5000");
  }
  store.applyOperations(id, "retry-busy", 0, operations);
  assert.equal(store.getWorkspace(id).project.revision, 1);
});

test("API reports storage full and saves the same spec revision after capacity is restored", async () => {
  const id = "api-full";
  store.createProject("API full", id);
  const request = () =>
    new Request(`http://127.0.0.1:3000/api/projects/${id}/spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(180000), revision: 0 }),
    });
  const maximum = pages("max_page_count");
  store.db.exec(`PRAGMA max_page_count=${pages("page_count") + 1}`);
  try {
    const response = await handle(request());
    assert.equal(response.status, 507);
    const error = await response.json();
    assert.equal(error.code, "STORAGE_FULL");
    assert.match(error.message, /空间不足/);
    assert.equal(store.getSpec(id).revision, 0);
    assert.equal(store.getSpec(id).content, "");
  } finally {
    store.db.exec(`PRAGMA max_page_count=${maximum}`);
  }
  assert.equal((await handle(request())).status, 200);
  assert.equal(store.getSpec(id).revision, 1);
});

test("API reports a writer lock as retryable without changing the spec", async () => {
  const id = "api-busy";
  store.createProject("API busy", id);
  const other = new DatabaseSync(join(directory, "flow.sqlite"));
  store.db.exec("PRAGMA busy_timeout=20");
  try {
    other.exec("BEGIN IMMEDIATE");
    const response = await handle(
      new Request(`http://127.0.0.1:3000/api/projects/${id}/spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Do not save", revision: 0 }),
      }),
    );
    assert.equal(response.status, 503);
    const error = await response.json();
    assert.equal(error.code, "STORAGE_BUSY");
    assert.match(error.message, /稍后重试/);
    assert.equal(store.getSpec(id).revision, 0);
  } finally {
    other.exec("ROLLBACK");
    other.close();
    store.db.exec("PRAGMA busy_timeout=5000");
  }
});
