# Flow 项目交接

最后更新：2026-10-16，Asia/Shanghai。

## 目标与完成边界

本次工作目标是按 `docs/spec.md` 构建本地优先的单人 AI 白板 MVP：React Flow 无限画布、四类卡片、底部 composer、右侧对话、本机 Codex grill、AI 直接操作画布，以及按钮生成和维护单份 spec。

当前状态：**核心闭环已实现并验证，仍是首版工程状态。** 已有 Git 基线；200 卡片／300 连线首轮功能验收、存储基线和真实 AI 更新／恢复／取消回归已完成。长期可靠性、完整备份和浏览器量化性能仍未完成。

## 仓库状态

- 工作区：`/Users/andi/Documents/ChatGPT/flow-app`
- 分支：`main`
- Git：已有初始提交、画布循环修复，以及 `f4978be`（Spec 导出保护和重启测试）。后续基准脚本、SSE 中断修复、验收文档和测试改动尚未提交；接手先运行 `git status --short`，保留已有修改。
- PR / issue：无。
- 运行中的本地服务：请实时检查端口和 PID，不依赖交接时记录。本轮浏览器验证使用端口 3101 与临时数据目录，不修改默认用户数据。
- 本机验证数据：默认数据目录中有一个名为“Flow · 项目探索”的测试项目，包含 4 张卡片、AI 对话和生成的 spec。它不在仓库中，不应被测试或清理脚本修改。

## 已完成

- 项目列表：创建、重命名、打开、删除和本地持久化。
- React Flow 工作区：平移、缩放、适应视图、多选、自定义卡片、连线、连线标签、卡片拖动。
- 四类卡片：想法、问题、决策、待办；支持状态、决策理由、HTTP(S) 链接和图片附件。
- SQLite：初始化 migration、项目隔离、项目级 revision、批次事务、请求幂等、撤销/重做、运行事件和 spec 快照。
- AI：本机 Codex 登录检测、stdio JSON-RPC、结构化输出、SSE 流式回复、选择范围限制、操作校验、最多三次格式修正、取消和重启中断状态。
- spec：生成/更新同一文档、手工编辑、自动保存、覆盖保护、恢复记录和 Markdown 导出。
- 导出前等待最新编辑保存；保存失败时保留草稿并阻止下载旧版本。下载内容取自本次保存的文本，避免再次读取时混入其他标签页更新。
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
| `npm test` | passed | 20 tests，0 failed，含独立进程重启、大画布、AI 故障注入和 SSE 中断／增量重放 |
| `npm run build` | passed | client 与 SSR server 构建成功 |
| `npm run smoke:codex` | passed | `initialize → initialized → thread/start → turn/start → completed` |
| 浏览器创建项目和卡片 | passed | 项目与卡片保存，刷新后仍存在 |
| 真实 AI 操作画布 | passed | AI 创建 2 张决策卡、1 张问题卡和 2 条连线，并完成取舍追问 |
| 生成 spec | passed | 生成单份 Markdown spec 并在面板显示 |
| 手工编辑 spec | passed | 自动保存后关闭面板成功 |
| `npm run bench:canvas` | passed | 隔离生产服务，200 卡片／300 连线，存储测量和桌面交互验收见 `docs/performance-baseline.md` |

本轮浏览器回归在隔离生产服务上验证输入后立即导出，实际下载文件包含最新完整文字；模拟另一标签页先写入后，保存冲突保留草稿并阻止导出。新集成测试覆盖真实进程重启后的数据、事件、快照恢复与恢复回更新版、项目隔离和任务锁释放。浏览器交互仍需补充自动化回归。

后续一轮补充验收：`npm run bench:canvas` 创建隔离服务和大画布，完成平移／缩放／框选／两卡拖动一次提交／撤销／刷新恢复；基线详见 `docs/performance-baseline.md`。同一隔离服务另建待办清单项目，通过真实 AI 决策、生成 spec、人工编辑、更新保留备注、恢复人工版及恢复回更新版。随后启动新任务并在浏览器停止，确认 cancelled、无新写入、关联两个 Codex 进程退出且临时会话目录清理。

本轮新增 `tests/ai.test.ts` 与离线 `tests/fixtures/fake-codex.mjs`，通过 APP_CODEX_COMMAND 临时可执行文件模拟协议，不修改生产配置或使用真实凭据。覆盖修正成功／三次耗尽、请求去重、画布与 spec 冲突、取消及 failed 通知。`tests/stream.test.ts` 复现并保护 SSE 请求中断清理；修复位于 `src/server/api.ts`。隔离生产浏览器已验证运行中刷新、继续执行并收到唯一回复；模拟场景不等于真实网络故障演练。

## 尚未完成或未充分验证

1. 修正成功和三次耗尽已有离线故障注入覆盖；真实网络断连、强杀、CLI 协议不兼容仍待演练，不将模拟结果视为跨版本兼容证据。
2. 真实 AI 更新及浏览器恢复流程已在待办清单场景通过；“设计 Flow”同场景完整闭环仍未重跑。
3. 200 卡片／300 连线首轮桌面功能验收和存储耗时基线已完成；浏览器 FPS、长任务、内存和指针响应延迟尚未测量，不能宣称所有设备流畅。
4. 独立进程重启后运行中任务标记为 interrupted 已有集成测试；生产服务运行中强杀及浏览器断线重连仍需故障演练。
5. 演练跨标签页持续编辑、磁盘满、进程强杀和 Codex 协议不兼容。
6. 完整项目备份 UI、长上下文自动摘要、数据库升级 migration 及升级前一致性备份仍未实现。
7. 视觉界面主要在 1440×900 桌面视口验证；移动端只做了 CSS 降级，没有完整交互验收。

## 推荐的接手顺序

1. 阅读 `AGENTS.md`、`docs/spec.md` 和 `docs/build-status.md`，再运行 `git status --short` 确认没有新的用户修改。
2. 执行 `npm install`（若依赖已存在可跳过），然后运行类型检查、测试和构建。
3. 检查端口 3000；若现有服务是旧构建，先正常终止该进程，再用 `npm run dev` 或重新 `npm run build && npm start`。
4. 运行 `npm run smoke:codex`。若失败，先检查 `codex login status` 和已安装 App Server schema，不要改为读取 API Key。
5. 在浏览器完成一轮真实 grill、AI 画布操作、更新 spec、恢复快照和刷新持久化。
6. 200 节点 / 300 边 fixture 与存储基线已建立，运行 `npm run bench:canvas` 可重复验收；后续有卡顿证据时先补浏览器 trace，再决定渲染优化。
7. 已有首个 Git 提交；继续检查当前差异，提交前确认本机数据库和附件未被纳入。

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

- Git 已有基线，但本轮修改尚未提交；避免 `git clean`、`git reset --hard` 和覆盖式脚手架命令丢弃工作。
- 不要把测试指向默认数据目录。测试项目数据属于本机运行状态，源码验证应使用临时目录。
- spec 覆盖或恢复前已有自动快照；画布撤销历史在 SQLite 中，但 MVP 不保证跨重启继续撤销。
- 如果本地数据库无法打开，先复制整个数据目录（包括 WAL/SHM）再诊断；不要删除数据库让应用“自动修复”。
- 如果 Codex 任务卡住，先通过应用取消；必要时只终止确认属于 Flow 的 `codex app-server` 子进程，避免影响其他 Codex 会话。

