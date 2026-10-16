import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AppError,
  applyCanvas,
  type Operation,
  type Project,
  type Workspace,
  type Spec,
  type Message,
  type Run,
} from "../lib/model";
export const dataDir = resolve(
  process.env.FLOW_DATA_DIR || join(homedir(), ".local/share/flow-app"),
);
mkdirSync(join(dataDir, "attachments"), { recursive: true });
const globals = globalThis as typeof globalThis & { flowDb?: DatabaseSync };
const fresh = !globals.flowDb;
export const db = (globals.flowDb ??= new DatabaseSync(
  join(dataDir, "flow.sqlite"),
));
db.exec(
  "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
);
const version = (
  db.prepare("PRAGMA user_version").get() as { user_version: number }
).user_version;
if (version > 1) throw new Error("数据库版本较新，请升级 Flow");
if (version === 0)
  db.exec(`BEGIN;
CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL DEFAULT 'local',name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,canvas TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',cursor INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
CREATE TABLE history(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,position INTEGER NOT NULL,beforeState TEXT NOT NULL,afterState TEXT NOT NULL,UNIQUE(projectId,position));
CREATE TABLE requests(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,payload TEXT NOT NULL);
CREATE TABLE specs(projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,content TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,sourceRevision INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
CREATE TABLE snapshots(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,content TEXT NOT NULL,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE TABLE runs(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind TEXT NOT NULL,status TEXT NOT NULL,error TEXT,createdAt TEXT NOT NULL);
CREATE UNIQUE INDEX one_active_run ON runs(projectId) WHERE status='running';
CREATE TABLE messages(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,runId TEXT REFERENCES runs(id) ON DELETE SET NULL,createdAt TEXT NOT NULL);
CREATE TABLE events(runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(runId,sequence));
CREATE TABLE attachments(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
CREATE INDEX messages_project ON messages(projectId,createdAt);
CREATE INDEX runs_project ON runs(projectId,createdAt);
CREATE INDEX snapshots_project ON snapshots(projectId,createdAt);
PRAGMA user_version=1; COMMIT;`);
if (fresh)
  db.exec(
    "UPDATE runs SET status='interrupted',error='服务已重启，本轮已中断' WHERE status='running'",
  );
