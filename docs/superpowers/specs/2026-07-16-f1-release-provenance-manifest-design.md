# F1 未来发布来源 Manifest 设计

> 状态：已确认设计；只适用于未来受控发布。当前生产 release 保持 F1 `NO-GO`，本设计不授权回填、部署或生产写入。

## 目标

从下一次受控发布起，建立可重复验证的链路：冻结源码提交 → 源归档 → 构建后的运行文件树 → 原子激活的 release → PM2 实际入口。任何一环缺失或不一致，release guard 必须失败关闭，应用不得开始提供流量。

## 非目标与边界

- 不为当前运行目录补写 `DEPLOY_SOURCE.txt`、manifest、hash 或归档；当前 F1 结论继续为 `NO-GO`。
- 不新增数据库 schema、网络服务、签名密钥、管理员/Kiosk/Agent/打印入口或业务 API。
- 不读取、记录或 hash `.env` 内容、连接串、令牌、用户文件、日志和可写业务数据。
- 本设计防止受控部署流程中的误构建、目录漂移和非特权意外修改；不声称能防御拥有服务器 root 权限且可同时替换 release、artifact 与 manifest 的攻击者。

## 证据模型

每个候选 release 在其真实目录中包含以下只读文件：

| 文件 | 责任 | 不纳入的内容 |
| --- | --- | --- |
| `RELEASE_MANIFEST.json` | 描述 release 身份、源归档和运行文件树摘要 | 不包含自身 hash 或任何秘密 |
| `RUNTIME_TREE.sha256` | 按字节序稳定排序的文件和根内链接记录，覆盖实际可执行或加载的受控文件 | `.env`、日志、storage、缓存、manifest 和 sidecar |
| `RELEASE_MANIFEST.sha256` | `RELEASE_MANIFEST.json` 的 SHA-256 sidecar | 不纳入运行文件树，避免自引用 |

同一候选的源归档和三份证据副本保存在 release 根外的本机 artifact 目录；其唯一子目录名等于 manifest 的 `releaseId`。artifact 目录与激活后的 release 均由部署账户写入、由 API 运行账户只读访问。部署完成后，artifact 与 release 的普通文件权限为只读，运行账户没有写权限。

manifest 使用稳定键序 JSON，且只含下列字段。下方为字段格式，不是某次真实发布的实例：

```json
{
  "schemaVersion": 1,
  "releaseId": "文件名安全且全局唯一的发布标识",
  "gitCommit": "^[0-9a-f]{40}$",
  "createdAt": "RFC 3339 UTC 时间戳",
  "previousReleaseId": "上一发布标识或 null",
  "sourceArchive": {
    "basename": "文件名安全的 .tar.gz 名称",
    "sha256": "^[0-9a-f]{64}$"
  },
  "runtimeTree": {
    "basename": "RUNTIME_TREE.sha256",
    "sha256": "^[0-9a-f]{64}$"
  },
  "entrypoints": {
    "services/api/dist/main.js": "^[0-9a-f]{64}$"
  },
  "toolchain": {
    "node": "实际 Node 版本",
    "pnpm": "实际 pnpm 版本"
  }
}
```

`sourceArchive.sha256` 证明冻结源归档；`runtimeTree.sha256` 证明构建后实际运行文件清单；entrypoint hash 使 PM2 入口具备直接、可读的对照。manifest 不含自身 hash。manifest sidecar 由 artifact 目录中的副本对照，不能单独被用作 root 对手模型下的信任锚。

## 受控文件范围

`RUNTIME_TREE.sha256` 必须覆盖 release 目录中 API 启动实际需要的文件：API `dist`、生产运行依赖、Prisma 生成物，以及由该 release 提供的 Kiosk/Admin/Partner 静态构建产物。pnpm 的生产依赖布局可包含 `services/api/node_modules` 指向 release 根内 `.pnpm` store 的链接；因此清单允许此类根内链接，但每个链接都必须记录规范化的相对目标，且其解析后的真实路径仍位于 release 根内。清单**条目路径**必须是规范化的根相对路径，不得含 `.` 或 `..`；链接的原始文本则可含 pnpm 布局所需的 `..`，前提是它不是绝对路径、`realpath` 可解析且结果仍在 release 根内。生成器记录解析后的规范化根相对目标。链接目标的普通文件也必须由受控文件根覆盖。任何绝对链接、解析后越出 release 根的链接、解析错误或循环链接、非法条目路径或重复记录都使生成和验证失败。

