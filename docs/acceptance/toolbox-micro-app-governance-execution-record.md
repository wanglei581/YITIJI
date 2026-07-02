# 百宝箱微应用审核发布执行记录

> 状态：PENDING，尚未执行预生产 migration、真实管理员异人审批、真实终端发布投影或熔断演练。
> 本文件只记录脱敏摘要和证据 ID；原始截图、命令日志、SQL 输出、HAR、录屏、数据库备份和终端照片必须保存在仓库外私有证据目录。

## 执行信息

- 候选提交：PENDING
- 执行环境：PENDING
- 预生产根目录：PENDING
- 证据目录：PENDING
- 执行人：PENDING
- 复核人：PENDING
- 开始时间：PENDING
- 结束时间：PENDING

## Gate 状态

| Gate | 状态 | 证据 ID | 结论 |
|------|------|---------|------|
| TMG-G0 本地静态门禁 | PENDING | PENDING | 未执行 |
| TMG-G1 预生产只读预检 | PENDING | PENDING | 未执行 |
| TMG-G2 PostgreSQL migration 与环境白名单复核 | PENDING | PENDING | 未执行 |
| TMG-G3 管理员异人审批与域名审核 | PENDING | PENDING | 未执行 |
| TMG-G4 发布投影、Kiosk 展示与熔断移除 | PENDING | PENDING | 未执行 |
| TMG-G5 首批低风险微应用接线准备 | PENDING | PENDING | 未执行 |

## TMG-G0 本地静态门禁

- `shared typecheck`：PENDING
- `api typecheck`：PENDING
- `admin typecheck`：PENDING
- `admin build`：PENDING
- `verify:toolbox-micro-app-platform`：PENDING
- `verify:toolbox-review-workflow`：PENDING
- `verify:toolbox-review-ui`：PENDING
- `verify:toolbox-governance-acceptance`：PENDING
- `db:pg:sync:check`：PENDING
- `git diff --check`：PENDING
- 备注：PENDING

## TMG-G1 预生产只读预检

- API health：PENDING
- DB 类型：PENDING
- Admin 入口：PENDING
- Kiosk 入口：PENDING
- 部署来源：PENDING
- 备注：PENDING

## TMG-G2 PostgreSQL migration 与环境白名单复核

- 备份路径证据 ID：PENDING
- 备份 sha256 证据 ID：PENDING
- `pg_restore -l` 可读性：PENDING
- `db:pg:deploy`：PENDING
- `db:pg:sync:check`：PENDING
- `TOOLBOX_ALLOW_EXTERNAL_URL` 脱敏状态：PENDING
- `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` 脱敏状态：PENDING
- `KIOSK_QR_TARGET_ALLOWED_HOSTS` 脱敏状态：PENDING
- 备注：PENDING

## TMG-G3 管理员异人审批与域名审核

- Admin A 创建应用：PENDING
- Admin A 创建版本：PENDING
- Admin A 提交审核：PENDING
- Admin A 自审批阻断错误码：PENDING
- Admin B 审核通过：PENDING
- Admin A 提交 host：PENDING
- Admin A 自审核 host 阻断错误码：PENDING
- Admin B 激活 host：PENDING
- AuditLog 摘要证据 ID：PENDING
- 备注：PENDING

## TMG-G4 发布投影、Kiosk 展示与熔断移除

- 发布返回状态：PENDING
- `projectionKey=app:<appKey>`：PENDING
- 终端配置包含 `app:<appKey>`：PENDING
- Admin UI 只读展示：PENDING
- Kiosk 展示：PENDING
- 熔断返回状态：PENDING
- 终端配置移除 `app:<appKey>`：PENDING
- Kiosk 移除：PENDING
- 备注：PENDING

## TMG-G5 首批低风险微应用接线准备

- `salary-negotiation`：PENDING
- `hr-qa`：PENDING
- `offer-compare`：PENDING
- 法律 / 合同 / 试卷类仍阻塞：PENDING
- 备注：PENDING

## 停止条件记录

- 是否触发停止条件：PENDING
- 触发项：PENDING
- 回滚动作：PENDING
- 剩余风险：PENDING

## 最终结论

PENDING。不得据此宣称百宝箱微应用平台生产上线、商用上线、第三方小程序 / skill 包上线或法律 / 合同 / 试卷类能力完成。
