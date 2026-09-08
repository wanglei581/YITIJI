/**
 * 空态诚实性门禁（2026-09-08）。
 *
 * 线上三个内容库都是 0 条，所以**空态是用户唯一看得到的东西**。判据写在
 * docs/product/content-onboarding-runbook.md §5C：
 * **用户看完能知道「为什么空」和「接下来能做什么」。**
 *
 * 本门禁钉死的是其中最容易退化的一条：**「本机没上架」和「筛选筛空」必须分开**。
 * 这两种的补救动作完全相反 —— 前者用户什么都做不了（只能等接入），后者换个筛选就有。
 * 合成一句的后果实测过：库里 0 场时，用户没设过任何筛选，却被引导去「切换筛选条件」，
 * 切完还是空。
 *
 * 断言按「该不该存在」写，不是照现状抄：
 *   - 判「有没有接入」必须用**全量**字段（fairs / activeCat），不能用筛后的 filteredFairs
 *   - 两条分支的文案必须真的不同，否则拆了等于没拆
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
let failed = 0
const assert = (c, m) => { if (c) console.log(`  PASS  ${m}`); else { failed++; console.log(`  FAIL  ${m}`) } }

console.log('\n=== 空态诚实性：本机没上架 ≠ 筛选筛空 ===\n')

console.log('① 招聘会')
{
  const wxml = read('pages/fairs/fairs.wxml')
  assert(/wx:elif="\{\{fairs\.length === 0\}\}"/.test(wxml),
    '「本机没上架」用全量 fairs 判，不是筛后的 filteredFairs')
  assert(wxml.includes('本机尚未接入招聘会来源'), '没上架时说清是「本机尚未接入来源」')
  assert(wxml.includes('当前筛选下没有招聘会'), '筛空时说的是筛选，不是未接入')
  const noSource = wxml.slice(wxml.indexOf('本机尚未接入招聘会来源'), wxml.indexOf('当前筛选下没有招聘会'))
  assert(!/切换筛选|换个筛选/.test(noSource),
    '「未接入」那一支不得引导用户去调筛选（他没设过筛选，切了还是空）')
  assert(/bindtap="showAllFairs"/.test(wxml), '筛空那一支给出「看全部」这个真正有效的动作')
  assert(/showAllFairs\s*\(\)\s*\{/.test(read('pages/fairs/fairs.js')), 'showAllFairs 有实现，不是死按钮')
}

console.log('\n② 政策')
{
  const wxml = read('pages/policies/policies.wxml')
  assert(/policies\.length === 0 && activeCat === 'all'/.test(wxml),
    '「本机没上架」要求当前就在「全部」分类 —— 服务端已按 audience 过滤，只有全部分类下的空才是真的空')
  assert(wxml.includes('本机尚未接入政策来源'), '没上架时说清是「本机尚未接入来源」')
  assert(wxml.includes('该人群分类下暂无政策'), '分类为空时说的是分类，不是未接入')
  const noSource = wxml.slice(wxml.indexOf('本机尚未接入政策来源'), wxml.indexOf('该人群分类下暂无政策'))
  assert(!/换个人群分类|切换人群/.test(noSource), '「未接入」那一支不得引导去换分类')
  assert(/bindtap="showAllPolicies"/.test(wxml), '分类为空那一支给出「看全部政策」')
  assert(/showAllPolicies\s*\(\)\s*\{/.test(read('pages/policies/policies.js')), 'showAllPolicies 有实现')
}

console.log('\n③ 两页都不得把「来源未接入」说成系统故障')
for (const f of ['pages/fairs/fairs.wxml', 'pages/policies/policies.wxml']) {
  const w = read(f)
  const i = w.indexOf('本机尚未接入')
  const seg = i >= 0 ? w.slice(i, i + 400) : ''
  assert(!/系统错误|加载失败|服务异常|出错了/.test(seg),
    `${f}：未接入的空态不得写成故障（会让用户反复重试）`)
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 条失败\n`)
process.exit(failed === 0 ? 0 : 1)
