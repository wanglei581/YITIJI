# 百度智能云 BOS 切换与回滚 Runbook

> 目标：把所有新上传文件切换到百度智能云 BOS，同时保持腾讯云 COS 历史文件可读、可删、可审计。
> 本文是生产操作清单，不代表当前环境已完成 BOS 建桶、配置或 live 验收。

## 一、固定边界

- BOS Bucket 必须为私有读写；Access Key / Secret Access Key 只进入 API 服务端环境。
- 浏览器只能取得不超过 30 分钟的对象级预签名 URL，不能取得永久地址或服务端密钥。
- 按[百度 BOS GetObject 官方文档](https://cloud.baidu.com/doc/BOS/s/xkc5pcmcj)，BOS 官方域名不支持通过 `responseContentDisposition` 动态切换附件/文件名；浏览器下载行为必须在 canary 单独验收，不能把签名 URL 可用等同于强制附件已生效。
- `FileObject.storageProvider` 是物理位置真相：新文件写 `bos`，历史腾讯文件保留 `cos`。
- 旧 `FairMaterial` / `AdAsset` 没有历史 bucket 元数据，迁移期通过 `FILE_STORAGE_LEGACY_DRIVER=cos` 读取。
- 数据库 `expiresAt` + 清理任务仍是业务删除主路径。不得给整个 BOS Bucket 设置会覆盖 `long_term` 对象的全局过期规则。
- 切换不会修改打印建单的内部 HMAC URL 规则；`/print/jobs` 仍不得接受外部云存储 URL。

## 二、上线前准备

1. 在目标 Region 创建一个生产私有 Bucket，并记录控制台给出的官方 `*.bcebos.com` HTTPS regional endpoint。
2. 创建专用子用户/服务账号，只授予目标 Bucket 所需的 Object PUT/GET/HEAD/DELETE 权限；不要授予 Bucket 删除、ACL 修改或生命周期修改权限。
3. 为 Kiosk/Admin 的真实 HTTPS Origin 配置最小 CORS：允许需要的 `PUT/GET/HEAD`、`Content-Type`，禁止 `*` 搭配凭证。
4. 备份 PostgreSQL；确认当前 COS Bucket、Region 与服务端密钥仍可用。
5. 先部署包含 `20260809163000_add_storage_provider_provenance` 的代码和 migration，暂不切 driver。

## 三、迁移期配置

```env
FILE_STORAGE_DRIVER=bos
FILE_STORAGE_LEGACY_DRIVER=cos
FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS=1800

BAIDU_BOS_ACCESS_KEY_ID=<managed-secret>
BAIDU_BOS_SECRET_ACCESS_KEY=<managed-secret>
BAIDU_BOS_BUCKET=<private-bucket>
BAIDU_BOS_REGION=<region>
BAIDU_BOS_ENDPOINT=https://<regional-endpoint>

# 历史 COS 读取/删除继续需要；迁移完成前不得移除。
TENCENT_COS_SECRET_ID=<managed-secret>
TENCENT_COS_SECRET_KEY=<managed-secret>
TENCENT_COS_BUCKET=<historical-private-bucket>
TENCENT_COS_REGION=<historical-region>
```

不要把真实值写进仓库、命令输出、截图或验收文档。

## 四、切换门禁

按顺序执行：

```bash
pnpm --filter @ai-job-print/api run verify:bos
pnpm --filter @ai-job-print/api run verify:production-runtime-gates
BOS_LIVE_VERIFY_ENABLED=true \
  BOS_LIVE_VERIFY_TARGET=preprod \
  pnpm --filter @ai-job-print/api run verify:bos:live
```

`verify:bos:live` 是会在目标 Bucket 创建并删除随机临时对象的外部写验证，缺少显式启用标记、目标环境或任一 `BAIDU_BOS_*` 配置时必须失败，不能 `SKIP` 后按通过处理。预生产通过不授权生产执行；生产切换窗口须另行授权，并把 `BOS_LIVE_VERIFY_TARGET` 明确改为 `production`。脚本成功前会复核临时对象已经删除；失败时必须按输出检查 `tmp/verify-bos/` 是否存在残留。

然后重启 API 并完成以下 canary：

- 上传一份无个人信息 PDF，确认数据库 `storageProvider=bos`、Bucket/Region 正确。
- 预览、下载、打印建单和服务端读回均成功；签名 URL 不超过 30 分钟。
- 下载 canary 必须核对实际文件名与附件行为；如业务要求强制附件而浏览器无法满足，停止切换并先实现受控 API 下载代理。
- 删除 canary 后，数据库删除状态、审计记录和 BOS 物理对象一致。
- 读取一份历史 `storageProvider=cos` 文件，确认切换后仍可预览和删除。
- 上传失败、BOS 403/404、签名过期和 CORS 拒绝均不能静默回落本地磁盘。

全部通过后，才可认定“新上传已切 BOS”；这不等于历史数据已经迁移。

## 五、历史对象迁移

历史迁移必须作为独立受控任务执行：

1. 只读盘点 `storageProvider=cos` 的 `FileObject`，以及 `storageProvider=legacy` 的运营素材。
2. COS → BOS 复制时保持 `storageKey` 不变；逐对象核对大小和 SHA-256（有账本值时必须一致）。
3. 先复制并验证，后在数据库事务内更新 provider/bucket/region；不得先改数据库再复制。
4. 迁移期间不删除 COS 源对象。完成全量抽样、下载、打印、删除与恢复演练后，再单独审批源清理。
5. `FairMaterial` / `AdAsset` 迁移后要回填各自的 `storageProvider/storageBucket/storageRegion`，直至 `legacy` 记录清零。

## 六、回滚

切换后若 BOS 出现持续故障：

1. 把 `FILE_STORAGE_DRIVER` 改回 `cos` 并重启 API。
2. 必须继续保留完整 `BAIDU_BOS_*` 配置，因为切换窗口内已产生的 `storageProvider=bos` 文件仍需读取和删除。
3. 复验一份 COS 历史文件和一份 BOS 新文件；不能用“默认 driver 已回 COS”替代双向验证。
4. 不批量改写已经正确落库的 `storageProvider`，不删除 BOS canary 之外的任何对象。

## 七、退出迁移期

只有同时满足以下条件，才能移除腾讯 COS 凭证：

- `FileObject.storageProvider=cos` 为 0；
- `FairMaterial` / `AdAsset.storageProvider=legacy` 为 0；
- 迁移核对、下载/打印/删除、回滚演练和审计证据全部完成；
- COS 源清理已单独审批，并确认不会破坏备份或法定保存要求。
