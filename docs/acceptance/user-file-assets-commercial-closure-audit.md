# 用户文件与简历资产商用闭环完成度审计矩阵

> 状态：AUDIT ONLY。本文件只汇总当前代码、文档、验收计划和剩余缺口，不代表预生产、正式生产、Windows 真机或试运营验收已经完成。
> 审计日期：2026-06-22。
> 审计基线：`codex/file-assets-gate3-gate4-evidence-plan` 之后的本地文档审计分支。

## 一、结论摘要

用户文件与简历资产商用闭环的“代码与验收材料候选”已经基本具备，但“商用闭环完成”尚未成立。

当前可以确认的完成项是：

- 数据模型已经支持原始文件、优化后或派生成果物的分类、来源关联、保存策略、用户同意版本和长期保存的 `expiresAt = null` 语义。
- 后端已经提供会员本人文件资产列表、短期访问 URL、本人删除、本人保存期限修改、Admin 文件列表、Admin 生命周期统计和过期清理能力。
- Kiosk `/me/documents` 已支持本人查看、删除、保存期限展示与修改；3 个月可直接设置，6 个月和长期保存会触发用户确认弹窗，具体允许策略以后端 `retention-policy.ts` 为准。
- Admin `/files` 已支持生命周期运营视图、保存策略筛选、全库只读统计、查看短期签名 URL、管理员删除和过期清理入口。
- COS 生命周期与隐私文案已有合规口径和静态门禁，明确禁止 Bucket 全局过期规则误删长期文件。
- 预生产 Gate 1 只读预检、Gate 2 刷新方案、Gate 3/Gate 4 证据模板已经形成。

仍未完成的是：

- Gate 2 尚未执行，预生产服务器当前仍未部署到用户文件资产目标候选。
- Gate 3 自动命令证据尚未执行，COS live、真实 DB 状态、生命周期聚合和清理链路还没有本轮证据。
- Gate 4 浏览器账号验收尚未执行，会员 A/B、Admin A、真实上传、重登查看、跨账号隔离、删除和 Admin 截图尚无证据。
- 正式生产域名/HTTPS、腾讯短信、OCR、AI/TRTC/ASR/TTS、Windows 真机、奔图打印扫描、法务审定和小范围试运营仍是全项目 P0 外部验收项。

## 二、完成度矩阵

