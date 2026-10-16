# Flow 项目交接

最后更新：2026-10-16，Asia/Shanghai。

## 目标与完成边界

本次工作目标是按 `docs/spec.md` 构建本地优先的单人 AI 白板 MVP：React Flow 无限画布、四类卡片、底部 composer、右侧对话、本机 Codex grill、AI 直接操作画布，以及按钮生成和维护单份 spec。

当前状态：**核心闭环已实现并验证，仍是首版工程状态。** 应用可运行，但尚未建立 Git 基线，也未完成长期可靠性、完整备份和大规模性能验收。

## 仓库状态

- 工作区：`/Users/andi/Documents/ChatGPT/flow-app`
- 分支：`master`
- Git：仓库没有任何提交；当前全部实现和文档均为未跟踪文件。接手时先运行 `git status --short`，不要用 reset、clean 或 checkout 丢弃现有内容。
- PR / issue：无。
- 运行中的本地服务：交接生成时 `node scripts/serve.mjs` 正监听 `127.0.0.1:3000`。PID 会变化，不应写死；用下方命令检查。
- 本机验证数据：默认数据目录中有一个名为“Flow · 项目探索”的测试项目，包含 4 张卡片、AI 对话和生成的 spec。它不在仓库中，不应被测试或清理脚本修改。

## 已完成

- 项目列表：创建、重命名、打开、删除和本地持久化。
- React Flow 工作区：平移、缩放、适应视图、多选、自定义卡片、连线、连线标签、卡片拖动。
- 四类卡片：想法、问题、决策、待办；支持状态、决策理由、HTTP(S) 链接和图片附件。
- SQLite：初始化 migration、项目隔离、项目级 revision、批次事务、请求幂等、撤销/重做、运行事件和 spec 快照。
- AI：本机 Codex 登录检测、stdio JSON-RPC、结构化输出、SSE 流式回复、选择范围限制、操作校验、最多三次格式修正、取消和重启中断状态。
- spec：生成/更新同一文档、手工编辑、自动保存、覆盖保护、恢复记录和 Markdown 导出。
- 安全边界：loopback 服务、同源写请求检查、附件字节签名校验、附件项目隔离、Node-only bridge。
- 文档系统：需求、产品交互、架构、数据、接口、AI 工作流、实施顺序、决策和构建状态。

## 关键文件

| 路径 | 作用 |
| --- | --- |
| `src/components/Workspace.tsx` | React Flow 工作区、对话、操作队列、SSE 和 spec 入口 |
| `src/components/Editor.tsx` | 卡片编辑、自动保存、链接和图片 |
| `src/components/SpecPanel.tsx` | spec 编辑、保存、恢复和导出入口 |
| `src/lib/model.ts` | 卡片/边 schema、操作协议和纯画布变换 |
| `src/server/store.ts` | SQLite schema、事务、revision、历史、消息、运行和 spec |
| `src/server/api.ts` | 本地 HTTP/SSE 接口、同源检查和附件处理 |
| `src/server/codex.ts` | Codex App Server 生命周期和流式 JSON-RPC |
| `src/server/ai.ts` | grill prompt、上下文、结构化结果、重试和应用操作 |
| `scripts/serve.mjs` | 生产构建的 loopback Node server |
| `tests/*.test.ts` | 领域、存储和 API 关键失效路径 |
| `docs/build-status.md` | 已实现能力、验证证据和限制 |

## 关键决策与约束

- 画布目前存为项目级 JSON 快照；历史保存前后快照。不要误以为 `docs/data-model.md` 中的 CanvasNode/CanvasEdge 独立表已经实现。
- 并发策略是项目级乐观 revision。它较保守，但能保证 AI 不覆盖用户在运行期间的新编辑。
- UI 中的拖动变化先本地显示，结束时才形成一次持久化操作。
- AI 没有数据库、文件、shell 或浏览器权限；它只返回 `content`、JSON 编码的 `operations` 和 `spec`。
- 真实 AI 输出可能第一次不符合操作 schema。`src/server/ai.ts` 最多重试三次；revision 冲突不自动重试，避免覆盖。
- spec 与画布分别使用 revision。手工 spec 编辑未保存时，顶部生成/更新按钮会被禁用。
- 运行数据默认位于 `~/.local/share/flow-app/`。自动化测试通过临时 `FLOW_DATA_DIR` 隔离数据。
- `src/routeTree.gen.ts` 是生成文件，不要手工修改。

