import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = mkdtempSync(join(tmpdir(), "flow-stream-test-"));
process.env.FLOW_DATA_DIR = directory;
const store = await import("../src/server/store");
const { handle } = await import("../src/server/api");
after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
const url = (id: string) =>
  `http://127.0.0.1:3000/api/projects/${id}/events?runId=${id}`;

test("aborted SSE request closes transport promptly without cancelling the AI run", async () => {
  const id = "request-abort";
  store.createProject("stream abort", id);
  store.beginRun(id, id, "chat", "hi");
  const controller = new AbortController();
  const response = await handle(
    new Request(url(id), { signal: controller.signal }),
  );
  const reader = response.body!.getReader();
  try {
    assert.equal((await reader.read()).done, false);
    controller.abort();
    const closed = await Promise.race([
      reader.read().then((value) => value.done),
      delay(350).then(() => false),
    ]);
    assert.equal(closed, true, "Disconnected SSE must release its transport");
    assert.equal(store.getRun(id, id).status, "running");
  } finally {
    await reader.cancel();
    store.finishRun(id, id, "cancelled");
  }
});

test("disconnecting a running stream and reconnecting resumes without duplicate events", async () => {
  const id = "reconnect";
  store.createProject("stream reconnect", id);
  store.beginRun(id, id, "chat", "hi");
  const first = await handle(new Request(url(id)));
  const reader = first.body!.getReader();
  const chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /id: 1\n/);
  await reader.cancel();
  assert.equal(store.getRun(id, id).status, "running");
  store.addEvent(id, "message.delta", { text: "while disconnected" });
  store.finishRun(id, id, "completed");
  const resumed = await handle(
    new Request(url(id), { headers: { "Last-Event-ID": "1" } }),
  );
  const events = (await resumed.text())
    .trim()
    .split("\n\n")
    .map((block) => JSON.parse(block.split("\ndata: ")[1]));
  assert.deepEqual(
    events.map((e) => e.sequence),
    [2, 3],
  );
  assert.equal(events[0].payload.text, "while disconnected");
  assert.equal(events[1].type, "run.completed");
});
