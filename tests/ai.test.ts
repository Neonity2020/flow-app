import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { newCard } from "../src/lib/model";

const directory = mkdtempSync(join(tmpdir(), "flow-ai-test-"));
process.env.FLOW_DATA_DIR = join(directory, "data");
const command = join(directory, "codex-double");
writeFileSync(
  command,
  readFileSync(
    new URL("./fixtures/fake-codex.mjs", import.meta.url),
    "utf8",
  ).replace(/^#!.*\n/, `#!${process.execPath}\n`),
  { mode: 0o700 },
);
process.env.APP_CODEX_COMMAND = command;
const store = await import("../src/server/store");
const { startRun, cancelRun } = await import("../src/server/ai");
after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});

async function until<T>(
  read: () => T,
  ready: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 8000;
  while (true) {
    const value = read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, "Timed out waiting for AI workflow");
    await delay(10);
  }
}
const reply = (operations: unknown[] = [], content = "Accepted", spec = "") =>
  JSON.stringify({ content, operations: JSON.stringify(operations), spec });
function setup(replies: string[], gate = false, failure = false) {
  const id = randomUUID();
  store.createProject("AI fault injection", id);
  const calls = join(directory, `${id}.calls`);
  const release = gate ? join(directory, `${id}.release`) : undefined;
  const config = join(directory, `${id}.json`);
  writeFileSync(config, JSON.stringify({ replies, calls, release, failure }));
  process.env.FLOW_TEST_CODEX_CONFIG = config;
  const records = () =>
    existsSync(calls)
      ? readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as { pid: number; cwd: string; prompt: string },
          )
      : [];
  return {
    id,
    runId: `${id}-run`,
    records,
    release: () => {
      assert.ok(release);
      writeFileSync(release, "go");
    },
  };
}
async function finish(s: ReturnType<typeof setup>) {
  const run = await until(
    () => store.getRun(s.id, s.runId),
    (r) => r.status !== "running",
  );
  await until(s.records, (records) =>
    records.every((r) => {
      try {
        process.kill(r.pid, 0);
        return false;
      } catch {
        return !existsSync(r.cwd);
      }
    }),
  );
  return run;
}
const invalid = () =>
  reply(
    [
      { type: "node.create", node: { ...newCard(), id: "candidate" } },
      { type: "node.update", id: "missing", patch: { title: "Invalid" } },
    ],
    "Rejected candidate",
  );

test("invalid AI batch is atomic, repairs once, and retrying request ID does not execute again", async () => {
  const node = { ...newCard(), id: "accepted" };
  const s = setup([invalid(), reply([{ type: "node.create", node }])]);
  startRun(s.id, s.runId, "chat", "help", []);
  assert.equal((await finish(s)).status, "completed");
  const w = store.getWorkspace(s.id);
  assert.deepEqual(w.canvas.nodes, [node]);
  assert.equal(w.project.revision, 1);
  assert.deepEqual(
    w.messages.map((m) => m.content),
    ["help", "Accepted"],
  );
  assert.equal(s.records().length, 2);
  assert.match(s.records()[1].prompt, /上次候选结果校验失败/);
  const events = store.runEvents(s.id, s.runId, 0);
  assert.equal(
    events.filter((e) => e.type === "operations.rejected").length,
    1,
  );
  assert.equal(events.filter((e) => e.type === "message.reset").length, 1);
  assert.equal(
    events.filter((e) => e.type === "operations.committed").length,
    1,
  );
  startRun(s.id, s.runId, "chat", "help", []);
  assert.equal(s.records().length, 2);
  assert.equal(store.getWorkspace(s.id).messages.length, 2);
});

test("three invalid AI results fail without partial writes or an assistant success message", async () => {
  const s = setup([invalid()]);
  store.saveSpec(s.id, "Keep manual spec", 0);
  startRun(s.id, s.runId, "chat", "help", []);
  assert.equal((await finish(s)).status, "failed");
  assert.equal(s.records().length, 3);
  const w = store.getWorkspace(s.id);
  assert.equal(w.project.revision, 0);
  assert.equal(w.canvas.nodes.length, 0);
  assert.equal(w.spec.content, "Keep manual spec");
  assert.equal(w.messages.length, 1);
  const events = store.runEvents(s.id, s.runId, 0);
  assert.equal(events.filter((e) => e.type === "message.reset").length, 2);
  assert.equal(events.at(-1)?.type, "run.failed");
  assert.ok(!events.some((e) => e.type === "operations.committed"));
});

test("canvas revision conflict preserves a manual edit and never asks AI to retry", async () => {
  const node = { ...newCard(), id: "manual" };
  const s = setup(
    [reply([{ type: "node.update", id: node.id, patch: { title: "AI" } }])],
    true,
  );
  store.applyOperations(s.id, `${s.id}-seed`, 0, [
    { type: "node.create", node },
  ]);
  startRun(s.id, s.runId, "chat", "update", []);
  await until(s.records, (r) => r.length === 1);
  store.applyOperations(s.id, `${s.id}-edit`, 1, [
    { type: "node.update", id: node.id, patch: { title: "Manual wins" } },
  ]);
  s.release();
  assert.equal((await finish(s)).status, "failed");
  assert.equal(s.records().length, 1);
  assert.equal(store.getWorkspace(s.id).canvas.nodes[0].title, "Manual wins");
  assert.equal(store.getWorkspace(s.id).project.revision, 2);
});

test("spec revision conflict preserves manual content and does not create a misleading snapshot", async () => {
  const s = setup([reply([], "Generated", "AI spec")], true);
  store.saveSpec(s.id, "Original", 0);
  startRun(s.id, s.runId, "spec", "", []);
  await until(s.records, (r) => r.length === 1);
  store.saveSpec(s.id, "Manual wins", 1);
  s.release();
  assert.equal((await finish(s)).status, "failed");
  assert.equal(s.records().length, 1);
  assert.equal(store.getSpec(s.id).content, "Manual wins");
  assert.equal(store.snapshots(s.id).length, 0);
});

test("cancelled AI task terminates its process and removes cwd without applying a candidate", async () => {
  const s = setup([reply([{ type: "node.create", node: newCard() }])], true);
  startRun(s.id, s.runId, "chat", "cancel", []);
  await until(s.records, (r) => r.length === 1);
  cancelRun(s.id, s.runId);
  assert.equal((await finish(s)).status, "cancelled");
  assert.equal(store.getWorkspace(s.id).project.revision, 0);
  assert.equal(store.getWorkspace(s.id).messages.length, 1);
  assert.equal(store.runEvents(s.id, s.runId, 0).at(-1)?.type, "run.cancelled");
});

test("bridge failure preserves saved content and is not retried as an output format error", async () => {
  const s = setup([], false, true);
  store.saveSpec(s.id, "Saved spec", 0);
  startRun(s.id, s.runId, "chat", "help", []);
  const run = await finish(s);
  assert.equal(run.status, "failed");
  assert.match(run.error || "", /Injected connection failure/);
  assert.equal(s.records().length, 1);
  assert.equal(store.getSpec(s.id).content, "Saved spec");
  assert.equal(store.getWorkspace(s.id).messages.length, 1);
});
