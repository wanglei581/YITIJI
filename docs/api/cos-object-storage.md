# 腾讯云 COS 对象存储接入说明

> 最后更新：2026-06-06
> 关联：[CLAUDE.md](../../CLAUDE.md) §11/§12 · [compliance-boundary.md](../compliance/compliance-boundary.md) 五/六
> 代码：`services/api/src/storage/` · `services/api/src/files/`

本文档说明云端文件存储（上传 / 下载 / 预览 / 持久化）如何接入腾讯云 COS。
**不包含任何真实密钥**；密钥只从环境变量注入，绝不提交仓库、绝不下发前端。

---

## 1. 设计原则

- **统一私有桶**：所有业务文件落同一个私有桶 `yitiji-prod-private-1257025684`（region `ap-guangzhou`），
  **不按用户端 / 企业端 / 管理员端拆桶**，靠 `objectKey 前缀` + 数据库 `FileObject` 记录做分类与授权。
- **可插拔后端**：`StorageService` 后面挂两个后端——本地 FS（`local`，dev 默认）与 COS（`cos`，生产），
  由 `FILE_STORAGE_DRIVER` 切换。切换 COS **不需要改任何业务代码**，现有上传 / 打印 / 文件管理流程透明受益。
- **服务端持密**：`SecretId` / `SecretKey` 只在 `CosStorageBackend` 内持有；前端只拿短期签名 URL。
- **短期签名 URL**：所有对外 URL 都是短 TTL 签名 URL（COS 预签名 / 本地 HMAC 代理），
  默认 30 分钟、合规硬上限 30 分钟（`TENCENT_COS_SIGN_URL_EXPIRES_SECONDS` 超过会被 clamp），无永久公开链接。

---

## 2. 环境变量

`services/api/.env`（样板见 `.env.example`，**不要填真实值进 .env.example**）：

```bash
# 存储后端：local(默认) | cos
FILE_STORAGE_DRIVER=cos

# COS 凭证（仅服务端；来自腾讯云 CAM 访问密钥）
TENCENT_COS_SECRET_ID=<server-only-secret>
TENCENT_COS_SECRET_KEY=<server-only-secret>
TENCENT_COS_BUCKET=yitiji-prod-private-1257025684
TENCENT_COS_REGION=ap-guangzhou
# 签名 URL TTL（秒，≤1800）
TENCENT_COS_SIGN_URL_EXPIRES_SECONDS=1800
```

- `FILE_STORAGE_DRIVER=cos` 时四项 COS 变量必填，缺一启动即报错（fail fast）。
- 即使 `driver=local`，只要四项齐全也会构造 COS 后端，便于读回历史落 COS 的文件。
- 本地 dev 不配 COS 也能跑（`driver=local`），文件落 `FILE_STORAGE_DIR`。

> ⚠️ **生产部署必做（上线风险点）**
> 生产环境必须**显式**设置 `FILE_STORAGE_DRIVER=cos`，并同时配置以下 4 个变量：
> `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_BUCKET`、`TENCENT_COS_REGION`。
>
> **若漏设 `FILE_STORAGE_DRIVER`，API 不会报错,而是按默认 `local` 使用本地 FS——文件不会上传到 COS。**
> 这是一个**静默回落**的上线风险:服务照常运行、无任何报错,但所有上传只落在那台服务器的本地磁盘,
> 换机 / 扩容 / 重建即丢失,且不具备 COS 的持久化与签名分发。部署后请用启动日志确认
> `StorageService driver=cos ... cosAvailable=true`。

---

## 3. objectKey 分类规则

`services/api/src/storage/object-key.ts`，**绝不用原始文件名作 key**，全程限制 `[A-Za-z0-9/_.-]`：

| 用途(purpose) | objectKey 前缀 |
|---|---|
| `resume_upload` / `cover_letter` | `users/{userId}/resumes/{fileId}.{ext}` |
| `resume_scan` / `id_scan` | `users/{userId}/scans/{fileId}.{ext}` |
| `print_doc` | `users/{userId}/print-files/{fileId}.{ext}` |
| `partner_profile` | `partners/{orgId}/profiles/{fileId}.{ext}` |
| `partner_image` | `partners/{orgId}/job-images/{fileId}.{ext}` |
| `partner_video` | `partners/{orgId}/videos/{fileId}.{ext}` |
| `fair_material` / `job_fair_material` | `partners/{orgId}/job-fair-materials/{fileId}.{ext}` |
| `admin_upload` | `admin/uploads/{fileId}.{ext}` |
| `screensaver_material` | `screensaver/materials/{fileId}.{ext}` |
| `temp` / 匿名无 ownerId | `tmp/uploads/{uploadSessionId}/{fileId}.{ext}` |

