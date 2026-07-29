# P0-1B PR / CI 集成审查

## 结论

- PR：[434](https://github.com/wanglei581/YITIJI/pull/434)
- 代码/测试 head：`0797dcf1792fdd88b555bf75711a9ff663f221e2`
- GitHub Actions：[`30475948226`](https://github.com/wanglei581/YITIJI/actions/runs/30475948226)
- 结论：`build-and-verify`、`kiosk-browser-smoke`、`postgres-readiness` 三项成功；PR 保持 open，未合并、未部署。

## CI 阻塞与收口

1. 旧 Fusion / LightFlow 静态合同仍匹配 P0-1 hook 形态；同步为 P0-1B warning handler 与保留的 fail-closed 清场不变量。
2. `fusion-smoke` 仍把孤立 `/session-timeout` 当成可交互预警页；改为断言 fail-closed 回到干净首页，并注册完整首页 fixture。
3. privacy 屏保刷新场景在 CI 回退到独立 `smart-campus` 请求，但公共 fixture 未注册该合法端点；仅补禁用态测试 fixture，并把该测试文件加入既有 W4 审计范围。

以上均为测试合同或夹具收口，未修改生产业务行为、API、数据库、密钥、支付、终端 Agent 或硬件配置。

## 本地与远端证据

- warning：19/19
- privacy：18/18
- Fusion smoke：6/6
- `verify:fusion-w4`、`verify:fusion-shell`：通过
- Kiosk typecheck、生产 HTTP + TRTC build、`git diff --check`：通过
- 最终远端三项 CI：全绿

## 后续边界

- 未经用户再次明确授权，不得合并 PR。
- 合并不等于部署或商用上线。
- 1080×1920 真机触控、Edge/Chrome Kiosk、Windows 主机、打印扫描设备仍须现场验收。