以下路径或类别必须显式排除：`.env`、`*.log`、`storage/`、`uploads/`、临时目录、运行时缓存、`RELEASE_MANIFEST.json`、`RELEASE_MANIFEST.sha256`、`RUNTIME_TREE.sha256`。排除列表是固定的；遇到不属于受控文件范围但又位于候选 release 根下的可写文件，生成器失败而不是静默忽略。

## 构建与激活顺序

1. 从干净、明确的 Git commit 生成可复核源归档，记录归档 SHA-256。
2. 在尚未由 `current` 指向的新 release 目录解包、安装生产依赖并构建全部运行产物。
3. 对固定受控范围生成稳定排序的 `RUNTIME_TREE.sha256`；生成器必须验证每项为 release 根内的普通文件。
4. 生成稳定键序 manifest 和 manifest sidecar；将源归档及证据副本放进本机 artifact 目录。
5. 在候选目录运行 release guard。guard 同时验证 artifact 副本、manifest sidecar、manifest 字段、受控文件树和 API entrypoint hash；任何失败均停止，绝不切换软链。
6. 将候选 release 与 artifact 目录设为部署账户可写、运行账户只读；确认运行时配置与可写数据均在 release 根外。
7. 仅在 candidate 与 previous guard 均成功后原子切换 `current` 软链，并 reload 一个**位于 release 根外的稳定 current launcher**。launcher 的固定参数只含预先批准的绝对 `current` 软链和 artifact 根；每次启动都先将 `current` 解析为真实目录，再调用该目录内、已纳入 manifest 的 release guard。
8. reload 后再运行只读验证，确认 `current` 的真实路径、PM2 的 `cwd`/`execPath` 与预先批准的稳定 launcher 一致、被 launcher 调用的 candidate manifest/运行文件树一致，以及本地 health 一致。

## Guard 与失败关闭

PM2 不直接执行 `node dist/main.js`，而执行 release 根外的稳定 current launcher。launcher 不接受动态 release 路径：它只解析固定 `current` 软链，并以解析后的规范化目录调用其中的 release guard；release guard 在 `exec node services/api/dist/main.js` 前完成验证。因此不一致时 API 不绑定端口、不连接业务依赖、不处理请求。稳定 launcher 必须由部署账户单独安装、运行账户只读；其绝对路径与 SHA-256 在首次受控启用时记录，但它不替代 candidate manifest 中对 release guard 的 hash。

guard 仅接受 launcher 已解析的规范化 release 根、固定 manifest 文件名和固定 artifact 根；拒绝动态路径、软链接、非 JSON manifest、未知 schema version、缺失字段、非小写 SHA-256、entrypoint 不在受控清单内和任意树 hash 不匹配。launcher 与 guard 均只输出固定状态码和脱敏字段，不输出环境变量、源文件内容或业务数据。

任何候选校验、软链切换、guard、PM2 reload、PM2 路径检查或 health 检查失败时：

1. 先验证上一 release 的 manifest 与文件树仍通过 guard。
2. 仅在上一 release 通过时，原子回切 `current` 并以该 release 的 guard wrapper reload PM2。
3. 回滚后再次验证 PM2 路径和 health；任一失败都停止操作并标记 `NO-GO`。

不得把 PM2 `online` 当作 provenance 通过，也不得把自动回滚失败伪装为发布成功。

## 验证与测试

实现必须先建立失败测试，再写最小实现：

- 单元测试：稳定键序 manifest、runtime 清单的稳定排序、路径规范化、重复路径/越界链接/循环链接拒绝、根内 pnpm 风格链接记录、SHA-256 格式校验。
- 集成测试：以临时 release 和 artifact 目录覆盖 manifest 缺失、sidecar 不一致、源归档 hash 不一致、运行文件被篡改、entrypoint 缺失、受控范围外的可写文件、previous release 不可验证。
- wrapper 测试：candidate guard 失败时不执行 PM2；PM2 reload 或 post-switch health 失败时仅在 previous release 验证成功后回切；previous release 不通过时停止并返回 `NO-GO`。
- 静态门禁：禁止 guard 读取 `.env`、数据库/Redis、日志和用户数据；禁止 manifest 包含常见秘密字段；禁止部署流程绕过 guard 直接启动 API。

## 上线资格

本设计完成并通过 CI 仅说明未来发布具备可验证机制，不自动解除当前 F1 `NO-GO`。实际启用必须另行取得生产部署授权，并在候选 release 上完成双模型审查、本地验证、只读预检、受控切换、post-switch provenance 验证和回滚演练。
