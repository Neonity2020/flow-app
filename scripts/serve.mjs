import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Readable } from "node:stream";
import handler from "../dist/server/server.js";
const root = resolve("dist/client");
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + req.headers.host);
    const path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (
      path.startsWith(root + sep) &&
      (await stat(path)
        .then((s) => s.isFile())
        .catch(() => false))
    ) {
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(await readFile(path));
      return;
    }
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : Readable.toWeb(req),
      duplex: "half",
      signal: abort.signal,
    });
    const response = await handler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      Readable.fromWeb(response.body)
        .on("error", () => res.destroy())
        .pipe(res);
    else res.end();
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end("本地服务发生错误");
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, "127.0.0.1", () =>
  console.log(`Flow is running at http://127.0.0.1:${port}`),
);
