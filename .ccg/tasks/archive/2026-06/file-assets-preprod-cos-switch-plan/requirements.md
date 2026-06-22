# 用户文件资产预生产 COS bucket 切换计划需求

## 用户确认

用户在 COS bucket 隔离阻塞确认后回复：

```text
可以
```

本任务将该确认解释为同意进入下一步预生产 COS bucket 切换准备，但不直接授权在缺少 bucket 名、region、权限和 CAM 策略确认的情况下修改腾讯云或服务器 `.env`。

## 目标

- 输出预生产 COS bucket 切换审批包。
- 明确目标、非目标、允许修改范围、禁止事项、验证方式和回滚方式。
- 列出用户需要提供或确认的腾讯云 COS / CAM 信息。
- 不执行任何写云、写服务器配置或 COS live 操作。

## 非目标

- 不创建 COS bucket。
- 不修改腾讯云 CAM、COS 生命周期或 CORS。
- 不修改服务器 `.env`。
- 不重启 PM2。
- 不执行 `verify:cos:live`。
- 不执行 Gate 4。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `pnpm --filter @ai-job-print/api typecheck`
- `git diff --check`
- 严格敏感信息扫描
- Claude + Antigravity 双模型审查

## 回滚

本任务只新增/更新文档和 CCG 任务归档；如需回滚，撤销本分支提交即可。
