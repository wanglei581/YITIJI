# Windows Terminal Agent MSI 实施设计

> 状态：B1 MSI 未签名候选已通过 Windows CI；B2 Burn EXE 源码候选已实施，尚待 Windows CI、签名、Provisioner GUI 和真机发布验收。
> 适用范围：Windows Terminal Agent 的首次安装、修复、卸载和同机升级。
> 上位设计：[终端机队管理与安全换机设计](./terminal-fleet-management-design.md)。

## 1. 目标与边界

目标是在不改变既有打印协议、终端绑定协议或后台页面的前提下，交付可签名、可修复、可卸载的 Windows 安装包，供 5-50 台一体机分批部署。

本设计不包含远程 Shell、强制更新、远程替换在役主机、批量静默激活、自动创建打印任务、打印机驱动安装或扫描驱动安装。它也不授予安装程序访问数据库、`TERMINAL_ADMIN_SECRET` 或管理员账号的权限。

实施前置条件：机队 F2 安全换机的真机验收通过；在此之前只允许构建和非生产 VM 验证，禁止向在役终端发布 MSI。

## 2. 固定决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 包格式 | WiX Toolset v4 MSI | 适合 Windows Service、Repair、Major Upgrade、企业软件分发。 |
| 安装位置 | `%ProgramFiles%\AIJobPrintAgent` | 二进制和依赖不可由 Kiosk 用户修改。 |
| 状态位置 | `%ProgramData%\AIJobPrintAgent` | 目标状态根：保存 DPAPI token、配置、SQLite、日志和临时文件，跨修复、卸载和升级保留。 |
| 服务身份 | SCM 名称 `aijobprintagent.exe`，显示名 `AIJobPrintAgent` | 与当前 `node-windows` 实际安装结果一致。 |
| 运行时 | 随包携带经验证的 Node.js 运行时、生产依赖、`dist` 与批准的打印辅助程序 | 目标机不依赖开发环境、全局 Node 或 pnpm。 |
| 激活 | 安装与激活分离，继续使用既有短时一次性 BindCode | MSI 不携带或记录长期 token。 |
| 更新 | 空闲终端、分批 Major Upgrade | 禁止运行中的 Agent 覆盖自身，避免在途打印风险。 |

## 3. 包结构与信任链

### 3.1 实施阻塞：配置可重定位

当前实现的 DPAPI token、SQLite 与诊断状态位于 `%ProgramData%`，但 Agent 主配置和 last-known-good 配置仍可能由仓库/安装根下的 `config/` 读取。直接将现有目录打进 MSI 会在 Repair 或 Major Upgrade 时覆盖该配置，违反本设计的数据保留承诺。

因此第一实施 PR 不是 WiX 打包，而是受限的“配置根可重定位 + 一次性迁移兼容”改造：新安装只从 `%ProgramData%\AIJobPrintAgent` 读取配置；升级时只在 ProgramData 尚无配置且旧位置存在合法配置时，原子复制并校验后迁移；迁移完成后不得把 token 写回安装目录。它必须覆盖旧配置、UTF-8 BOM、last-known-good、DPAPI token、SQLite 与服务启动的回归验证。该前置未通过前，MSI 构建和发布均为 NO-GO。

构建机先生成不可变 staging 目录，再由 WiX 打包。staging 必须只含以下经清单允许的内容：

```text
Program Files\\AIJobPrintAgent\\
  node\\                 # 固定版本 Node.js runtime
  app\\dist\\            # 已编译 Terminal Agent
  app\\node_modules\\    # 仅生产依赖，native addon 与 Node ABI 已匹配
  tools\\                 # 已批准的 SumatraPDF 等辅助程序
  bootstrap\\             # 独立启动器与版本元数据
```

构建过程必须锁定 Node 版本、pnpm lockfile、依赖清单和每个输入文件的 SHA-256。CI 可产出未签名候选包用于 VM 测试，但不能标记为可发布。发布包、Bootstrapper 和版本 manifest 依次执行：

1. Authenticode 签名；
2. `signtool verify /pa /tw` 验证；
3. SHA-256 与发布 manifest 对比；
4. 签名者证书指纹与受控发布配置比对。

私钥仅驻留在受控签名服务或硬件介质，永不进入仓库、CI 日志、MSI 属性或本地开发机。

## 4. 安装、激活与运维

### 4.1 首次安装

MSI 以管理员权限安装二进制并建立 `%ProgramData%\AIJobPrintAgent`，但未 Provisioning 时只注册 Manual/Stopped 服务，不写 token、配置或领取打印任务。独立 Provisioner 成功后才通过既有加固逻辑写入受 ACL 保护的配置与 DPAPI token，并把服务切换为 Automatic/Running；WinSW 继续使用既有 60 秒、300 秒恢复策略。

MSI 不能接收 BindCode、Agent token、密码、数据库连接串或管理员密钥。不得把 BindCode 放入 `msiexec` 命令行、MSI public property、CustomActionData、安装日志或注册表。