## 验证记录

以下检查在 2026-10-16 实际运行并通过：

| 命令或检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | passed | TypeScript 无错误 |
| `npm test` | passed | 9 tests，0 failed |
| `npm run build` | passed | client 与 SSR server 构建成功 |
| `npm run smoke:codex` | passed | `initialize → initialized → thread/start → turn/start → completed` |
| 浏览器创建项目和卡片 | passed | 项目与卡片保存，刷新后仍存在 |
| 真实 AI 操作画布 | passed | AI 创建 2 张决策卡、1 张问题卡和 2 条连线，并完成取舍追问 |
| 生成 spec | passed | 生成单份 Markdown spec 并在面板显示 |
| 手工编辑 spec | passed | 自动保存后关闭面板成功 |

最后一次源码修改后又运行了 `npm run typecheck && npm test && npm run build`，结果通过。最后一次 `smoke:codex` 发生在此前的 bridge 实现上；随后对 `src/server/ai.ts` 增加了结果修正循环和 prompt 约束，**尚未再次运行真实 Codex smoke test**。

## 尚未完成或未充分验证

1. 重新运行 `npm run smoke:codex`，并在浏览器发一轮真实对话，确认新增三次修正循环未破坏流式展示。
2. 验证第二次“更新 spec”完成后，恢复记录包含人工编辑前的快照，并实际恢复一次再撤回。上次浏览器验证在任务中断时正在进行，更新按钮已触发，但最终结果未记录。
3. 用 200 张文本卡片和 300 条边执行性能基线；当前只验证了 4 张卡片的真实流程。
4. 测试刷新和生产服务重启后的完整恢复，尤其是运行中任务标记为 interrupted。
5. 演练跨标签页持续编辑、磁盘满、进程强杀和 Codex 协议不兼容。
6. 完整项目备份 UI、长上下文自动摘要、数据库升级 migration 及升级前一致性备份仍未实现。
7. 视觉界面主要在 1440×900 桌面视口验证；移动端只做了 CSS 降级，没有完整交互验收。

## 推荐的接手顺序

1. 阅读 `AGENTS.md`、`docs/spec.md` 和 `docs/build-status.md`，再运行 `git status --short` 确认没有新的用户修改。
2. 执行 `npm install`（若依赖已存在可跳过），然后运行类型检查、测试和构建。
3. 检查端口 3000；若现有服务是旧构建，先正常终止该进程，再用 `npm run dev` 或重新 `npm run build && npm start`。
4. 运行 `npm run smoke:codex`。若失败，先检查 `codex login status` 和已安装 App Server schema，不要改为读取 API Key。
5. 在浏览器完成一轮真实 grill、AI 画布操作、更新 spec、恢复快照和刷新持久化。
6. 建立 200 节点 / 300 边性能 fixture 与基线，再决定是否需要 memo、视口裁剪或数据分页。
7. 验证完成后建立首个 Git 提交，形成可回退基线；提交前再次确认本机数据库和附件未被纳入。

## 恢复上下文命令

```sh
cd /Users/andi/Documents/ChatGPT/flow-app
git status --short
node --version
codex login status
npm run typecheck
npm test
npm run build
npm run smoke:codex
ps -ax -o pid=,command= | rg 'scripts/serve.mjs|vite dev' || true
curl -fsS http://127.0.0.1:3000/api/projects
```

开发运行：

```sh
npm run dev
```

生产构建运行：

```sh
npm run build
npm start
```

## 风险与恢复

- 当前没有 commit，Git 不能恢复这些文件；在建立初始提交前尤其避免 `git clean`、`git reset --hard` 和覆盖式脚手架命令。
- 不要把测试指向默认数据目录。测试项目数据属于本机运行状态，源码验证应使用临时目录。
- spec 覆盖或恢复前已有自动快照；画布撤销历史在 SQLite 中，但 MVP 不保证跨重启继续撤销。
- 如果本地数据库无法打开，先复制整个数据目录（包括 WAL/SHM）再诊断；不要删除数据库让应用“自动修复”。
- 如果 Codex 任务卡住，先通过应用取消；必要时只终止确认属于 Flow 的 `codex app-server` 子进程，避免影响其他 Codex 会话。

