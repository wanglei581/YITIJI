# Phase 0 代码审查报告

**审查角色：** Code Reviewer 👁️ + Frontend Developer 🖥️（Agency Agents catalog）
**审查时间：** 2026-05-23
**审查范围：** Phase 0 初始化，包含 monorepo 配置、三端 app、packages/ui、packages/shared
**整体印象：** 工程结构干净，零 lint/typecheck 报错，跨平台脚本规范。发现 1 个 Blocker 需修复后才能进入 Phase 1。

---

## 总体评价

✅ pnpm workspace 结构合理，包命名空间统一（`@ai-job-print/*`）
✅ tsconfig 继承链清晰，strict 模式全开
✅ ESLint flat config 覆盖 apps 和 packages
✅ 跨平台脚本：无 `rm -rf`、无 `export VAR=`、无硬编码路径
✅ Tailwind v4 + `@tailwindcss/vite` 接入方式正确
✅ packages/shared 类型定义覆盖了项目核心数据边界（User / Device / Job / Print）
⚠️ 发现 1 个 Blocker、5 个 Suggestion、3 个 Nit

---

## 🔴 Blocker（必须修复）

### B-1：Button 触控区域不满足一体机最低要求

**文件：** `packages/ui/src/components/Button.tsx`

Button 组件的 `sm` 和 `md` 尺寸不满足 CLAUDE.md 规定的触控最低标准：

| size | 当前高度 | 换算 px | 要求 | 状态 |
|------|---------|--------|------|------|
| `sm` | `h-8`   | 32px   | ≥ 48px（所有可点击区域） | ❌ |
| `md` | `h-11`  | 44px   | ≥ 48px | ❌ |
| `lg` | `h-14`  | 56px   | ≥ 56px（主按钮） | ✅ |

**为什么：** 一体机 27 寸竖屏触控显示器用手指操作，48px 以下按钮极易误触或点不准。CLAUDE.md 明确："所有可点击区域不小于 48px，主按钮触控区域不小于 56px"。

**建议修复：**
```ts
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-12 px-3 text-sm min-w-[48px]',   // h-12 = 48px ✅
  md: 'h-12 px-4 text-base min-w-[48px]',  // h-12 = 48px ✅
  lg: 'h-14 px-6 text-lg min-w-[56px]',   // h-14 = 56px ✅
}
```

---

## 🟡 Suggestion（应当修复）

### S-1：Button 缺少 `type="button"` 默认值

**文件：** `packages/ui/src/components/Button.tsx`

**为什么：** HTML `<button>` 在 `<form>` 内默认 `type="submit"`。若 Button 被用于表单内而未显式传 `type`，会意外触发表单提交。这是一个极常见的 bug 来源。

**建议：**
```tsx
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',  // ← 加这一行
  ...
}: ButtonProps) {
```

---

### S-2：三个 app 的 `vite.config.ts` 缺少 `@` 路径别名

**文件：** `apps/kiosk/vite.config.ts`、`apps/admin/vite.config.ts`、`apps/partner/vite.config.ts`

**为什么：** 随着页面和组件增加，相对路径 `../../../components/...` 难以维护。现在统一配置，后续所有导入都用 `@/components/...`，重构时也不用逐层调整。

**建议在 vite.config.ts 中加：**
```ts
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
})
```

**同时在各 app 的 `tsconfig.json` 补充：**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

### S-3：Phase 0 要求的 `.env.example` 未创建

**为什么：** CLAUDE.md Phase 0 任务清单包含"创建 .env.example"，当前缺失。后续加入后端 API、对象存储、打印机 appKey 时，新开发者不知道需要哪些环境变量。

**建议在根目录创建：**
```env
# 前端 API 地址
VITE_API_BASE_URL=http://localhost:3000

# 对象存储（阿里云 OSS / 腾讯 COS / MinIO）
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=
OSS_REGION=

# 奔图打印机（仅服务端，禁止加 VITE_ 前缀）
PANTUM_APP_KEY=
PANTUM_APP_SECRET=

# 数据库
DATABASE_URL=

# Redis
REDIS_URL=
```

---

### S-4：`StatusBadge` 缺少无障碍语义

