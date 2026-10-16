import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus, platform, release, arch } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canvasFixture, fixtureOperations } from "./canvas-fixture";

// Always isolate benchmarks, even if FLOW_DATA_DIR is set in the parent shell.
const directory = mkdtempSync(join(tmpdir(), "flow-canvas-bench-"));
process.env.FLOW_DATA_DIR = directory;
const store = await import("../src/server/store");
const canvas = canvasFixture();
const operations = fixtureOperations(canvas);
const sample = (fn: () => void, count = 30) => {
  const times = Array.from({ length: count }, () => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return {
    samples: count,
    medianMs: +times[Math.floor(count / 2)].toFixed(2),
    p95Ms: +times[Math.ceil(count * 0.95) - 1].toFixed(2),
    maxMs: +times[count - 1].toFixed(2),
  };
};
try {
  store.createProject("画布验收 · 200 卡片 / 300 连线", "canvas-benchmark");
  const start = performance.now();
  store.applyOperations("canvas-benchmark", "fixture", 0, operations);
  const seedMs = +(performance.now() - start).toFixed(2);
  store.createProject("存储测量", "storage-benchmark");
  store.applyOperations("storage-benchmark", "storage-fixture", 0, operations);
  let revision = 1;
  const read = sample(() => {
    store.getWorkspace("storage-benchmark");
  });
  const moveAndUndo = sample(() => {
    store.applyOperations("storage-benchmark", `move-${revision}`, revision++, [
      { type: "node.update", id: "card-1", patch: { x: 48, y: 48 } },
    ]);
    store.travel("storage-benchmark", "undo", revision++);
  });
  store.deleteProject("storage-benchmark");
  console.log(
    JSON.stringify(
      {
        environment: {
          node: process.version,
          os: `${platform()} ${release()} ${arch()}`,
          cpu: cpus()[0]?.model,
        },
        nodes: canvas.nodes.length,
        edges: canvas.edges.length,
        workspaceBytes: Buffer.byteLength(
          JSON.stringify(store.getWorkspace("canvas-benchmark")),
        ),
        seedMs,
        read,
        moveAndUndo,
      },
      null,
      2,
    ),
  );
} catch (error) {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
  throw error;
}
store.db.close();
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, PORT: process.env.PORT || "3101" },
});
console.log(`Temporary data: ${directory}`);
console.log(
  `Open http://127.0.0.1:${process.env.PORT || "3101"}/projects/canvas-benchmark`,
);
console.log("Stop with Ctrl+C to remove the temporary data.");
const stop = () => {
  server.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.once("close", (code) => {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  rmSync(directory, { recursive: true, force: true });
  if (code) process.exitCode = code;
});
