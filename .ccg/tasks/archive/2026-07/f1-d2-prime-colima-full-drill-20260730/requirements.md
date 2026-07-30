# F1 D2′ Colima Full Drill 范围

## 真实目标

在已完成 PREP 的现有 Colima guest 中，对 `origin/main@313d358d` 执行一次 fresh D2′ full drill，
生成独立 evidence，并由磁盘 JSON verifier 二次复核。该结果只判断非生产 D2′，不授权 production F1。

## 允许

- 启停现有 Colima profile。
- 使用 guest ext4 上的 `/var/lib/d2-prime-prep/yitiji-313d358d` 隔离副本。
- 启动 nonce-scoped 双 PM2 daemon、临时 Nginx、user systemd transient unit。
- 在 managed cgroup 内施加 runbook 固定的非生产资源限制和 bounded CPU load。
- 写入脚本白名单 schema 的 fresh evidence，并运行独立 verifier。
- 更新正式 progress 文档并归档本 CCG task。

## 禁止

- 不连接 production，不 SSH，不访问生产数据库、Redis、对象存储、密钥或业务数据。
- 不使用 skip/mock/partial-pass，不修改 evidence，不回退软件源，不复用旧 evidence。
- 不触碰现有 Colima Docker 容器、volume 或已有端口转发。
- 不执行 D3–D6，不进行 production Genesis、Nginx 切流或 PM2 操作。
- 不因失败借用当前线上服务器，不新增云主机或第二个虚拟机。

## PASS 条件

- full drill exit 0，输出 `D2_PRIME_PASS` 与 `productionF1=NO-GO`。
- 独立 verifier 输出 `evidenceVerdict=D2_PRIME_PASS`、`productionF1=NO-GO`、
  `D2_PRIME_EVIDENCE_PASS`。
- cleanup 后 3010/3011/演练 Nginx 端口空闲，临时 PM2/Nginx/systemd unit 无残留。
- evidence 不含真实路径、环境值、秘密、日志正文、用户或业务数据。

任一硬门禁失败即记录 D2′ NO-GO，不进入 D3。
