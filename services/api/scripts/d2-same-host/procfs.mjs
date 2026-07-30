#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function fail(code) {
  throw new Error(`D2_PRIME_${code}`)
}

export function parseControlGroup(value) {
  if (typeof value !== 'string') fail('CGROUP_INVALID')
  const matches = value
    .split('\n')
    .filter((line) => line.startsWith('0::'))
  if (matches.length !== 1) fail('CGROUP_INVALID')

  const controlGroupPath = matches[0].slice(3)
  if (!controlGroupPath.startsWith('/') || /[\0\r\n]/.test(controlGroupPath)) fail('CGROUP_INVALID')
  return controlGroupPath
}

export function controlGroup(pid, { readFile = readFileSync } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) fail('CGROUP_PID_INVALID')
  if (typeof readFile !== 'function') fail('CGROUP_UNREADABLE')

  let value
  try {
    value = readFile(`/proc/${pid}/cgroup`, 'utf8')
  } catch {
    fail('CGROUP_UNREADABLE')
  }
  return parseControlGroup(value)
}
