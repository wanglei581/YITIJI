# Review — control-claude-company-real-redesign

## 双模型审查结论

- Antigravity 最终复审：APPROVE；无 Critical / Warning。认可直辖市禁用城市下拉、区县直接可选；确认完整地区字典、地区容错和合规文案无回归。
- Claude 最终复审：APPROVE；无 Critical。建议保留注释说明地区别名匹配的隐式契约，已补入 `services/api/src/companies/companies.service.ts`。

## 已修复的审查问题

- 直辖市 `city=市辖区` 导致后端等值过滤空结果：前端对直辖市下发 `city=''`，按省 + 区查询；区县直接可选。
- Kiosk 完整字典与 Admin/Partner 自由文本录入脱钩导致假空态：后端公开查询增加规范值 + 常见无后缀别名匹配。
- shared/backend 企业类型、行业、来源字典手工同步无门禁：`verify:companies` 增加 `expectSameSet` 断言。

## 验证结果

- `pnpm --filter ./services/api verify:companies`：PASS，15 checks。
- `pnpm --filter ./services/api typecheck`：PASS。
- `pnpm --filter ./apps/kiosk typecheck`：PASS。
- `pnpm --filter ./apps/admin typecheck`：PASS。
- `pnpm --filter ./apps/partner typecheck`：PASS。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter ./apps/kiosk build`：PASS。

## 剩余非阻塞事项

- `getCompanyFilters()` / `/companies/filters` / `filtersPublic()` 仍作为旧公开筛选接口保留，当前 Kiosk 不再消费；后续可单独清理或标注保留用途。
- 更彻底的录入规范化可以后续把 Admin/Partner 地区输入改为同一个 RegionPicker；本轮通过后端容错保证现有数据可正常筛选。