安装完成后，由独立的本地 Provisioner 通过安全交互输入 BindCode，复用既有 `/auth/terminal/exchange-bind-code` 和 DPAPI LocalMachine 落盘能力。Provisioner 仅输出脱敏结果；成功后执行只读健康检查并由 Admin 确认心跳。Provisioner 的具体 UI/CLI、批量激活和远程下发另立任务，不随本设计实现。

### 4.2 Repair、卸载与升级

| 操作 | 二进制与服务 | `%ProgramData%` 数据 | 凭据与打印任务 |
| --- | --- | --- | --- |
| Repair | 恢复受签名程序、ACL、服务注册和恢复策略 | 默认保留 | 不读取、不重写 token；不创建、领取或重试任务。 |
| Uninstall | 停止并删除服务，再移除 `Program Files` 内容 | 默认保留，供重装或现场取证 | 不打印；删除状态数据必须使用单独、明确确认的清理工具。 |
| Major Upgrade | 仅在后台已 drain、活动任务为 0 时停止服务并事务替换二进制 | 原样保留 | 不重新激活，不修改 DPAPI token。 |
| Rollback | MSI 仅回滚本次二进制与服务改动 | 原样保留 | 不承诺撤销已发生的云端或物理打印副作用。 |

升级前由管理员将终端切为 `maintenance` 并确认 `pending`、`claimed`、`printing` 均为 0；升级后经只读诊断和 Admin 心跳确认才恢复 `active`。MSI 不自行调用生命周期、打印、订单或数据库接口。

### 4.3 Kiosk 浏览器启动器与看门狗（2026-09-05 加入安装包）

