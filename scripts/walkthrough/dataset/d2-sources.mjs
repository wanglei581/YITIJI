// 找 D1 的政策稿和渠道稿。两处都看：缓存目录，以及 D1 worktree。
// 稿在但解析不完整时停下，不拿草案盖掉别人写好的内容。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORGS } from './d2-catalog.mjs'
import { draftChannelsMarkdown, draftPoliciesMarkdown } from './d2-draft.mjs'
import { EVID, ROOT } from './d2-lib.mjs'
import { hostsOf, parseChannels, parsePolicies } from './d2-parse.mjs'

export const D1_DIR = '/Users/wanglei/AI求职打印服务终端/.claude/worktrees/grok-dataset-d1/scripts/walkthrough/dataset'
export const CACHE_DIR = join(ROOT, 'dataset')

function pairFrom(dir) {
  const policies = join(dir, 'policies.md')
  const channels = join(dir, 'channels.md')
  if (!existsSync(policies) || !existsSync(channels)) return null
  if (statSync(policies).size < 200 || statSync(channels).size < 80) return null
  return {
    policies,
    channels,
    mtime: Math.max(statSync(policies).mtimeMs, statSync(channels).mtimeMs),
  }
}

export function findContentFiles() {
  const found = [pairFrom(D1_DIR), pairFrom(CACHE_DIR)].filter(Boolean)
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0] ?? null
}

export function inspectContent(paths) {
  const policiesMd = readFileSync(paths.policies, 'utf8')
  const channelsMd = readFileSync(paths.channels, 'utf8')
  const policies = parsePolicies(policiesMd)
  const channels = parseChannels(channelsMd)
  const problems = []
  if (policies.length < 12 || policies.length > 20) problems.push(`政策 ${policies.length} 条，规格是 12–20`)
  if (channels.length < 4) problems.push(`渠道只解析出 ${channels.length} 条`)
  const marks = new Set(policies.map((item) => item.disposition))
  if (!marks.has('expired')) problems.push('没有「已过期」')
  if (!marks.has('takedown')) problems.push('没有「准备下架」')
  if (!marks.has('pending')) problems.push('没有「待审核」')
  for (const org of ORGS) {
    const channelCount = channels.filter((item) => item.orgKey === org.key).length
    if (channelCount < 1 || channelCount > 3) problems.push(`${org.name} 渠道 ${channelCount} 条`)
    if (!policies.some((item) => item.orgKey === org.key)) problems.push(`${org.name} 没有政策`)
  }
  return { policies, channels, problems, paths }
}

function writeDebug(paths, problems, policies, channels) {
  const lines = [
    `# 解析未通过`,
    '',
    `政策稿：${paths.policies}`,
    `渠道稿：${paths.channels}`,
    '',
    ...problems.map((item) => `- ${item}`),
    '',
    '## 政策',
    ...policies.map((item) => `- ${item.orgKey} ${item.disposition} ${item.title}`),
    '',
    '## 渠道',
    ...channels.map((item) => `- ${item.orgKey} ${item.order} ${item.name} ${item.url}`),
    '',
  ]
  writeFileSync(join(EVID, 'parse-debug.md'), lines.join('\n'))
}

export function loadReadyContent() {
  const paths = findContentFiles()
  if (!paths) return null
  const inspected = inspectContent(paths)
  if (inspected.problems.length) {
    writeDebug(paths, inspected.problems, inspected.policies, inspected.channels)
    throw new Error(`D1 稿已出现，但解析不完整：${inspected.problems.join('；')}。见 evidence/dataset-d2/parse-debug.md`)
  }
  return {
    source: 'd1',
    policies: inspected.policies,
    channels: inspected.channels,
    paths,
    hostsByOrg: Object.fromEntries(ORGS.map((org) => [org.key, hostsOf(inspected.channels, org.key)])),
  }
}

export function loadDraftContent() {
  const policiesMd = draftPoliciesMarkdown()
  const channelsMd = draftChannelsMarkdown()
  const policiesPath = join(EVID, 'draft-policies.md')
  const channelsPath = join(EVID, 'draft-channels.md')
  writeFileSync(policiesPath, policiesMd)
  writeFileSync(channelsPath, channelsMd)
  const inspected = inspectContent({ policies: policiesPath, channels: channelsPath })
  if (inspected.problems.length) {
    writeDebug(inspected.paths, inspected.problems, inspected.policies, inspected.channels)
    throw new Error(`示例草案自己都解析不过：${inspected.problems.join('；')}`)
  }
  return {
    source: '示例草案',
    policies: inspected.policies,
    channels: inspected.channels,
    paths: inspected.paths,
    hostsByOrg: Object.fromEntries(ORGS.map((org) => [org.key, hostsOf(inspected.channels, org.key)])),
  }
}

export async function waitForContent({ timeoutMs = 60 * 60 * 1000, intervalMs = 3 * 60 * 1000 } = {}) {
  const started = Date.now()
  for (;;) {
    const paths = findContentFiles()
    if (paths) return loadReadyContent()
    const elapsed = Date.now() - started
    if (elapsed >= timeoutMs) return null
    const wait = Math.min(intervalMs, timeoutMs - elapsed)
    console.log(`D1 政策稿和渠道稿还没到，${Math.round(wait / 1000)} 秒后再看`)
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}
