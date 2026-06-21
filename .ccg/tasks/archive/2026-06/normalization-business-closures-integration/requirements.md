# 规范化治理与首批业务闭合集成收口

## 目标

- 从干净 `main` 集成已经验证过的规范化治理、我的页商用闭环、AI 简历资产闭环提交。
- 形成一个可审查的集成分支，避免把主工作区 untracked 混乱项带入。
- 跑总验证并做 Claude + Antigravity 双模型复审。

## 非目标

- 不清理主工作区本地 untracked 文件。
- 不推进招聘会 / 校园招聘新闭环。
- 不修改生产部署、密钥、数据库迁移或硬件链路。
- 不直接 push / merge。

## 候选提交

按 `git log --reverse main..codex/my-documents-delete-action`：

- `dc32472f` docs: record P0-0617 closure merge (#54)
- `de212131` docs: establish project normalization baseline
- `940e7485` docs: classify normalization worktree inventory
- `f54eacd3` docs: define codex claude normalization collaboration
- `59d930ad` docs: add normalization truth audit
- `b48506a9` docs: roll up normalization progress entries
- `1549c33c` docs: propose local tool ignore strategy
- `94cbda92` docs: land local tool ignore boundaries
- `a0a75b08` docs: triage local task evidence
- `051af3b6` docs: index external normalization materials
- `df908f13` docs: plan profile commercial closure
- `14b9028a` refactor: split profile page structure
- `35da23f0` feat: add profile ai records page
- `281eed9d` feat: link print orders to feedback
- `c7d7f70c` docs: plan ai resume assets closure
- `07b83b34` feat: add my resumes page
- `72512902` feat: harden my resumes actions
- `75bd7961` feat: add my documents delete action

## 预期验证

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`
- `pnpm --filter @ai-job-print/api verify:member-print-orders`