| 模块 | 当前证据 | 状态 | 不能完成的原因 | 下一步 |
| --- | --- | --- | --- | --- |
| 数据模型与保存期限策略 | PostgreSQL 迁移增加 `assetCategory`、`sourceFileId`、`retentionPolicy`、`retentionSetBy`、`retentionConsentAt`、`retentionConsentVersion`；后续迁移允许 `FileObject.expiresAt` 为空。`retention-policy.ts` 定义默认 90 天、180 天、长期保存、原始文件长期保存禁用和证件短期锁定。 | 代码候选已具备 | 未在预生产目标候选执行 `migrate deploy`，真实表结构仍待 Gate 2 后确认。 | Gate 2 备份 DB 后执行 additive migrations；Gate 3 用 DB 查询摘要核对字段和 `long_term` 空值语义。 |
| 账号资产 API | `MemberAssetsService.listDocuments` 只按本人 `endUserId` 返回 active、未删除、未过期或长期保存文件；只回元数据和短期访问端点；`FilesService.updateRetention` 与 `ownerDelete` 处理本人保存期限和删除。 | 代码候选已具备 | 还没有在预生产会员账号里跑上传、重登、跨账号隔离、删除全链路。 | Gate 4 使用 MEMBER_A/MEMBER_B 验证本人可见、他人不可见、重登仍可见、删除后不可见。 |
| 原始文件与优化后/修改后文件分开管理 | 数据层通过 `assetCategory` 与 `sourceFileId` 区分 original、optimized、derived；保存策略允许原始文件 3/6 个月，优化后或派生成果物 3/6 个月/长期保存。 | 代码候选已具备 | 需要真实产生一组原始文件和一组优化后或修改后文件，并核对 DB、Kiosk 和 Admin 三端展示。 | Gate 4 分别上传原始文件和生成/上传成果物，记录文件名脱敏截图和 DB 摘要。 |
| Kiosk 文件管理 | `/me/documents` 展示文件名、大小、创建时间、到期时间、保存策略；支持查看、删除、修改保存期限；6 个月和长期保存弹出用户确认。 | 代码候选已具备 | 未在预生产浏览器对真实账号截图取证；触控一体机真实体验未验。 | Gate 4 浏览器验收先跑桌面/Kiosk 页面；Windows 真机阶段再验证触控和断网/重启恢复。 |
| Admin 生命周期运营 | Admin `/files` 读取 `listFiles(includeDeleted=true)` 与 `getFileLifecycleSummary()`；展示全库统计、长期保存、即将到期、待清理、保存策略筛选、查看、删除和清理过期文件。 | 代码候选已具备 | 未在预生产 Admin 账号截图；清理过期文件和 cron 审计还没有真实环境证据。 | Gate 3 先跑生命周期 summary 命令；Gate 4 截图 Admin 生命周期视图；必要时等待 cron 产生 `file.cleanup_expired` 审计。 |
| COS 私有桶与文件生命周期 | `docs/compliance/file-retention-and-cos-lifecycle.md` 明确 COS 红线；`verify:cos-lifecycle-policy` 和 `verify:cos:live` 脚本存在；试运营证据包要求控制台截图。 | 文档和门禁候选已具备 | 尚未针对本目标候选执行 COS live；控制台生命周期截图和 bucket 规则未完成本轮取证。 | Gate 3 执行 COS live 与生命周期静态检查；Gate 4/正式验收补 COS 控制台脱敏截图。 |
| 隐私与合规文案 | 采集点、帮助中心、隐私政策、Admin 横幅和 COS 合规文档已统一短期/90 天/180 天/长期保存口径。 | 文档候选已具备 | 法务或业务负责人未签字确认；正式试运营前不能只凭工程文档替代审定。 | 正式试运营前完成用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明审定。 |
| 预生产 Gate 1 | 已只读确认主机、PM2、health、PostgreSQL 可达；发现 `/srv/ai-job-print` 是 `local-git-archive`，部署源自报仍为 `6b055d6b`。 | 已完成只读预检 | Gate 1 不部署、不迁移、不写数据，不能证明文件资产代码在预生产运行。 | 已进入 Gate 2 方案待确认。 |
| 预生产 Gate 2 | 已形成本地 `git archive` 上传、候选目录展开、保留 env、构建、DB 备份、迁移、原子切换、PM2 重启、health/hash 复验方案。 | 待执行 | 需要用户再次确认远端修改边界；会改变预生产代码、构建产物、DB schema 和进程状态。 | 用户确认后执行，目标/非目标/允许修改内容/验证/回滚需再次列明。 |
| 预生产 Gate 3 | 已有 G3-01 至 G3-09 命令日志模板，覆盖 health、trial acceptance、COS lifecycle、COS live、lifecycle summary、member assets、audit logs、DB 摘要。 | 待执行 | Gate 2 未完成；Gate 3 可能写测试 DB/COS 对象，需要授权。 | Gate 2 通过后执行，并按模板留存脱敏日志。 |
| 预生产 Gate 4 | 已有 G4-01 至 G4-10 浏览器/账号证据模板，覆盖 MEMBER_A、MEMBER_B、ADMIN_A、原始文件、成果物、保存期限、长期保存、删除、Admin 生命周期截图。 | 待执行 | Gate 2/Gate 3 未完成；会写测试账号文件和状态，需要授权。 | Gate 3 通过后执行，失败即停止并回填阻塞项。 |
| 正式生产与试运营 | P0 清单已有生产域名/HTTPS、PostgreSQL、Redis、COS、短信、OCR、AI/TRTC/ASR/TTS、法务、小范围试运营要求。 | 待真实验收 | 当前域名审核和腾讯短信仍在外部审核；一体机外壳未完成；Windows 真机和打印扫描未验。 | 预生产文件资产闭环通过后，再推进正式域名/HTTPS、短信审核后登录 E2E、Windows 真机和 1 台终端试运营。 |