MSI 在 `%ProgramFiles%\AIJobPrintAgent\kiosk\` 交付三个文件：`kiosk-watchdog.ps1`（启动全屏浏览器并循环守护）、`register-kiosk-watchdog.ps1`（注册/注销登录计划任务）、`launch-kiosk.cmd`（维护时手动拉起一次）。**MSI 仍不含任何 CustomAction**：计划任务 `AIJobPrintKioskWatchdog` 由设备绑定向导在绑定成功后以管理员身份注册，控制中心提供「注册 / 更新」与「停用」两个按钮（停用需确认），卸载 MSI 不会自动删除该任务，维护时先在控制中心停用。

| 项 | 结论 | 原因 |
| --- | --- | --- |
| 触发与身份 | 登录触发，主体 `BUILTIN\Users`，Limited 权限，无存储凭据 | 在自动登录的标准账号会话里运行；服务会话（Session 0）拉不起图形界面 |
| 浏览器 | Edge 优先、Chrome 兜底，`--kiosk` + `--edge-kiosk-type=fullscreen`，独立 `--user-data-dir` 在 `%LOCALAPPDATA%\AIJobPrintKiosk\profile` | 与运维人员的普通浏览器窗口互不影响；ProgramData 根目录 ACL 只给 SYSTEM/Administrators，Kiosk 用户不能写，所以状态与日志都放用户目录 |
| 识别自己的进程 | 启动参数带 `--aijobprint-kiosk=1` 标记，只守护带标记的主进程 | 不会误杀或误判运维打开的浏览器 |
| 守护策略 | 每 5 秒检查；退出即拉起；60 秒内反复崩溃按 3→6→12…封顶 60 秒退避；任务本身无执行时限、失败后 1 分钟重启 3 次 | 避免崩溃风暴，也避免任务被系统按超时杀掉 |
| 参数与秘密 | 任务参数只有公开站点 URL（必须 https）与浏览器偏好；脚本不读 `agent.token`、`agent-config.json` | 与「MSI/任务不携带凭据」一致 |
| 已知不做 | 不检测页面白屏或 JS 卡死（需要 CDP 才能判断）；不接管系统自动登录与电源策略（由母盘镜像负责） | 保持安装包只做浏览器进程级守护 |

验证：`verify:installer-inputs` 断言文件、WiX 组件、暂存复制、片段排除、任务主体/触发/时限、URL 仅 https、无凭据字样；`verify-staged-powershell.ps1` 对 `kiosk/*.ps1` 做 BOM 与 5.1 语法解析；`test-msi-lifecycle.ps1` 断言三个文件装后存在。Windows 真机上还需验证：登录后自动全屏、手动关闭 Edge 后 5 秒内拉起、控制中心停用后不再拉起、重启后任务仍在。

## 5. 未来代码归属与文件预算

实施分支最多新增或修改以下区域，超过范围须重新审查：

- `apps/terminal-agent/installer/`：WiX 源、staging manifest、签名与安装验证脚本；
- `apps/terminal-agent/scripts/`：仅复用/拆分无密钥的服务、ACL、诊断模块；
- `apps/terminal-agent/package.json` 和根 CI：受控构建及 Windows VM 校验入口；
- `docs/device/`、`docs/progress/`：运维命令和验收结果。

禁止在 `services/api`、Prisma schema、Admin/Kiosk 路由和 `packages/shared` 中为 MSI 新增协议或数据模型，除非单独批准的机队发布控制面设计证明无法复用既有能力。

## 6. 验收矩阵

| 场景 | 最低通过条件 | 环境 |
| --- | --- | --- |
| 构建完整性 | staging 清单、lockfile、Node ABI、WiX 构建均可复现 | Windows 构建机 / CI |
| 签名 | 正式候选签名、哈希、签名者指纹均通过 | 受控签名环境 |
| 首次安装 | Program Files 与 ProgramData ACL 正确；服务 Automatic；未激活时不领取任务 | Windows VM |
| 激活 | BindCode 一次性兑换、DPAPI 落盘、日志无明文；Admin 看到在线 | 隔离预生产 VM |
| Repair | 损坏二进制可恢复，token、配置、SQLite 不变 | Windows VM |
| 卸载/重装 | 服务清理；ProgramData 保留；重装后可按既有流程恢复 | Windows VM |
| 升级/回滚 | drain 后升级成功；故障时回到已验证旧版本；无自动打印 | Windows VM |
| 真机 | 奔图驱动、服务恢复、PDF/图片受控出纸及 PrintService 证据 | 已授权现场 |

所有真实终端操作仍执行既有空队列 gate，证据保存在仓库外受控目录。未完成真机项不得称为可批量商用发布。

## 7. 实施拆分

1. 先完成配置根可重定位与一次性迁移兼容，不接入 MSI。
2. 建立 staging 与 WiX 构建，不接入签名或生产部署。
3. 在 Windows VM 验证 install / repair / uninstall 与数据保留。
4. 接入受控签名和版本 manifest，验证 Major Upgrade/rollback。
5. 在已完成 maintenance/drain 的单台预生产终端验收，再按机队设计的分批策略扩展。

每一步独立分支、独立 PR、独立 Windows 验收；任一步失败都停止后续批次。

## 8. B1 候选实现（2026-07-27）

`apps/terminal-agent/installer/` 现已提供固定输入清单、Node 22 x64 staging、生产依赖裁剪、原生 ABI 探针、WiX v4 工程、install/repair/uninstall Windows CI 和未签名 MSI 构建。MSI 直接拥有 WinSW wrapper、配置和 SCM 注册，不调用 `node-windows install-service`；未激活服务为 Manual/Stopped，避免无配置主机反复失败重启。`%ProgramData%\AIJobPrintAgent` 作为永久状态目录保留，二进制安装到 `%ProgramFiles%\AIJobPrintAgent`。

当前仍是 **NO-GO 发布候选**：B1 已由 PR #422 的干净 Windows CI 覆盖 fresh install、未激活 LocalSystem fail-closed 启动、repair、uninstall 和 ProgramData 保留，但 WinSW 与 MSI 仍未经本企业 Authenticode 签名；安全交互式 Provisioner GUI 与签名发布 manifest 仍在后续批次。独立新增 `KSK-002` 不属于 F2 同身份无缝换机，但仍必须完成新主机驱动、绑定、心跳、出纸、扫描和重启恢复验收后才能扩展部署。

## 9. B2 Burn EXE 候选（2026-08-06）

现场交互安装新增 `AIJobPrintTerminalSetup.exe` 候选。它使用 WiX Toolset v4 Burn 和 WixStandardBootstrapperApplication，将 B1 的唯一 MSI 内嵌为安装链；EXE 不复制 Agent 文件清单、不重新注册服务，也不形成第二套安装逻辑。企业批量部署仍可直接使用同一 MSI。

Windows 上双击 EXE 后，可通过标准向导完成安装；再次运行同一版本可进入修复或卸载。无人值守生命周期仅用于 Windows CI：`/install /quiet`、`/repair /quiet`、`/uninstall /quiet`。所有路径继续保留 `%ProgramData%\AIJobPrintAgent`，未 Provisioning 的服务必须保持 Manual/Stopped。

Bundle 不声明可覆盖变量、MSI 属性、命令行透传或自定义动作，不接收 BindCode、Agent token、bridge token、管理员密钥和打印机型号。首次安全绑定仍由安装后的独立 Provisioner 完成；当前仓库只有受保护的交互式 PowerShell Provisioning，尚无本地 GUI，因此本候选只关闭“双击安装/修复/卸载”，不能宣称首次装机已经完全零命令行。

构建顺序固定为 staging -> MSI -> EXE。`build-exe.ps1` 只接受唯一 MSI 输入并强制输出名；Windows CI 保留既有 required job 标识，新增 EXE build 和 install/repair/uninstall 生命周期验证，同时上传 MSI、EXE、manifest 和两套日志。macOS 上 WiX Burn 明确不支持生成 Windows 引导器，所以本地只运行静态契约和 NuGet 还原检查；EXE 产物、哈希和生命周期必须以 Windows 2022 CI/VM 为证据。

本候选仍为 **NO-GO 发布候选**：在 Windows CI 全绿、企业 Authenticode 双重签名（内嵌 MSI 与外层 EXE）、签名者指纹/时间戳/发布 manifest 校验、Provisioner GUI 和至少一台隔离 Windows 真机验收完成前，不得把该 EXE 发给在役终端作为正式商用安装包。
