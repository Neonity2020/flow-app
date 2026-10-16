# 存储故障与恢复验收

日期：2026-10-16，Asia/Shanghai。对应 M1／M2 的事务一致性、M3 的失败处理和 M4 的保存保护。

## 可重复检查

```sh
npx tsx --test tests/storage-faults.test.ts tests/restart.test.ts tests/ai.test.ts
```

所有测试使用系统临时 `FLOW_DATA_DIR`，结束后清理；不读取默认用户数据，不填满实际磁盘。AI 测试使用离线协议模拟进程。

| 故障 | 验证方式 | 结果 |
| --- | --- | --- |
| spec 写入空间不足 | 将当前连接的 SQLite max_page_count 限制为现有页数加少量页，再写大文档 | 保留原始 SQLITE_FULL，旧文档与 revision 不变，没有多余恢复快照；放宽限制后可保存 |
| 画布写入空间不足 | 限制页数，提交 30,000 字符卡片正文 | 画布、revision、history、requests 全部回滚；恢复容量后同一批次 ID 可重试 |
| 数据库被占用 | 第二个真实 SQLite 连接持有 BEGIN IMMEDIATE 写锁 | 写入失败不更改 revision；释放锁后同一批次可提交 |
| HTTP 故障反馈 | 经真实 API handler 提交上述写入 | 空间不足返回 507／STORAGE_FULL，占用返回 503／STORAGE_BUSY，显示中文处理建议 |
| AI 应用操作遇到 FULL | 让模拟进程完成有效输出，再限制数据库容量 | 本轮失败且保留原画布，只调用一次模型，不进入格式修正分支 |
| 模型 JSON 格式错误 | 连续返回不完整 JSON、operations 无效 JSON，第三次返回有效结果 | 格式修正仍正常，最终只保存接受的回复 |
| 未提交事务中强杀 | 子进程先提交画布、spec、消息和运行，再开启新事务修改，父进程发 SIGKILL | 新进程恢复已提交数据，未提交的画布／spec／事件全部消失；运行标记 interrupted；integrity_check=ok，foreign_key_check 为空 |

容量限制触发的 FULL 会使 SQLite 自动结束事务。原实现随后无条件 ROLLBACK，将根因替换成“没有活动事务”；修复后先检查 isTransaction，保留原始错误供 API 和 AI 分类。

AI 只对 JSON／schema 错误以及无效领域引用请求格式修正；存储、修订冲突等基础设施错误不会交回模型重试。若物理磁盘满到连失败状态也无法写入，仍可能需要服务重启后将运行标记为 interrupted；本次页数限制测试不证明该极端情况已解决。

## 浏览器恢复流程

生产构建，端口 3103，临时数据目录；独立连接持有数据库写锁：

1. 打开已有 spec，输入新内容并关闭面板以触发保存。
2. 等待写锁超时后显示“保存失败”和具体占用提示；面板不关闭，最新草稿保留。
3. 释放写锁，点击“重试”，状态变为“已保存”，更新 spec 按钮重新可用。
4. 服务端文档 revision 从 1 增加到 2，正文与草稿一致；成功后关闭面板。

浏览器步骤为工具驱动实测，未纳入自动化 E2E。

## 未覆盖范围

未制造物理磁盘 ENOSPC／EDQUOT、文件系统 I/O 损坏或断电；文件系统错误分类已实现但尚无实际配额故障演练。SIGKILL 测试只覆盖 SQLite 工作进程，未覆盖服务携带活跃真实 Codex 子进程时的强杀、重启竞态或跨 CLI 版本兼容。未验证持久存储硬件对 WAL fsync 的承诺。