owner 缺失的 `user`/`partner` 用途会**回退到 `tmp/`**，绝不把无主敏感文件落到持久前缀。

---

## 4. 数据库：FileObject（统一文件资产表）

`services/api/prisma/schema.prisma` 的 `FileObject` 即文件资产表（迁移 `20260606190000_add_file_asset_cos_fields`，additive）：

`id / bucket / region / storageKey(=objectKey) / filename(原名) / mimeType / sizeBytes / sha256 /
ownerType(user|partner|admin|system) / ownerId / purpose / sensitiveLevel / visibility(默认 private) /
status(uploading|active|quarantined|deleted) / uploaderId / endUserId / createdBy /
expiresAt / deletedAt / deletedBy / deleteReason / createdAt / updatedAt`

`bucket` 落库用于跨后端路由（本地哨兵 `local-fs`），支持"先本地后切 COS"的混合数据。

---

## 5. API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/files` | 服务端代理 multipart 上传（已登录 User，含内容校验） |
| POST | `/api/v1/files/kiosk-upload` | Kiosk 匿名 / 会员 multipart 上传 |
| POST | `/api/v1/files/upload-intent` | 创建直传意图 → 返回 `fileId / objectKey / uploadUrl`（COS 预签名 PUT；本地代理 PUT） |
| PUT | `/api/v1/files/:id/raw?expires&sig` | 本地后端直传写入（签名授权） |
| POST | `/api/v1/files/:id/complete` | 直传完成确认（headObject 复核大小） |
| GET | `/api/v1/files/:id/download-url` | 短期下载 URL（attachment） |
| GET | `/api/v1/files/:id/preview-url` | 短期预览 URL（inline） |
| GET | `/api/v1/files/:id/url` | 重发签名 URL（兼容旧端点） |
| GET | `/api/v1/files/:id/content?expires&sig` | `/content` 代理流（兼容本地 & COS，打印 / `<img>` 用） |
| GET | `/api/v1/files` | 列表（admin） |
| DELETE | `/api/v1/files/:id?reason=` | 删除（owner / 会员本人 / admin；软删 + 物理回收对象） |
| POST | `/api/v1/files/cleanup-expired` | admin 立即清理过期 |

**两种上传姿势**：
1. **服务端代理上传**（`POST /files`、`kiosk-upload`）：buffer 经后端校验后推送到 COS。最安全（内容可校验），
   受内存上限约束（≤15MB），适合简历 / 打印件 / 图片。
2. **直传**（`upload-intent` → 直传 → `complete`）：大文件（视频）直连 COS，不过 API 内存；
   意图阶段校验元数据，`complete` 用 `headObject` 复核实际大小，超限即隔离删除。

---

## 6. 鉴权与合规

- **下载 / 预览 / 删除**端点同时支持 **后台 User（JWT）** 与 **C 端会员（member token）**：
  - 会员只能访问 `endUserId` 匹配的文件（我的简历 / 我的文档）。
  - 合作机构（partner）只能访问本机构（`ownerType=partner && ownerId=orgId`）文件，**绝不能访问用户简历**。
  - 管理员可访问任意文件，但访问用户文件会写 `file.admin_access` 审计（CLAUDE.md §11）。
- 上传强制校验：`purpose` × MIME 白名单、扩展名与 MIME 一致、大小上限、登录身份 / 机构 / 角色。
- 文件 URL 全部短期签名；证件/匿名/system_short 文件按 1h/6h/24h 分级短期清理；登录会员原始简历/求职材料按 90 天/180 天保存策略清理，优化后或派生成果物可由用户确认后长期保存；删除物理回收 + 留删除日志。
- 前端不出现 `SecretId` / `SecretKey`；前端只读 `signedUrl` / `uploadUrl`。

---

## 7. 验证

```bash
# 纯函数（objectKey / COS 签名 / 校验），无 DB / 无网络
pnpm --filter @ai-job-print/api verify:cos
# 文件服务 E2E（本地后端打 dev.db，自清理）：上传/隔离/直传/软删
pnpm --filter @ai-job-print/api verify:cos:files
# 真实 COS 连通性（需在 .env 配 TENCENT_COS_*，否则 SKIPPED）：put→head→get→签名下载→delete
pnpm --filter @ai-job-print/api verify:cos:live
```

> COS 签名算法严格复刻官方（[doc 436/7778](https://cloud.tencent.com/document/product/436/7778)），
> `verify:cos` 用独立重算交叉校验。真实 COS 端到端需用户在 `.env` 配真实凭证后跑 `verify:cos:live`。
