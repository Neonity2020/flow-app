# 接口与操作协议

本文定义逻辑契约，具体 URL、函数名称和 schema 在实现时固化。可用 TanStack Start 服务端函数承载请求；流式接口独立实现。所有输入必须在服务端校验。

## 请求约定

写操作携带 `requestId`、`projectId` 和适用的 `expectedRevision`。重复 requestId 返回原结果，不再次执行；同 ID 不同内容返回冲突。错误包含稳定 code、可读 message、可选 details，不向浏览器暴露进程环境或凭据。

错误分类：`VALIDATION_ERROR`、`NOT_FOUND`、`REVISION_CONFLICT`、`RUN_ACTIVE`、`CODEX_UNAVAILABLE`、`CODEX_AUTH_REQUIRED`、`PROTOCOL_ERROR`、`STORAGE_ERROR`、`CANCELLED`。HTTP 承载时分别使用合适的 4xx/5xx 状态，领域错误仍保留 code。

## 服务能力

| 能力 | 输入 | 结果 |
| --- | --- | --- |
| listProjects | 无 | 项目摘要列表 |
| createProject | name、requestId | 新项目 |
| renameProject / deleteProject | projectId、修订、requestId | 更新结果 / 删除结果 |
| getWorkspace | projectId | 项目、卡片、连线、附件元数据、spec 摘要、活跃任务 |
| applyOperations | projectId、batchId、operations | 已提交批次、最新修订 |
| undo / redo | projectId、batchId、requestId | 结果和更新对象 |
| listMessages | projectId、cursor | 消息分页 |
| uploadAttachment / readAttachment | 项目与文件 / attachmentId | 元数据 / 图片流 |
| startChat | projectId、message、selectedNodeIds、requestId | runId、已保存用户消息 |
| generateSpec | projectId、specRevision、requestId | runId |
| cancelRun / getRun | projectId、runId | 任务状态 |
| subscribeRun | projectId、runId、afterSequence | 事件流 |
| getSpec / saveSpec | projectId、正文与修订（保存时） | 当前文档 |
| listSpecSnapshots / restoreSpec | projectId、snapshotId（恢复时）、当前修订 | 快照列表 / 当前文档 |
| exportSpec | projectId | UTF-8 Markdown 下载 |
| getCodexStatus | 无 | 未安装 / 未登录 / 可用 / 错误 |

## 画布领域操作

所有操作使用带 `type` 的判别联合，禁止未知字段。更新和删除需提供目标 `expectedRevision`；创建对象 ID 由应用生成或在执行前规范化。一次批次中的新建对象可被同批后续操作引用。

| type | 内容 |
| --- | --- |
| node.create | type、title、body、位置尺寸、可选类型字段 |
| node.update | id、expectedRevision、允许修改的字段 patch |
| node.delete | id、expectedRevision |
| edge.create | sourceId、targetId、label |
| edge.update | id、expectedRevision、label |
| edge.delete | id、expectedRevision |
| layout.apply | 节点 ID、expectedRevision 和位置列表 |

布局、类型切换与状态更新均需校验。问题专属状态不能混用待办状态；从决策切换类型时按显式规则清理不适用字段。数值必须有限，尺寸必须为正。删除不存在对象不视为成功的新操作，幂等由批次记录实现。

服务先验证完整批次，再在事务中校验修订并执行、生成逆操作、保存批次及运行事件。批次包含无效引用、越界范围或冲突时全部拒绝。修正后使用新的批次 ID。

AI 不能提交任意路径、SQL、JavaScript、React Flow 内部事件或组件状态。附件导入由用户触发；AI 只可引用已授权项目附件。

## 流式事件

每个事件包含 `runId`、单调递增 `sequence`、`type`、`payload`。拟定类型：`run.started`、`message.delta`、`operations.committed`、`operations.rejected`、`spec.committed`、`run.completed`、`run.failed`、`run.cancelled`。

客户端按序号去重，重连使用最后已处理序号。事件反映已经提交的结果；不能先宣告画布成功再写数据库。终态事件使界面退出忙碌状态。服务端保留运行状态，客户端断线不会启动第二个任务。

## 认证占位

服务调用通过统一 `resolvePrincipal` 获得固定本地用户，仓储查询按 ownerId 过滤。未来认证实现替换此边界；MVP 不返回伪造 token，也不开放无用途的注册 API。
