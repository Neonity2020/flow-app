import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppError, operationSchema } from "../lib/model";
import * as store from "./store";
import { codexStatus } from "./codex";
import { startRun, cancelRun } from "./ai";
const id = z.string().min(1).max(100);
const revision = z.number().int().min(0);
const json = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
export async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new AppError("FORBIDDEN", "仅支持本机访问", 403);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new AppError("FORBIDDEN", "请求来源无效", 403);
      if (request.headers.get("sec-fetch-site") === "cross-site")
        throw new AppError("FORBIDDEN", "跨站请求无效", 403);
    }
    const path = url.pathname
      .replace(/^\/api\//, "")
      .split("/")
      .map(decodeURIComponent);
    if (path[0] === "codex" && request.method === "GET")
      return json(await codexStatus());
    if (path[0] === "projects" && path.length === 1) {
      if (request.method === "GET") return json(store.listProjects());
      const body = z
        .object({ name: z.string().trim().min(1).max(100), id })
        .strict()
        .parse(await request.json());
      return json(store.createProject(body.name, body.id));
    }
    if (path[0] !== "projects" || !path[1])
      throw new AppError("NOT_FOUND", "接口不存在", 404);
    const projectId = id.parse(path[1]);
    store.project(projectId);
    const action = path[2];
    if (!action && request.method === "GET")
      return json(store.getWorkspace(projectId));
    if (action === "events" && request.method === "GET") {
      const runId = id.parse(url.searchParams.get("runId"));
      let after = Number(
        request.headers.get("last-event-id") ||
          url.searchParams.get("after") ||
          0,
      );
      if (!Number.isSafeInteger(after) || after < 0)
        throw new AppError("VALIDATION_ERROR", "事件序号无效");
      store.getRun(projectId, runId);
      const encoder = new TextEncoder();
      let cleanup = () => {};
      const stream = new ReadableStream({
        start(controller) {
          let timer: ReturnType<typeof setInterval> | undefined;
          let stopped = false;
          function stop() {
            stopped = true;
            clearInterval(timer);
            request.signal.removeEventListener("abort", close);
          }
          function close() {
            if (stopped) return;
            stop();
            controller.close();
          }
          cleanup = stop;
          request.signal.addEventListener("abort", close, { once: true });
          if (request.signal.aborted) {
            close();
            return;
          }
          function tick() {
            if (stopped) return;
            try {
              for (const event of store.runEvents(projectId, runId, after)) {
                controller.enqueue(
                  encoder.encode(
                    `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
                  ),
                );
                after = event.sequence;
              }
              if (store.getRun(projectId, runId).status !== "running") {
                close();
              }
            } catch {
              close();
            }
          }
          timer = setInterval(tick, 250);
          tick();
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    if (action === "snapshots" && request.method === "GET")
      return json(store.snapshots(projectId));
    if (action === "export" && request.method === "GET")
      return new Response(store.getSpec(projectId).content, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": 'attachment; filename="spec.md"',
        },
      });
    if (action === "attachments") {
      if (request.method === "GET") {
        const aid = id.parse(path[3]);
        const a = store.db
          .prepare("SELECT * FROM attachments WHERE id=? AND projectId=?")
          .get(aid, projectId) as { id: string; mime: string } | undefined;
        if (!a) throw new AppError("NOT_FOUND", "图片不存在", 404);
        return new Response(
          await readFile(join(store.dataDir, "attachments", a.id)),
          {
            headers: {
              "Content-Type": a.mime,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=86400",
            },
          },
        );
      }
      if (Number(request.headers.get("content-length") || 0) > 11 * 1024 * 1024)
        throw new AppError("VALIDATION_ERROR", "图片不能超过 10 MB");
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        throw new AppError("VALIDATION_ERROR", "请选择不超过 10 MB 的图片");
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "image/jpeg"
          : bytes
                .subarray(0, 6)
                .toString()
                .match(/^GIF8[79]a$/)
            ? "image/gif"
            : bytes.subarray(0, 4).toString() === "RIFF" &&
                bytes.subarray(8, 12).toString() === "WEBP"
              ? "image/webp"
              : null;
      if (!mime)
        throw new AppError(
          "VALIDATION_ERROR",
          "支持 PNG、JPEG、WebP 和 GIF 图片",
        );
      const aid = randomUUID();
      const dest = join(store.dataDir, "attachments", aid);
      await writeFile(dest, bytes, { flag: "wx" });
      try {
        store.project(projectId);
        store.db
          .prepare("INSERT INTO attachments VALUES(?,?,?,?,?)")
          .run(aid, projectId, file.name, mime, file.size);
      } catch (e) {
        await unlink(dest);
        throw e;
      }
      return json({ id: aid });
    }
    if (request.method !== "POST")
      throw new AppError("NOT_FOUND", "接口不存在", 404);
    const body = await request.json();
    switch (action) {
      case "rename": {
        const b = z
          .object({ name: z.string().trim().min(1).max(100) })
          .strict()
          .parse(body);
        store.renameProject(projectId, b.name);
        return json({ ok: true });
      }
      case "delete": {
        const w = store.getWorkspace(projectId);
        if (w.run?.status === "running") cancelRun(projectId, w.run.id);
        const files = store.db
          .prepare("SELECT id FROM attachments WHERE projectId=?")
          .all(projectId) as { id: string }[];
        store.deleteProject(projectId);
        for (const f of files)
          await unlink(join(store.dataDir, "attachments", f.id)).catch(
            () => {},
          );
        return json({ ok: true });
      }
      case "operations": {
        const b = z
          .object({
            batchId: id,
            revision,
            operations: z.array(operationSchema).min(1).max(200),
          })
          .strict()
          .parse(body);
        return json(
          store.applyOperations(projectId, b.batchId, b.revision, b.operations),
        );
      }
      case "undo":
      case "redo": {
        const b = z.object({ revision }).strict().parse(body);
        return json(store.travel(projectId, action, b.revision));
      }
      case "chat":
      case "generate": {
        const b = z
          .object({
            requestId: id,
            message: z.string().max(30000).default(""),
            selected: z.array(id).max(200).default([]),
          })
          .strict()
          .parse(body);
        if (action === "chat" && !b.message.trim())
          throw new AppError("VALIDATION_ERROR", "请输入内容");
        return json(
          startRun(
            projectId,
            b.requestId,
            action === "chat" ? "chat" : "spec",
            b.message,
            action === "chat" ? b.selected : [],
          ),
        );
      }
      case "cancel": {
        const b = z.object({ runId: id }).strict().parse(body);
        return json(cancelRun(projectId, b.runId));
      }
      case "spec": {
        const b = z
          .object({ content: z.string().max(200000), revision })
          .strict()
          .parse(body);
        return json(store.saveSpec(projectId, b.content, b.revision));
      }
      case "restore": {
        const b = z.object({ snapshotId: id, revision }).strict().parse(body);
        return json(store.restoreSpec(projectId, b.snapshotId, b.revision));
      }
      default:
        throw new AppError("NOT_FOUND", "接口不存在", 404);
    }
  } catch (e) {
    if (e instanceof ZodError)
      return Response.json(
        {
          code: "VALIDATION_ERROR",
          message: e.issues.map((i) => i.message).join("；"),
        },
        { status: 400 },
      );
    const error =
      e instanceof AppError
        ? e
        : new AppError(
            "INTERNAL_ERROR",
            e instanceof Error ? e.message : "本地服务发生错误",
            500,
          );
    return Response.json(
      { code: error.code, message: error.message },
      { status: error.status },
    );
  }
}