const now = () => new Date().toISOString();
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function resolvePrincipal() {
  return { id: "local" };
}
type ProjectRow = Project & { owner: string; canvas: string; cursor: number };
export function project(id: string): ProjectRow {
  const p = db
    .prepare("SELECT * FROM projects WHERE id=? AND owner=?")
    .get(id, resolvePrincipal().id) as ProjectRow | undefined;
  if (!p) throw new AppError("NOT_FOUND", "项目不存在", 404);
  return p;
}
export function listProjects(): Project[] {
  return (
    db
      .prepare(
        "SELECT *,json_array_length(canvas,'$.nodes') count FROM projects WHERE owner=? ORDER BY updatedAt DESC",
      )
      .all(resolvePrincipal().id) as unknown as ProjectRow[]
  ).map(({ id, name, revision, createdAt, updatedAt, count }) => ({
    id,
    name,
    revision,
    createdAt,
    updatedAt,
    count,
  }));
}
export function createProject(name: string, id: string) {
  if (db.prepare("SELECT id FROM projects WHERE id=?").get(id))
    return project(id);
  const date = now();
  transaction(() => {
    db.prepare(
      "INSERT INTO projects(id,name,createdAt,updatedAt) VALUES(?,?,?,?)",
    ).run(id, name, date, date);
    db.prepare("INSERT INTO specs(projectId,updatedAt) VALUES(?,?)").run(
      id,
      date,
    );
  });
  return project(id);
}
export function renameProject(id: string, name: string) {
  project(id);
  db.prepare("UPDATE projects SET name=?,updatedAt=? WHERE id=?").run(
    name,
    now(),
    id,
  );
}
export function deleteProject(id: string) {
  project(id);
  db.prepare("DELETE FROM projects WHERE id=?").run(id);
}
export function getSpec(id: string): Spec {
  project(id);
  return db
    .prepare(
      "SELECT content,revision,sourceRevision,updatedAt FROM specs WHERE projectId=?",
    )
    .get(id) as unknown as Spec;
}
export function getWorkspace(id: string): Workspace {
  const p = project(id);
  const run = db
    .prepare(
      "SELECT id,kind,status,error,createdAt FROM runs WHERE projectId=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(id) as unknown as Run | undefined;
  return {
    project: {
      id: p.id,
      name: p.name,
      revision: p.revision,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      count: JSON.parse(p.canvas).nodes.length,
    },
    canvas: JSON.parse(p.canvas),
    spec: getSpec(id),
    messages: db
      .prepare(
        "SELECT id,role,content,runId,createdAt FROM messages WHERE projectId=? ORDER BY rowid",
      )
      .all(id) as unknown as Message[],
    run: run || null,
    canUndo: p.cursor > 0,
    canRedo: !!db
      .prepare("SELECT 1 FROM history WHERE projectId=? AND position=?")
      .get(id, p.cursor + 1),
  };
}
export function applyOperations(
  id: string,
  batchId: string,
  revision: number,
  operations: Operation[],
  scope?: Set<string>,
) {
  return transaction(() => {
    const p = project(id);
    const payload = JSON.stringify({ revision, operations });
    const previous = db
      .prepare("SELECT payload FROM requests WHERE id=? AND projectId=?")
      .get(batchId, id) as { payload: string } | undefined;
    if (previous) {
      if (previous.payload !== payload)
        throw new AppError("REVISION_CONFLICT", "相同请求 ID 内容不同", 409);
      return getWorkspace(id);
    }
    if (p.revision !== revision)
      throw new AppError(
        "REVISION_CONFLICT",
        "画布已变化，请刷新上下文后重试；本次修改未覆盖现有内容",
        409,
      );
    const next = applyCanvas(JSON.parse(p.canvas), operations, scope);
    for (const n of next.nodes)
      for (const aid of n.attachments)
        if (
          !db
            .prepare("SELECT 1 FROM attachments WHERE id=? AND projectId=?")
            .get(aid, id)
        )
          throw new AppError("VALIDATION_ERROR", "附件不属于当前项目");
    db.prepare("DELETE FROM history WHERE projectId=? AND position>?").run(
      id,
      p.cursor,
    );
    db.prepare("INSERT INTO history VALUES(?,?,?,?,?)").run(
      batchId,
      id,
      p.cursor + 1,
      p.canvas,
      JSON.stringify(next),
    );
    db.prepare("INSERT INTO requests VALUES(?,?,?)").run(batchId, id, payload);
    db.prepare(
      "UPDATE projects SET canvas=?,revision=revision+1,cursor=cursor+1,updatedAt=? WHERE id=?",
    ).run(JSON.stringify(next), now(), id);
    return getWorkspace(id);
  });
}
export function travel(
  id: string,
  direction: "undo" | "redo",
  revision: number,
) {
  return transaction(() => {
    const p = project(id);
    if (p.revision !== revision)
      throw new AppError("REVISION_CONFLICT", "画布已变化，请重试", 409);
    const row = db
      .prepare(
        "SELECT beforeState,afterState FROM history WHERE projectId=? AND position=?",
      )
      .get(id, direction === "undo" ? p.cursor : p.cursor + 1) as
      { beforeState: string; afterState: string } | undefined;
    if (!row) throw new AppError("NOT_FOUND", "没有可恢复的操作", 404);
    db.prepare(
      "UPDATE projects SET canvas=?,revision=revision+1,cursor=?,updatedAt=? WHERE id=?",
    ).run(
      direction === "undo" ? row.beforeState : row.afterState,
      p.cursor + (direction === "undo" ? -1 : 1),
      now(),
      id,
    );
    return getWorkspace(id);
  });
}
export function saveSpec(
  id: string,
  content: string,
  revision: number,
  sourceRevision?: number,
  reason?: string,
) {
  return transaction(() => {
    const current = getSpec(id);
    if (current.revision !== revision)
      throw new AppError(
        "REVISION_CONFLICT",
        "文档已被编辑，本次生成没有覆盖你的内容",
        409,
      );
    if (reason && current.content)
      db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run(
        randomUUID(),
        id,
        current.content,
        reason,
        now(),
      );
    db.prepare(
      "UPDATE specs SET content=?,revision=revision+1,sourceRevision=?,updatedAt=? WHERE projectId=?",
    ).run(content, sourceRevision ?? current.sourceRevision, now(), id);
    return getSpec(id);
  });
}
export function snapshots(id: string) {
  project(id);
  return db
    .prepare(
      "SELECT id,content,reason,createdAt FROM snapshots WHERE projectId=? ORDER BY rowid DESC",
    )
    .all(id);
}
export function restoreSpec(id: string, snapshotId: string, revision: number) {
  project(id);
  const s = db
    .prepare("SELECT content FROM snapshots WHERE id=? AND projectId=?")
    .get(snapshotId, id) as { content: string } | undefined;
  if (!s) throw new AppError("NOT_FOUND", "恢复记录不存在", 404);
  return saveSpec(id, s.content, revision, -1, "恢复前自动备份");
}
export function addMessage(
  id: string,
  role: string,
  content: string,
  runId: string,
) {
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    role,
    content,
    runId,
    now(),
  );
}
export function addEvent(runId: string, type: string, payload: unknown) {
  db.prepare(
    "INSERT INTO events SELECT ?,COALESCE(MAX(sequence),0)+1,?,? FROM events WHERE runId=?",
  ).run(runId, type, JSON.stringify(payload), runId);
}
export function getRun(id: string, runId: string) {
  project(id);
  const run = db
    .prepare("SELECT * FROM runs WHERE id=? AND projectId=?")
    .get(runId, id) as unknown as Run | undefined;
  if (!run) throw new AppError("NOT_FOUND", "任务不存在", 404);
  return run;
}
export function runEvents(id: string, runId: string, after: number) {
  getRun(id, runId);
  return (
    db
      .prepare(
        "SELECT sequence,type,payload FROM events WHERE runId=? AND sequence>? ORDER BY sequence",
      )
      .all(runId, after) as {
      sequence: number;
      type: string;
      payload: string;
    }[]
  ).map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
}
export function beginRun(
  id: string,
  runId: string,
  kind: string,
  message: string,
) {
  return transaction(() => {
    project(id);
    const old = db
      .prepare("SELECT * FROM runs WHERE id=? AND projectId=?")
      .get(runId, id) as unknown as Run | undefined;
    if (old) return { run: old, existing: true };
    if (
      db
        .prepare("SELECT 1 FROM runs WHERE projectId=? AND status='running'")
        .get(id)
    )
      throw new AppError("RUN_ACTIVE", "请等待当前任务完成或停止它", 409);
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?)").run(
      runId,
      id,
      kind,
      "running",
      null,
      now(),
    );
    addMessage(id, "user", message, runId);
    addEvent(runId, "run.started", {});
    return { run: getRun(id, runId), existing: false };
  });
}
export function finishRun(
  id: string,
  runId: string,
  status: string,
  error?: string,
) {
  if (getRun(id, runId).status !== "running") return;
  transaction(() => {
    db.prepare("UPDATE runs SET status=?,error=? WHERE id=?").run(
      status,
      error ?? null,
      runId,
    );
    addEvent(runId, `run.${status}`, { error });
  });
}
