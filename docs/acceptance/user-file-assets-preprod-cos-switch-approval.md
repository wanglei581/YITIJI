# 用户文件资产预生产 COS bucket 切换审批包

> 状态：APPROVAL / INPUT REQUIRED，尚未切换。
> 背景：Gate 3 安全子集已通过；G3-06 `verify:cos:live` 与 Gate 4 因当前预生产 env 指向生产语义 COS bucket 而暂停。
> 口径：本文只定义预生产 COS bucket 隔离切换的目标、边界、前置输入、验证和回滚；不代表已经创建 bucket、修改服务器 env、执行 COS live 或完成 Gate 4。

## 一、当前阻塞

预生产服务器只读取证结果：

```text
COS_BUCKET_PROOF fp=7637995480 strict_nonprod=false prod_label=true project_label=true
```

该指纹与历史生产私有桶记录一致。当前不得设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`，不得执行 `verify:cos:live`，不得进入 Gate 4 文件上传、删除三态和过期清理验收。

## 二、目标

- 将预生产服务器的用户文件资产 COS 配置切换到明确隔离的预生产 bucket。
- 保持 PostgreSQL、Redis、短信、OCR、AI/TRTC、ASR/TTS、nginx、PM2 进程配置不变，除非本文显式列入。
- 切换后执行 G3-06 `verify:cos:live`，只写入 `tmp/uploads/cos-live-verify/` 下的一次性对象并清理。
- G3-06 通过后，再另行进入 Gate 4 会员账号和文件资产验收。

## 三、非目标

- 不修改正式生产 bucket、生产 CAM 策略或生产业务文件。
- 不配置 bucket 全局过期规则。
- 不执行 Gate 4 浏览器账号验收。
- 不创建真实用户文件，不修改保存期限，不执行过期清理。
- 不修改短信、OCR、AI/TRTC、ASR/TTS、域名、证书、nginx 或数据库 schema。

## 四、需要用户提供或确认的信息

| 项目 | 要求 |
| --- | --- |
| 预生产 bucket 名 | 必须包含明确非生产语义，例如 `preprod` / `staging` / `test` / `uat`；不得与当前生产语义 bucket 相同。 |
| Region | 建议与当前预生产服务器就近；必须与腾讯云 COS bucket 实际 region 一致。 |
| Bucket 权限 | 私有读写；禁止公共读写。 |
| CAM 权限 | 最小权限：仅允许该预生产 bucket 所需的对象级 put/head/get/delete 和签名下载验证所需权限；不得扩大到生产 bucket。 |
| 生命周期规则 | 禁止配置覆盖 `users/`、会员简历、AI 成果物或 `long_term` 对象的 bucket 全局过期规则。 |
| CORS / 直传 | 如 Gate 4 需要浏览器直传，需按当前前端域名配置最小 CORS；G3-06 服务端 live 冒烟不依赖浏览器 CORS。 |
| 凭据来源 | 是否沿用现有 CAM 子用户并缩小/拆分权限，或新建预生产专用 CAM 子用户。 |

## 五、允许修改范围

远端服务器：

- 备份 `/srv/ai-job-print/services/api/.env` 到 `/srv/ai-job-print-env-backups/`。
- 仅修改 `/srv/ai-job-print/services/api/.env` 中以下键：
  - `TENCENT_COS_BUCKET`
  - `TENCENT_COS_REGION`
  - 如用户提供预生产专用 CAM key，才修改 `TENCENT_COS_SECRET_ID` / `TENCENT_COS_SECRET_KEY`
- 重启既有 PM2 进程 `ai-job-print-api`。
- 执行 health 复核和 G3-06 `verify:cos:live`。

仓库：

- 更新本文执行记录。
- 更新 `docs/acceptance/user-file-assets-preprod-execution-record.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 的脱敏结果。
- 如需要，更新 `verify:file-assets-trial-acceptance` 的防回退断言。

## 六、禁止事项

- 禁止打印或提交完整 `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、完整签名 URL 查询串。
- 禁止在仓库新增 `.env` 或密钥备份。
- 禁止运行会写真实用户文件或清理真实用户对象的命令。
- 禁止修改生产 bucket 生命周期规则。
- 禁止把当前 `prod_label=true` 的 bucket 继续当作预生产验收 bucket。

## 七、执行步骤

1. 用户在腾讯云控制台创建或确认预生产 bucket，并确认权限、region、生命周期规则。
2. 只读记录预生产 bucket 的脱敏标签：`strict_nonprod=true`、`prod_label=false`、bucket 指纹。
3. 备份远端 API `.env`。
4. 修改远端 API `.env` 的 COS 相关键。
5. 重启 PM2 `ai-job-print-api`。
6. 复核 `GET /api/v1/health` 为 `success=true`、`db=postgres`。
7. 设置一次性执行环境 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`，运行 `pnpm --filter @ai-job-print/api verify:cos:live`。
8. 确认 G3-06 日志只包含脱敏 bucket 指纹、region、一次性 objectKey 类别，不包含密钥或完整签名 URL 查询串。
9. 如 G3-06 通过，更新执行记录；如失败，执行回滚。

## 八、验证方式

- `GET /api/v1/health`：`success=true`、`db=postgres`。
- `verify:cos:live`：put/head/get/signed-url/delete 全部 PASS，且跑完删除无残留。
- PM2：`ai-job-print-api` online。
- 日志脱敏检查：无密钥、token、完整签名 URL 查询串、完整手机号、简历正文。
- 本地仓库：`verify:file-assets-trial-acceptance`、API typecheck、`git diff --check`、严格敏感信息扫描。
- Claude + Antigravity 双模型审查。

## 九、回滚方式

- 将 `/srv/ai-job-print/services/api/.env` 恢复为切换前备份。
- 重启 PM2 `ai-job-print-api`。
- 复核 health。
- 不删除或修改任何生产 bucket 对象。
- 记录失败原因、回滚时间、回滚后 COS bucket 脱敏指纹。

## 十、当前结论

```text
PREPRODUCTION COS SWITCH NOT EXECUTED
阻塞项：缺少明确隔离的预生产 bucket 名、region、权限和 CAM 策略确认
下一步：用户提供/确认预生产 bucket 后，才能执行远端 .env 切换和 G3-06 COS live
```