## 三、不能作为完成证据的内容

以下内容只能作为阶段性证据，不能用于宣布商用闭环完成：

- 本地静态脚本通过，只证明证据包、文案和门禁存在，不证明真实生产链路可用。
- mock 数据或本地 SQLite 成功，不能替代 PostgreSQL + COS + 会员账号真实验收。
- Gate 1 只读 health 成功，只证明老预生产包可达，不证明目标候选已经部署。
- `DEPLOY_SOURCE.txt` 自报 commit，只能作为部署脚本元数据，不能替代实际运行代码 hash、构建产物和健康检查。
- Gate 3/Gate 4 模板文件存在，只证明执行结构准备好，不等于已经执行。
- COS 静态策略文档存在，不能替代腾讯云控制台生命周期规则截图和 live put/head/get/signed-url/delete 证据。
- Admin/Kiosk 页面代码存在，不能替代真实账号浏览器截图、跨账号隔离和删除三态验证。

## 四、推荐持续推进顺序

1. **执行 Gate 2 预生产候选刷新**：先再次确认目标、非目标、允许修改远端内容、验证方式和回滚方式；确认预生产 DB、Redis、COS 与正式生产资源隔离；再执行候选部署、DB 备份、additive migrations、构建、PM2 重启和 health/hash 复验。
2. **执行 Gate 3 自动命令证据**：按 Gate 3/Gate 4 证据模板留存远端命令日志，重点确认 COS live、COS 生命周期静态检查、生命周期 summary、member assets、audit logs 和 DB 摘要；`verify:file-assets-trial-acceptance` 是 Gate 0 本地静态门禁，依赖完整仓库 `docs/`，不在 Gate 3 远端执行。
3. **执行 Gate 4 浏览器账号验收**：使用 MEMBER_A、MEMBER_B、ADMIN_A 跑真实上传、保存期限、长期保存、重登查看、跨账号隔离、删除、Admin 生命周期截图。
4. **补齐正式生产外部 P0**：域名/HTTPS、腾讯短信审核后的真实手机号 E2E、百度 OCR、AI/TRTC/ASR/TTS 按启用范围 live 冒烟、法务材料审定。招聘信息只作为外部/官方来源展示与免责声明审定，不承接招聘闭环动作。
5. **Windows 一体机真实验收**：在已购买设备上跑 Terminal Agent、奔图真实出纸、扫描链路、断网/重启恢复、日志和告警；外壳未完成不阻塞裸机验收，但不能替代最终交付形态验收。
6. **小范围试运营**：仅 1 台终端 + 1 台打印机 + 受控账号先跑；问题按独立任务闭环，不在试运营中临时堆新功能。

## 五、当前还需要用户或外部条件提供

- Gate 2 远端执行确认：是否允许上传候选包、展开目录、执行 PostgreSQL 迁移、切换目录、重启 PM2。
- 预生产资源隔离确认：DB、Redis、COS bucket、测试账号不使用正式用户数据。
- MEMBER_A、MEMBER_B、ADMIN_A 受控测试账号及可脱敏取证方式。
- COS 控制台生命周期规则截图权限或由用户提供截图。
- 域名审核通过后的正式域名、证书、DNS 和 nginx 验收窗口。
- 腾讯短信审核通过后的签名、模板和真实手机号 E2E 验收窗口。
- 百度 OCR、AI/TRTC/ASR/TTS 生产 Key 与启用范围确认。
- Windows 真机、奔图打印机、扫描仪连接方式、Terminal Agent 部署窗口。
- 用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明的最终审定人和审定版本。

## 六、持续目标状态

本持续目标下一步不是新增功能，而是按证据链推进：

- 没有 Gate 2，就没有目标候选的预生产运行环境。
- 没有 Gate 3，就没有命令级真实证据。
- 没有 Gate 4，就没有用户账号和管理后台浏览器证据。
- 没有正式域名/短信/OCR/AI/Windows/法务/试运营，就不能宣布商用闭环完成。
