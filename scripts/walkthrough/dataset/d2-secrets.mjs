// 机构账号密码只落在 secret/partners-v2.json（0600）。日志里不出现密码。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORGS } from './d2-catalog.mjs'
import { SECRET, makePassword, shanghaiIso, writePrivate } from './d2-lib.mjs'

const FILE = 'partners-v2.json'

function blankRecord(org) {
  return {
    key: org.key,
    orgName: org.name,
    previousName: org.previousName,
    orgIdHint: org.orgIdHint ?? null,
    outlet: org.outlet,
    terminalCode: org.terminalCode,
    typeLabel: org.typeLabel,
    domain: org.domain,
    username: org.username,
    accountName: org.accountName,
    phone: org.phone,
    contact: org.contact,
    contactPhone: org.contactPhone,
    initialPassword: makePassword(),
    accountCreated: false,
  }
}

export function loadPartnerSecrets() {
  const path = join(SECRET, FILE)
  if (!existsSync(path)) {
    const data = {
      version: 2,
      createdAt: shanghaiIso(),
      note: '数据集 v2 机构账号。密码只在本文件，权限 0600。',
      orgs: Object.fromEntries(ORGS.map((org) => [org.key, blankRecord(org)])),
    }
    writePrivate(FILE, data)
    return data
  }
  const data = JSON.parse(readFileSync(path, 'utf8'))
  let changed = false
  for (const org of ORGS) {
    if (!data.orgs?.[org.key]?.initialPassword) {
      data.orgs[org.key] = blankRecord(org)
      changed = true
    }
  }
  if (changed) writePrivate(FILE, data)
  else writePrivate(FILE, data)
  return data
}

export function savePartnerSecrets(data) {
  writePrivate(FILE, data)
}

export function accountOf(data, key) {
  const row = data.orgs[key]
  if (!row?.initialPassword) throw new Error(`缺少 ${key} 的账号记录`)
  return row
}
