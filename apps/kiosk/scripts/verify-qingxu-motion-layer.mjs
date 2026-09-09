#!/usr/bin/env node
/**
 * 青序流光动效层合同。
 *
 * 为什么需要它：设计系统原本三层（tokens 配色 / shell 外壳 / primitives 控件），
 * **动效整层缺失**——52 张编号稿里 24 张用 cubic-bezier，运行时一次都没有，
 * 于是迁过来的页面「结构对、手感不对」。产品负责人 2026-09-10 指出「线上前端
 * 页面质感和效果有点粗糙」，根因就是这一层。
 *
 * 这条门禁**不判「动效好不好看」**（判不了），只判三件能判的事：
 *   1. 动效层还在设计系统的 import 链上（漏掉整层是最可能的死法）
 *   2. 稿里的主曲线仍然被定义（缓动曲线决定手感，被删掉最难察觉）
 *   3. 无障碍降级还在（公共终端上前庭敏感的用户依赖它）
 *
 * 刻意**不钉**关键帧的具体数值、不钉时长、不钉用在哪些元素上——
 * 那些是设计决策，会随稿演进，钉死就成了又一条会过期的快照断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', 'src')
const read = (p) => readFileSync(join(src, p), 'utf8')

let failed = 0
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) { failed += 1; if (detail) console.log(`     ${detail}`) }
}

const index = read('styles/qingxu/index.css')
check(
  /@import\s+'\.\/motion\.css'/.test(index),
  '动效层挂在设计系统的 import 链上',
  "styles/qingxu/index.css 必须 @import './motion.css'——整层漏掉时页面仍能跑，" +
    '只是所有过渡退回浏览器默认曲线，没有任何报错。',
)

const motion = read('styles/qingxu/motion.css')

// 主曲线取自稿：cubic-bezier(.22,1,.36,1) 在 52 张编号稿里出现 21 次。
//
// **必须钉变量定义，不能钉「文件里出现过这串字符」**：本文件的注释里也写着这条曲线，
// 第一版断言用 includes 扫全文，把真正的 `--qx-ease:` 删掉之后**注释仍然满足断言**，
// 反向变异不红。这就是「断言锚在非行为文本上」——注释不是行为。
const easeDecl = motion.match(/--qx-ease\s*:\s*([^;]+);/)
check(
  Boolean(easeDecl) && /cubic-bezier\(\s*\.22\s*,\s*1\s*,\s*\.36\s*,\s*1\s*\)/.test(easeDecl[1]),
  '稿的主缓动曲线仍被定义（--qx-ease）',
  '这条曲线决定「手感」。删掉它页面照常渲染、其它门禁照常绿，只是回到浏览器默认 ease。',
)

check(
  /--qx-ease-soft\s*:/.test(motion) && /--qx-dur\s*:/.test(motion),
  '缓动与时长变量成套存在',
  '逐页写死数值会让下次调手感要改几十处。',
)

check(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(motion),
  '动效层自带无障碍降级',
  '公共终端上前庭敏感的用户依赖它；shell.css 里那条是外壳的，动效层要有自己的。',
)

// will-change 常驻会在 27 寸屏长跑中累积显存，这条是一体机特有的约束。
check(
  !/will-change\s*:/.test(motion),
  '不用 will-change 常驻提升图层',
  '一体机 7×24 运行，常驻图层提升会累积显存。需要时在具体交互期间临时加。',
)

console.log(failed === 0 ? '\nALL PASS — 青序流光动效层合同成立' : `\n${failed} 条未通过`)
process.exit(failed === 0 ? 0 : 1)
