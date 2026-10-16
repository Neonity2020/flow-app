# Flow

本地优先的 AI 项目思考白板。通过 React Flow 组织想法、问题、决策和待办，与本机 Codex 追问需求，再生成一份可编辑的项目 spec。

## 启动

需要 Node.js 24.15+，以及已安装并登录的 Codex CLI。

```sh
npm install
codex login
npm run dev
```

访问 <http://127.0.0.1:3000>。生产模式：

```sh
npm run build
npm start
```

服务只监听本机地址。数据默认写入 `~/.local/share/flow-app/`，其中 `flow.sqlite` 是数据库，`attachments/` 保存图片。源码目录不存用户数据。

可选环境变量：

- `FLOW_DATA_DIR`：数据目录的绝对路径。
- `APP_CODEX_COMMAND`：Codex 可执行文件的绝对路径。
- `PORT`：生产服务器端口，默认 3000。

在 shell 中设置环境变量后启动；`.env.example` 仅为说明文件，生产入口不会自动载入 `.env`。

## 使用

1. 创建项目，添加卡片，或从底部输入框向 AI 描述想法。
2. 双击卡片编辑文字、类型、状态、网址及图片；拖动两侧连接点建立关系，双击连线修改描述。
3. 选中卡片后提问，AI 将在该范围内修改；清除选择后讨论整个项目。
4. 工具栏撤销和重做包含手动编辑与 AI 整批操作。对话记录保留。
5. 点击“生成 spec”，在文档面板中编辑、导出或恢复旧内容。后续点击“更新 spec”更新同一份文档。

支持 PNG、JPEG、WebP、GIF，单个文件不超过 10 MB。图片只展示，网址只保存，不自动抓取或识别。

## 检查

```sh
npm run typecheck
npm test
npm run build
npm run smoke:codex
```

`smoke:codex` 会通过本机登录发出一轮真实 AI 请求。其他自动化测试使用临时数据目录。

本地编辑不依赖 AI 在线；AI 推理通过 Codex 联网。应用不保存或复制 Codex 登录凭据。

需求与技术文档见 [docs/README.md](docs/README.md)，实现验证记录见 [docs/build-status.md](docs/build-status.md)。
