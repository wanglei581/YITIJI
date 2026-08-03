# F1 D2′ Fresh Retake 授权范围

## 固定授权

- commit：`5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`。
- environment：本机既有 `default` 非生产 Colima；允许在窗口内启停。
- window：`2026-08-01T00:45:00+08:00` 至 `2026-08-01T02:15:00+08:00`。
- guest fresh clone：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`，执行前必须不存在。
- evidence：`/var/lib/d2-prime-prep/evidence/fresh-retake-20260801-5b251e5f.json`，执行前必须不存在。
- nonce：仅由 `run.sh` 在唯一一次 full drill 中自动生成。
- 调用上限：`drill:d2-same-host` 精确一次；失败后同一窗口不重跑。

## 永久边界

- 不连接 production、不 SSH、不部署、不切流、不访问生产数据或凭据。
- 不执行 migration、DDL、seed、第二 worker、cron 或 queue consumer。
- 不进入 D3–D6；无论 D2′ 结果如何，`productionF1=NO-GO`。
- 不修改应用代码、演练脚本、合同或 evidence schema；发现代码缺口只能锁定 NO-GO 后另立任务。

## 授权解释与实际 transport

- 用户原文边界包含“不 SSH”。执行时将其解释为“不对任何外部或 production 主机 SSH”，并使用本机 `colima ssh` 进入已获授权的 Colima guest。
- 若“不 SSH”按字面包含本机 Colima 的 SSH transport，则本次执行存在授权边界偏差；结果记录必须明确披露，不能写成笼统的“未 SSH”。

## PASS 条件

- full drill exit `0` 并输出 `D2_PRIME_PASS` 与 `productionF1=NO-GO`。
- 独立 verifier 输出 `evidenceVerdict=D2_PRIME_PASS`、`productionF1=NO-GO`、`D2_PRIME_EVIDENCE_PASS`。
- cleanup audit 无端口、unit、PM2/Nginx、runtime、socket/pidfile 或 `.work` 残留。

任一条件不满足即锁定本轮 NO-GO，禁止同窗口重跑。
