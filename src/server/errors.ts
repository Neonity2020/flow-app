import { AppError } from "../lib/model";

export function appError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const failure = error as { errcode?: unknown; code?: unknown } | null;
  const sqliteCode =
    typeof failure?.errcode === "number" ? failure.errcode & 0xff : 0;
  if (
    sqliteCode === 13 ||
    failure?.code === "ENOSPC" ||
    failure?.code === "EDQUOT"
  )
    return new AppError(
      "STORAGE_FULL",
      "本地存储空间不足，无法完成写入。请释放数据所在磁盘的空间后重试。",
      507,
    );
  if (sqliteCode === 5 || sqliteCode === 6)
    return new AppError(
      "STORAGE_BUSY",
      "本地数据库正被其他写入占用，无法完成写入。请稍后重试。",
      503,
    );
  return new AppError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "本地服务发生错误",
    500,
  );
}
