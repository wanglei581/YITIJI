# F1 D2′ Colima Fresh Retake 范围

## 真实目标

在用户明确授权的 RFC3339 窗口内，复用本机现有非生产 Colima，对已合并候选
`e721f87a866525726ab83add248631b5940a0f34` 执行唯一一次 D2′ full drill，生成全新 evidence，
并由独立 verifier 二次复核。该结果只判断非生产 D2′，不授权 production F1 或 D3–D6。

## 用户授权

- 窗口：`2026-07-30T23:00:00+08:00` 至 `2026-07-31T00:30:00+08:00`。
- 候选：`main@e721f87a866525726ab83add248631b5940a0f34`。
- nonce：只允许 `run.sh` 生成一个新的 32 位随机 nonce。
- evidence：`/var/lib/d2-prime-prep/evidence-retake-e721f87a-20260730/d2-prime-evidence-e721f87a-20260730T150000Z.json`。
- 允许启动现有 Colima、nonce-scoped 双 PM2、临时 Nginx、user systemd transient unit 和有界 CPU load。

## 禁止

- 不连接 production，不 SSH，不访问生产数据库、Redis、对象存储、密钥或业务数据。
- 不复用、覆盖或修改旧 NO-GO evidence；不使用 skip/mock/partial-pass。
- 不新增云主机或第二个虚拟机，不触碰现有 Colima Docker 容器、volume 或端口转发。
- 不执行部署、D3–D6、production Genesis、production PM2/Nginx 或切流。
- 唯一一次执行若失败，不在本窗口 retake。

## PASS 条件

- full drill exit 0，并输出 `D2_PRIME_PASS` 与 `productionF1=NO-GO`。
- 独立 verifier 输出 `evidenceVerdict=D2_PRIME_PASS`、`productionF1=NO-GO` 和
  `D2_PRIME_EVIDENCE_PASS`。
- cleanup 后 `3010`、`3011`、`18080` 空闲，临时 PM2/Nginx/systemd unit、work/control root 无残留。
- evidence mode、SHA-256、exact-key schema 与 data-safety 白名单复核通过。

任一硬门禁失败即记录 D2′ NO-GO，不进入 D3。
