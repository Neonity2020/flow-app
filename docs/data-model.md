# 数据与存储

## 通用约定

ID 使用应用生成的唯一字符串；时间存 UTC，展示时按客户端时区转换。SQLite 启用外键并通过 migration 管理 schema。状态和类型在服务端做枚举校验，数据库使用可行的 CHECK 约束。

以下为逻辑模型，具体 SQL 以实现 migration 为准。项目之间的引用必须由领域层校验，不能仅依赖单列外键。

| 实体 | 字段与约束 |
| --- | --- |
| Project | id PK、ownerId、name、revision、createdAt、updatedAt；ownerId 当前为固定本地用户 |
| CanvasNode | id PK、projectId FK、type、title、body、x/y、width/height、status、blocking、decisionReason、revision |
| CanvasEdge | id PK、projectId FK、sourceId/targetId FK、label、revision；端点必须属于当前项目 |
| Attachment | id PK、projectId FK、relativePath UNIQUE、originalName、mimeType、size、createdAt |
| NodeAttachment | nodeId + attachmentId 联合主键；两个对象必须属于同项目 |
| Message | id PK、projectId FK、role、content、runId、selectionContext JSON、createdAt、status |
| AiRun | id PK、projectId FK、kind、status、error JSON、startedAt、completedAt |
| OperationBatch | id PK、projectId FK、runId nullable、forwardOperations JSON、inverseOperations JSON、createdAt、undoState |
| SpecDocument | projectId PK/FK、content、revision、sourceProjectRevision、updatedAt |
| SpecSnapshot | id PK、projectId FK、content、createdAt、reason |
| RunEvent（拟定） | runId + sequence 联合唯一、type、payload JSON、createdAt；用于断线重放 |

按项目与更新时间查询项目数据，消息按项目和时间排序；为相关外键及事件序号建立索引。操作批次 ID 也是幂等键，同一 ID 不得重复执行或携带不同内容。

## 修订与事务

项目 revision 仅在影响项目知识或 spec 的内容变更时递增，不因选择、视口或 AI 流式字符递增。节点和连线独立递增 revision。spec 更新时记录对应输入的项目 revision，后续知识变化据此提示过期。

创建/更新/删除及关联变化在同一事务完成。删除节点必须保存节点、附件引用和关联连线的逆操作。撤销也验证当前状态；有依赖冲突则失败并说明，不恢复出无效引用。

每项目维护有序撤销栈，手动操作与 AI 批次统一入栈；AI 一批是一个单元。新编辑清空重做分支。文本连续输入和拖动合并成有边界的一次操作。聊天不随撤销删除。MVP 不保证重启后延续撤销栈。

spec 使用独立快照机制。生成、恢复时先在同一事务中保存当前文档快照，再校验并写入新文档；空文档初次生成无需制造无意义快照。

## 附件生命周期

上传先校验图片类型、字节大小与实际文件格式，再写临时文件并移动到应用附件目录，最后建立数据库引用。数据库提交失败时清理新文件；启动时可清理无引用临时文件。

原始文件名仅用于展示，不参与路径拼接；存储路径由服务生成。读取仅接受附件 ID，校验项目归属和实际路径位于附件根目录。拒绝 SVG 等可执行内容，首批支持 PNG、JPEG、WebP、GIF；大小上限待实测确定。

普通删除节点保留可撤销所需附件；清理不能破坏仍在恢复范围中的引用。删除项目后清理其附件；文件清理失败记录并可重试，不恢复已经删除的项目。

## 故障与备份

保存失败保留客户端草稿；持久化成功才标记已保存。迁移失败应中止启动并报告，不自动清库。迁移前保留可恢复备份；备份数据库需使用 SQLite 一致性快照方式，不能在运行时只拷贝主文件而遗漏 WAL。

完整备份包括数据库和附件目录。MVP 不提供云备份或备份管理 UI；Markdown 导出只包含 spec 文本，不代表完整项目备份。
