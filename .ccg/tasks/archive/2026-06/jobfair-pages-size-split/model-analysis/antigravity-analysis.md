[codeagent-wrapper]
  Backend: antigravity
  Command: agy --add-dir /Users/wanglei/.config/superpowers/worktrees/AI求职打印服务终端/project-normalization-p0 -p # Antigravity Role: Architect

> For: /ccg:go planning phases

You are a senior full-stack architect powered by Antigravity (Gemini 3.5 Flash).

## CRITICAL CONSTRAINTS

- **ZERO file system write permission** - READ-ONLY mode
- **DO NOT create, modify, or delete ANY files**
- **DO NOT run shell commands that write to disk**
- **OUTPUT FORMAT**: Architecture plan / design document only
- You may READ files and run read-only commands

## Core Expertise

- System architecture design
- API design (REST, GraphQL, gRPC)
- Database schema design
- Component architecture and design systems
- Cloud-native patterns and microservices

## Planning Framework

### 1. Constraints Identification
- Existing architecture boundaries
- Technology stack constraints
- Performance requirements
- Timeline and complexity budget

### 2. Solution Design
- High-level architecture diagram (text-based)
- Component breakdown with responsibilities
- Data model and API contracts
- State management strategy

### 3. Implementation Plan
- Task decomposition (ordered, with dependencies)
- File-by-file change list
- Risk mitigation steps
- Validation criteria per task

## Response Structure

1. **Context Summary** - What exists today
2. **Design** - Proposed architecture
3. **Implementation Plan** - Step-by-step tasks
4. **Risks** - What could go wrong
5. **Validation** - How to verify success

## .context Awareness

If the project has a `.context/` directory:
1. Read `.context/prefs/coding-style.md` for architectural conventions
2. Check `.context/history/commits.jsonl` for past architectural decisions

<TASK>
项目：AI求职打印服务终端，当前分支 codex/jobfair-pages-size-split。
任务：Branch 3 招聘会/校园招聘页面大文件零行为拆分。

当前事实：
- apps/kiosk/src/pages/campus/CampusPage.tsx 约 897 行
- apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx 约 857 行
- apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx 约 647 行
- 已新增尺寸守卫 apps/kiosk/scripts/verify-jobfair-page-size.mjs，当前 RED，三个入口文件均超过 500 行。

目标：
1. 将上述三个入口页拆到每个主入口文件 <=500 行。
2. 只移动/提取现有组件、常量、helper，不改变行为。
3. 不改路由、API 调用、合规文案、按钮文案、外部跳转/二维码行为。
4. 不新增业务功能。

允许修改：
- apps/kiosk/src/pages/campus/CampusPage.tsx
- apps/kiosk/src/pages/campus/components/*
- apps/kiosk/src/pages/campus/types.ts / utils.ts
- apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx
- apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx
- apps/kiosk/src/pages/job-fairs/components/*
- apps/kiosk/src/pages/job-fairs/types.ts / utils.ts
- apps/kiosk/scripts/verify-jobfair-page-size.mjs
- docs/progress/current-progress.md, docs/progress/next-tasks.md
- .ccg/tasks/jobfair-pages-size-split/*

请做拆分前分析：
- 推荐每个页面提取哪些组件/常量/helper；
- 识别最容易造成行为变化的点；
- 给出实施顺序；
- 给出验收关注点。

OUTPUT: Markdown，分 Critical / Warning / Info。禁止修改文件。
</TASK>

  PID: 35756
  Log: /var/folders/wv/tfvgh3xd5g775gnqq5wpfbkm0000gn/T/codeagent-wrapper-35756.log
  Web UI: http://localhost:55935
I am searching for the repository directory under the user's home directory. I will wait for the search task to complete to identify the location of the codebase.
I am searching for the repository directory under the user's home directory. I will wait for the search task to complete to identify the location of the codebase.
