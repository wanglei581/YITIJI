# F1 D2′ PM2 隔离修复审查

## 结论

- Antigravity 最终复审：`APPROVE`，Critical 0，Warning 0。
- Claude 最终复审：`APPROVE`；唯一 Warning 是 SIGTERM 后进程恰好退出导致第二次读取 `/proc`
  误报失败，已补 ENOENT + `!processExists(pid)` 成功分支并复验。
- Cursor 最终复审：`APPROVE`，无影响隔离语义的 Critical / Warning；此前 NUL、直接 PID 兜底、
  行为测试三组阻断项均确认关闭。

## 已关闭问题

1. 深仓库路径造成 `pub.sock` / `rpc.sock` 超过 Linux AF_UNIX 预算：改用
   `/run/user/<uid>/d2p-<nonce>/{p,l,m}`，并以 UTF-8 103-byte 上限 fail-closed。
2. PM2 预检或清理挂起：所有相关调用有显式 timeout；父 CLI 失败但 daemon 已派生时，
   spawn-attempt tracker 仍触发清理。
3. `pm2 kill` 未终止 daemon：只从当前私有控制根读取受约束的 `pm2.pid`，仅在 UID、精确
   `PM2_HOME` 环境和 PM2 God Daemon title 全匹配时 TERM，SIGKILL 前重新验证身份。
4. 清理竞态：stop marker 的 `EEXIST` 被精确容忍；daemon 在 SIGTERM 后退出造成的 `/proc`
   ENOENT 被识别为成功，其他身份不可读或 PID 复用仍 fail-closed。
5. 测试覆盖：补 103/104 ASCII、中文多字节、NUL、tracker 非法转换、部分启动仿真、CLI
   实际拒绝和 daemon 身份正反例；原源码结构断言仅作为辅助防线。

## 验证边界

已通过 offline contract、Shell/Node 语法、API typecheck/lint/build 和 `git diff --check`。
未运行真实 PM2/systemd/Nginx，未重跑 full drill，未连接 production，未改写旧 NO-GO evidence。
因此本审查只批准修复候选，不构成 D2′ PASS、部署授权或 D3–D6 授权。
