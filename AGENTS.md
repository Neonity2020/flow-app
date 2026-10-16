# AGENTS.md

## 项目目标

Flow 是本地优先的单人 AI 白板笔记工具。用户在 React Flow 无限画布中组织想法、问题、决策和待办，通过本机 Codex 进行需求追问，并生成一份持续更新的项目 spec。

产品范围以 `docs/spec.md` 为准；架构和实现状态分别见 `docs/architecture.md` 与 `docs/build-status.md`。修改用户可见行为前，先同步对应文档与验收标准。

## 工作方式

- 代码发现优先使用 codebase-memory-mcp：`search_graph`、`trace_path`、`get_code_snippet`、`query_graph`。索引缺失或代码变化较大时先运行 `index_repository`。
- 字符串、配置、Markdown 和脚本搜索可使用 `rg`。
- 保留用户已有修改。当前仓库尚无初始提交，所有文件均可能是尚未提交的重要工作。
- 使用 `apply_patch` 编辑文件。不要手工编辑 `src/routeTree.gen.ts`；它由 TanStack Router/Vite 生成。
- 不要把运行期数据写进仓库。默认数据目录是 `~/.local/share/flow-app/`，测试必须使用临时 `FLOW_DATA_DIR`。
- Node-only 代码只能位于服务端边界，不得从浏览器共享 barrel 导出。构建后检查客户端 bundle 没有 `node:fs`、`node:child_process`、`node:sqlite` 等导入。

## 技术栈与入口

- React 19、TypeScript、TanStack Start / Router / Query。
- React Flow：`@xyflow/react`，主要工作区在 `src/components/Workspace.tsx`。
- Node 24 内置 `node:sqlite`，存储实现位于 `src/server/store.ts`。
- HTTP/SSE 接口位于 `src/server/api.ts`，统一路由入口是 `src/routes/api.$.ts`。
- Codex stdio bridge 位于 `src/server/codex.ts`，AI 工作流位于 `src/server/ai.ts`。
- 共享领域 schema 与纯操作逻辑位于 `src/lib/model.ts`。
- 本地生产服务器位于 `scripts/serve.mjs`。

## 核心不变量

### 数据与并发

- SQLite 是权威存储。当前画布按项目保存为 JSON 快照；`docs/data-model.md` 中的细粒度表是逻辑目标，不代表已落地。
- 所有画布写入必须经过 `applyOperations`，整批校验并在单个事务中提交。不要让 UI 或 AI 直接写数据库。
- 手动操作和 AI 操作共用同一操作协议、项目 revision、请求幂等和撤销历史。
- revision 冲突必须拒绝过期写入，不得静默覆盖用户新编辑。AI 冲突后由用户重新提交。
- spec 有独立 revision。AI 更新或恢复前保存快照；生成期间的手工编辑必须阻止覆盖。
- 项目隔离在服务端校验。附件只能按数据库 ID 读取，不能接受任意本地路径。

### React Flow

- 使用受控 nodes/edges。选择、测量、拖动中的临时位置属于 UI 状态；拖动结束才提交一次持久化操作。
- 数据库只存领域字段，不存 React Flow 内部对象、组件或回调。
- AI 默认只布局自己新建的卡片；只有用户明确要求整理时才移动已有卡片。
- 删除节点同时删除关联边，并可作为一个批次撤销。

### Codex

- 使用当前本机 `codex login`，应用不得复制 API Key、Cookie、OAuth 文件或 ChatGPT 凭据。
- bridge 必须通过 `shell: false` 启动，使用空临时 cwd、`read-only` sandbox、`never` approval policy，并在完成、失败、取消时清理子进程和临时目录。
- 普通应用对话禁止 shell、文件系统、浏览器、插件和外部工具。模型只返回结构化结果；应用负责校验并执行操作。
- 保持 `initialize → initialized → thread/start → turn/start` 顺序。协议变化时先用已安装 CLI 重新生成 schema 验证，不要凭记忆修改。
- 图片只展示，不送入模型；链接只保存，不抓取网页。

## 常用命令

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run smoke:codex
npm start
```

`npm run smoke:codex` 会发出一轮真实联网推理，只在需要验证 Codex 集成时运行。其他测试不得依赖用户的实际数据目录。

## 完成标准

对代码改动至少运行 `npm run typecheck` 和相关测试。影响构建边界、路由或服务端模块时运行 `npm run build`。影响 Codex bridge 时运行 `npm run smoke:codex`，并确认取消不会留下孤儿进程。影响核心交互时在桌面浏览器走一遍对应流程。

报告结果时列出实际运行的命令和结果；未运行的检查明确标记。新增限制或未完成项同步写入 `docs/build-status.md`。交接当前工作的详细状态见 `HANDOFF.md`。

