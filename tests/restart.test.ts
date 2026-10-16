import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fresh process preserves project data and interrupts unfinished runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "flow-restart-"));
  const run = (source: string) =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, FLOW_DATA_DIR: directory },
        encoding: "utf8",
      },
    );
  try {
    run(`
      import * as s from './src/server/store.ts';
      import { newCard } from './src/lib/model.ts';
      s.createProject('persistent', 'p');
      s.createProject('isolated', 'other');
      const node = newCard(); node.title = 'Persisted card';
      s.applyOperations('p', 'batch', 0, [{ type: 'node.create', node }]);
      s.saveSpec('p', 'Manual draft', 0);
      s.saveSpec('p', 'Updated draft', 1, 1, 'AI');
      s.beginRun('p', 'unfinished', 'chat', 'Keep this message');
      s.addEvent('unfinished', 'message.delta', { text: 'Partial response' });
      s.db.close();
    `);
    const state = JSON.parse(
      run(`
      import * as s from './src/server/store.ts';
      const workspace = s.getWorkspace('p');
      const snapshots = s.snapshots('p');
      const events = s.runEvents('p', 'unfinished', 0);
      s.restoreSpec('p', snapshots[0].id, 2);
      const restored = s.getSpec('p');
      const undoRestore = s.snapshots('p')[0];
      s.restoreSpec('p', undoRestore.id, 3);
      s.beginRun('p', 'new-run', 'chat', 'Continue after restart');
      console.log(JSON.stringify({ workspace, snapshots, events, restored,
        restoredBack: s.getSpec('p'), other: s.getWorkspace('other'),
        newRun: s.getRun('p', 'new-run') }));
      s.db.close();
    `),
    );
    assert.equal(state.workspace.canvas.nodes[0].title, "Persisted card");
    assert.equal(state.workspace.project.revision, 1);
    assert.equal(state.workspace.spec.content, "Updated draft");
    assert.equal(state.workspace.messages[0].content, "Keep this message");
    assert.equal(state.workspace.run.status, "interrupted");
    assert.match(state.workspace.run.error, /服务已重启/);
    assert.equal(state.events[1].payload.text, "Partial response");
    assert.equal(state.snapshots[0].content, "Manual draft");
    assert.equal(state.restored.content, "Manual draft");
    assert.equal(state.restoredBack.content, "Updated draft");
    assert.equal(state.other.canvas.nodes.length, 0);
    assert.equal(state.other.spec.content, "");
    assert.equal(state.other.run, null);
    assert.equal(state.newRun.status, "running");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SIGKILL during an uncommitted transaction preserves committed data and passes integrity check", async () => {
  const directory = mkdtempSync(join(tmpdir(), "flow-crash-"));
  const env = { ...process.env, FLOW_DATA_DIR: directory };
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
    import * as s from './src/server/store.ts';
    import { newCard } from './src/lib/model.ts';
    s.createProject('crash test', 'p');
    const node = newCard(); node.title = 'Committed card';
    s.applyOperations('p', 'seed', 0, [{type:'node.create', node}]);
    s.saveSpec('p', 'Committed spec', 0);
    s.beginRun('p', 'unfinished', 'chat', 'Committed message');
    s.db.exec('BEGIN IMMEDIATE');
    s.db.prepare('UPDATE projects SET canvas=? WHERE id=?').run('{"nodes":[],"edges":[]}', 'p');
    s.db.prepare('UPDATE specs SET content=? WHERE projectId=?').run('Uncommitted spec', 'p');
    s.addEvent('unfinished', 'message.delta', {text:'Uncommitted event'});
    process.stdout.write('crash-ready');
    setInterval(() => {}, 1000);
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const [chunk] = await once(child.stdout, "data", {
      signal: AbortSignal.timeout(8000),
    });
    assert.match(chunk.toString(), /crash-ready/);
    const closed = once(child, "close");
    child.kill("SIGKILL");
    const [, signal] = await closed;
    assert.equal(signal, "SIGKILL");
    const recovered = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `
      import * as s from './src/server/store.ts';
      console.log(JSON.stringify({ workspace:s.getWorkspace('p'), events:s.runEvents('p','unfinished',0), integrity:s.db.prepare('PRAGMA integrity_check').get(), foreignKeys:s.db.prepare('PRAGMA foreign_key_check').all() }));
      s.db.close();
    `,
        ],
        { cwd: new URL("..", import.meta.url), env, encoding: "utf8" },
      ),
    );
    assert.equal(recovered.workspace.canvas.nodes[0].title, "Committed card");
    assert.equal(recovered.workspace.project.revision, 1);
    assert.equal(recovered.workspace.spec.content, "Committed spec");
    assert.equal(recovered.workspace.spec.revision, 1);
    assert.equal(recovered.workspace.messages[0].content, "Committed message");
    assert.equal(recovered.workspace.run.status, "interrupted");
    assert.equal(recovered.events.length, 1);
    assert.equal(recovered.events[0].type, "run.started");
    assert.equal(recovered.integrity.integrity_check, "ok");
    assert.deepEqual(recovered.foreignKeys, []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
