# 首页 fusion-youth stash 对齐审查

## 删除与保留结论

- `home-fusion-youth-override.css` 从未进入 Git，只存在于 `stash@{0}` 的未跟踪文件父提交；当前工作区无需恢复或迁移该文件。
- 旧文件 206 行规则全部作用于已退役 `.khome` 选择器，当前 `HomePage.tsx` 根节点为 `.kpv1`，且只导入 `prototype-v1.css`。
- 当前 `prototype-v1.css` 在精确 `[data-kiosk-presentation='fusion-youth']` 规则中唯一声明米白 `--pv-paper`、深绿 `--pv-ink`、青绿 `--pv-teal` 语义色。

## TDD 证据

1. RED 1：工作区仍有旧 override 文件时，单一样式来源合同唯一失败；删除工作区副本后 GREEN。
2. Cursor 首轮 Warning：原 palette 正则会让注释声明、非法尾缀和后续覆盖错误通过。
3. RED 2：三类恶意样本精确出现 3 项失败。
4. GREEN 2：去除 CSS 注释后提取精确 fusion 规则，解析声明并要求目标属性唯一、值精确相等；三类恶意样本与真实 token 均通过。
5. RED/GREEN 3：补同 selector 多规则块覆盖，聚合全部匹配块后拒绝。
6. RED/GREEN 4：补合法换行+Tab、双引号等价属性选择器与 selector list；改为规则 prelude + selector-list 解析后拒绝。
7. RED/GREEN 5：补 `--pv-paper: ;` 空值覆盖；空字符串也计入声明次数后拒绝。

## 验证

- `verify:home-prototype-v1`：PASS
- `verify:home-narrow-visual-balance`：PASS
- `verify:home-toolbox-ui`：PASS
- `verify:fusion-home`：PASS
- Kiosk `typecheck`：PASS
- Kiosk `lint`：PASS（0 error，6 条任务前既有 Fast Refresh warning）
- 生产构建：PASS（`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true`；仅既有 chunk-size warning）
- Playwright `test:browser:smoke`：6/6 PASS
- `git diff --check`：PASS

## 模型审查

- Claude 首轮：APPROVE，无 Critical/Warning。
- Antigravity 首轮：APPROVE，无 Critical/Warning。
- Cursor 首轮：REQUEST_CHANGES，1 个 palette 守卫假阳性 Warning；已按第二轮 RED→GREEN 修复。
- Claude 最终：APPROVE，无 Critical/Warning。
- Antigravity 完整 selector 解析版：APPROVE，无 Critical/Warning；最后一行空值修复重试因 CLI 认证 token 不可用未返回报告，不伪造批准。
- Cursor 最终：APPROVE；独立复测空值前置、跨块空值、仅空值均拒绝，唯一正确声明仍通过。

## Stash 处置

- 删除前再次确认 `stash@{0}` 精确 hash 为 `18bffcf5d89a111f60ffd626944a0b3d065b6366`，且旧 override 文件不存在、全部验证通过。
- 已按用户明确授权仅删除该 stash；其余 stash 未触碰。