**文件：** `packages/ui/src/components/StatusBadge.tsx`

**为什么：** 设备状态（在线/离线/故障）如果动态变化，屏幕阅读器不会自动朗读。管理员后台运维人员可能使用屏幕阅读器。

**建议：**
```tsx
export function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[...].join(' ')}
    >
      {label}
    </span>
  )
}
```

---

### S-5：`Button` 缺少 `forwardRef`

**文件：** `packages/ui/src/components/Button.tsx`

**为什么：** 作为公共组件库，Button 不支持 `ref` 转发，则无法被 Radix UI Tooltip、Popover、DropdownMenu 的 `asChild` 模式使用。Phase 1 引入 shadcn/ui 时必然需要修改，不如现在一起加。

**建议：**
```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', type = 'button', className = '', disabled, children, ...props }, ref) => (
    <button ref={ref} type={type} className={[...].join(' ')} disabled={disabled} {...props}>
      {children}
    </button>
  )
)
Button.displayName = 'Button'
```

---

## 💭 Nit（有空可优化）

### N-1：ESLint 可补充 `consistent-type-imports` 规则

**文件：** `eslint.config.mjs`

强制区分值导入和类型导入，有利于 tree-shaking 和编译速度：

```js
'@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
```

---

### N-2：`tsconfig.base.json` 可补充 workspace 包路径

当 app 导入 `@ai-job-print/ui` 时，pnpm symlink 通常够用。但补充 paths 后 IDE 跳转更可靠：

```json
"paths": {
  "@ai-job-print/ui": ["./packages/ui/src/index.ts"],
  "@ai-job-print/shared": ["./packages/shared/src/index.ts"]
}
```

---

### N-3：shadcn/ui 未初始化，建议在 next-tasks 中明确为 Phase 1 第一步

CLAUDE.md 技术栈中包含 shadcn/ui，Phase 0 未装（合理），但 Phase 1 设计系统阶段应先装好再写组件，否则组件会写两遍。

---

## 合规检查

| 检查项 | 结果 |
|--------|------|
| 是否出现"一键投递"、"立即投递"等禁用文案 | ✅ 无 |
| 是否有将简历传给企业的接口或逻辑 | ✅ 无 |
| 是否有企业端候选人管理功能 | ✅ 无 |
| 是否有 appSecret 在前端代码中出现 | ✅ 无 |
| 岗位数据是否已包含合规必填字段 | ✅ ExternalJobSource 包含全部字段 |

---

## 修复优先级汇总

| 优先级 | 问题 | 文件 |
|--------|------|------|
| 🔴 B-1 必须修复 | Button sm/md 触控尺寸 < 48px | `packages/ui/src/components/Button.tsx` |
| 🟡 S-1 应当修复 | Button 缺少 `type="button"` 默认值 | 同上 |
| 🟡 S-2 应当修复 | vite.config.ts 缺少 `@` 路径别名 | `apps/*/vite.config.ts` |
| 🟡 S-3 应当修复 | 缺少 `.env.example` | 根目录 |
| 🟡 S-4 应当修复 | StatusBadge 缺少 `role="status"` | `packages/ui/src/components/StatusBadge.tsx` |
| 🟡 S-5 应当修复 | Button 缺少 forwardRef | `packages/ui/src/components/Button.tsx` |
| 💭 N-1 可选 | ESLint consistent-type-imports | `eslint.config.mjs` |
| 💭 N-2 可选 | tsconfig workspace paths | `tsconfig.base.json` |
| 💭 N-3 可选 | 明确 shadcn/ui 为 Phase 1 第一步 | `docs/progress/next-tasks.md` |

---

## 建议下一步

1. **修复 B-1**（Button 尺寸）— 这是 Phase 0 完成的前置条件
2. **一并修复 S-1、S-5**（同一个文件，一起改成本最低）
3. **S-3**（`.env.example`）成本极低，5 分钟内完成
4. **S-2**（路径别名）建议 Phase 1 开始前补上，否则第一批页面就要全部改
5. shadcn/ui 初始化放 Phase 1 第一步，再动 packages/ui 组件

---

*审查完成 — Code Reviewer 👁️ + Frontend Developer 🖥️ via Agency Agents*
