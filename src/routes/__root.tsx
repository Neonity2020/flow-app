import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import "../styles.css";
import "@xyflow/react/dist/style.css";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Flow · 想清楚，再开始" },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <main className="fallback">
      <h1>这里还没有内容</h1>
      <a href="/">回到项目</a>
    </main>
  ),
  errorComponent: ({ error }) => (
    <main className="fallback">
      <h1>暂时无法打开</h1>
      <p>{error instanceof Error ? error.message : "应用发生错误"}</p>
      <a href="/">回到项目</a>
    </main>
  ),
});
function Root() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={client}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
