# 执行与验证记录

## 结论

预生产工具链升级成功：全新 SSH 默认 `node` 为 `v22.23.1`，默认 `pnpm` 为 `11.2.2`。现有 `/usr/bin/node v20.20.2` 未覆盖，运行中的 PM2 应用继续使用 `/usr/bin/node`，未发生应用部署、依赖安装或服务重启。

## 供应链与安装

- 目标版本来自 Node.js 官方 Node 22 LTS 发布页与 `nodejs.org/dist/v22.23.1`。
- 官方 `linux-x64.tar.xz` 固定 SHA-256 为 `9749e98…e578`；本地流式复核、服务器官方 SHASUMS 与下载制品三者一致。
- 官方制品安装到 `/opt/node-v22.23.1-linux-x64`；系统 NodeSource APT 的 `/usr/bin/node v20.20.2` 保持不变。
- `/usr/local/bin` 仅新增指向本次 `/opt` 的 `node/npm/npx/corepack/pnpm/pnpx` 软链，原路径执行前均确认不存在。
- Corepack 0.34.6 使用单一 Corepack 机制激活 `pnpm@11.2.2`，没有 npm 全局安装；旧 `lastKnownGood.json` 已以 0600 权限保存为可回滚副本，内容仍指向 `pnpm 9.15.4`。

## PM2 防漂移

- 新增 `pm2-root.service.d/20-pin-node20-runtime.conf`，只把 PM2 unit 的 PATH 固定为 `/usr/bin` 优先；执行 `systemd-analyze verify` 与 `systemctl daemon-reload`，未 restart/reload PM2。
- 合并后的 unit PATH 已验证 `/usr/bin` 位于 `/usr/local/bin` 前；drop-in 目录只有本次一个文件。
- 当前 `ai-job-print-api` 仍为 PID `2423235`、restart `25`、`online`、`unstable_restarts=0`，`/proc/<pid>/exe` 仍为 `/usr/bin/node`。
- 后续禁止在交互式 Node 22 shell 直接 `pm2 kill/update/resurrect`；PM2 管理必须显式使用 systemd 或 `/usr/bin/node /usr/lib/node_modules/pm2/bin/pm2`，直至独立运行时迁移完成。

## 兼容性诊断

- 首次 Node 22 smoke 在 `require('@prisma/client')` 默认入口停止；系统化对比确认 Node 20 同样返回缺少 `.prisma/client/default`，根因是项目使用自定义 Prisma 输出而非默认入口，不是 Node 22 ABI 问题。
- Node 20 与 Node 22 均成功加载实际 `dist/generated/prisma/client.js` 和 `dist/generated/prisma-pg/client.js`。
- Node 22 成功 direct-require `@napi-rs/canvas`、`@libsql/client`、`bullmq`、`@prisma/adapter-pg`，以及 Linux x64 GNU 的 libsql、canvas、msgpackr N-API 原生模块。
- 明确 ABI 115 的开发/Terminal Agent `better-sqlite3` 未作为 API Node 22 兼容证据；当前 PM2 固定 Node 20，未重建或替换现有 `node_modules`。

## 新 SSH 独立验证

- 默认 `node`: `/usr/local/bin/node` → `/opt/.../bin/node` → `v22.23.1`，ABI 127。
- 默认 `pnpm`: `/usr/local/bin/pnpm` → `/opt/.../corepack/dist/pnpm.js` → `11.2.2`。
- npm `10.9.8`、Corepack `0.34.6`；`/usr/bin/node` 仍为 `v20.20.2`；Corepack 回滚状态仍记录 `pnpm 9.15.4`。
- `/srv/ai-job-print/package.json`、`pnpm-lock.yaml`、`DEPLOY_SOURCE.txt` 的 SHA-256 与执行前完全一致，三者及 `node_modules` 顶层 mtime 未变。
- 本机 API、公网 API、Kiosk、Admin、Partner 均 HTTP 200；两级 API health 均为 `status=ok`、`db=postgres`。
- 另在 `/`、`/srv/ai-job-print`、`/srv/ai-job-print/services/api` 三个目录分别执行只读 `pnpm --version`，均为 `11.2.2`；当前部署包两个 `package.json` 的 `packageManager` 均为空，因此不存在被旧项目级版本覆盖的歧义。现网旧包在 API/根目录只读调用时会提示旧 `package.json#pnpm.overrides` 已不再读取；本轮没有执行 install/update，该告警不改变工具链验收，下一候选已把依赖配置迁入 pnpm workspace 配置。

## 精确回滚步骤

如需回退默认工具链，必须先验证六个 `/usr/local/bin` 软链仍精确指向 `/opt/node-v22.23.1-linux-x64/bin/<name>`，再逐个 `unlink`；不得覆盖或删除来源不符的路径。随后：

1. 将 `/root/.cache/node/corepack/lastKnownGood.pre-node22-20260726.json` 复制到同目录临时文件，再原子 `mv` 恢复 `lastKnownGood.json`。
2. 删除且仅删除 `/etc/systemd/system/pm2-root.service.d/20-pin-node20-runtime.conf`，执行 `systemctl daemon-reload`；不得 restart/reload PM2。
3. 新 SSH 验证默认 `node` 回到 `/usr/bin/node v20.20.2`、默认 `pnpm` 回到 `9.15.4`，并复核 PM2 PID/restart/status/exe、应用哈希和 health。
4. `/opt/node-v22.23.1-linux-x64` 作为已校验的回滚证据先保留；只有确认不存在任何软链、unit 或运维脚本引用后，才能在独立清理任务中删除。

对应的安全命令骨架如下；执行前仍需单独操作授权：

```bash
for name in node npm npx corepack pnpm pnpx; do
  link="/usr/local/bin/$name"
  expected="/opt/node-v22.23.1-linux-x64/bin/$name"
  test -L "$link" && test "$(readlink "$link")" = "$expected" && unlink "$link"
done
cp -a /root/.cache/node/corepack/lastKnownGood.pre-node22-20260726.json \
  /root/.cache/node/corepack/lastKnownGood.rollback.tmp
mv -f /root/.cache/node/corepack/lastKnownGood.rollback.tmp \
  /root/.cache/node/corepack/lastKnownGood.json
rm -f /etc/systemd/system/pm2-root.service.d/20-pin-node20-runtime.conf
systemctl daemon-reload
```

## 后续硬边界

当前是“默认构建工具链 Node 22 + 运行中 PM2 Node 20”的受控临时态。下一次候选发布不得在现有运行目录直接执行 `pnpm install` 或覆盖 `node_modules`；必须在独立 release 目录用 Node 22 构建，并另行授权 PM2 运行时迁移、原生依赖验证、服务重启及回滚窗口。项目根 `engines.node >=20.19` 也应在独立代码任务中与 pnpm 11 的 `Node >=22.13` 要求对齐。

## 终审

- Claude：`KEEP_CURRENT_STATE`，Critical 0；提出的回滚命令、目录语境、任务状态和终审记录完备性意见已全部补齐。
- Antigravity：执行前分析与修订复审均最终 `APPROVE`；执行后终审已按模板调用，但因账号/资格服务异常未返回有效报告，不得写成双模型终审均通过。
