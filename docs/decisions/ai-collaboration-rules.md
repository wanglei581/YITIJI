# AI 协作规则

> 创建时间：2026-05-23  
> 适用对象：Claude Code、Codex

---

## 一、分工原则

| 角色 | 主要职责 | 工作目录 |
|------|---------|---------|
| Claude Code | 主力开发：编写和修改代码 | apps/、services/、packages/ |
| Codex | 审查、拆解、修正方案；关键问题修复；文档维护 | docs/、reviews/ |

两者不固定分离，可以互相补位，但要避免同时修改同一个文件。

---

## 二、共同规则

1. **每次开发前必读**：CLAUDE.md（Claude Code）或 AGENTS.md（Codex），确认当前模块是否涉及合规边界。
2. **不允许擅自新增招聘闭环功能**：任何看起来像"投递"、"候选人"、"企业端筛选"的功能，开发前必须确认合规。
3. **每次完成后更新进度**：修改 `docs/progress/current-progress.md`，记录完成了什么、状态如何。
4. **不同时修改同一文件**：Claude Code 和 Codex 应错开对同一文件的修改，避免 Git 冲突。
5. **不分叉副本**：不要创建 "Claude版"、"Codex版"、"备份版" 等子目录。所有代码和文档都在本仓库。
6. **旧秒哒项目只读**：legacy-miaoda/ 目录下的文件只能参考，不能作为正式开发基础修改。

---

## 三、合规红线（两者共同遵守）

以下功能无论谁开发，都一律不允许：

- 平台内一键投递
- 平台内收取求职者简历给企业
- 企业端候选人筛选、面试邀约、Offer 管理
- 候选人推荐给企业
- 自营网络招聘闭环
- 企业自主发布岗位并直接收简历

详见：[../compliance/compliance-boundary.md](../compliance/compliance-boundary.md)

---

## 四、进度同步规范

每次完成一个任务后，更新以下文件：

- `docs/progress/current-progress.md`：任务打勾，记录完成时间
- `docs/progress/next-tasks.md`：补充下一步任务

如果发现需要新增一个重要决策，在 `docs/decisions/` 下新建文件记录，命名格式：`YYYY-MM-DD-决策主题.md`

---

## 五、代码 review 流程

Codex 审查 Claude Code 提交的代码时，审查记录放在：

```
docs/reviews/codex-[模块]-review.md
```

例如：
- `docs/reviews/codex-kiosk-homepage-review.md`
- `docs/reviews/codex-print-flow-review.md`
- `docs/reviews/codex-compliance-check.md`

审查记录格式建议：

```markdown
# Codex 审查记录 - [模块名]

审查时间：YYYY-MM-DD
审查范围：文件列表

## 发现的问题
...

## 建议修改
...

## 合规检查
- [ ] 按钮文案是否合规
- [ ] 是否存在招聘闭环逻辑
- [ ] 文件安全是否符合要求
```

---

## 六、冲突解决

如果 Claude Code 和 Codex 对同一功能有不同方案，以下原则处理：

1. 以用户（王磊）的判断为最终依据
2. 两方写出各自方案，放在 `docs/decisions/` 供用户决策
3. 决定后记录在决策文件中，后续不再重复讨论
