#!/usr/bin/env node
// ============================================================
// 走查专用：把本机 API 的 AI 模型配置指向假模型服务。
//
// 为什么需要它：后台「AI 模型配置」接口会拒绝本机 / 内网地址
// （services/api/src/ai/llm/llm-base-url.ts 的 AI_BASE_URL_PRIVATE），
// 环境变量兜底又只认厂商预设地址，所以走查只能直接写配置文件。
// 写入格式与 LlmConfigService 读取的 ${FILE_STORAGE_DIR}/ai-model-configs.json 一致，
// 密钥用与 common/crypto/secret-cipher.ts 相同的 AES-256-GCM + scrypt 方案加密。
//
//   FILE_STORAGE_DIR=<走查 API 的数据目录> SECRET_ENCRYPTION_KEY=<与走查 API 相同> \
//     node scripts/walkthrough/seed-ai-model-config.mjs [--base-url http://127.0.0.1:4340/v1]
//
// 只写 5 个父键；job_fit / career_plan / self_assessment / fair_visit_plan /
// job_recommend / job_explain 继承 resume_optimize，advisor_work 继承 assistant_chat。
// 已有文件会先备份成 .bak-<时间戳>。**不要对生产或共用数据目录运行。**
// API 进程只在启动时读这个文件，写完要重启走查 API。
// ============================================================

import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const dataDir = process.env.FILE_STORAGE_DIR
const secret = process.env.SECRET_ENCRYPTION_KEY
if (!dataDir) {
  process.stderr.write('需要 FILE_STORAGE_DIR（走查 API 的数据目录）\n')
  process.exit(1)
}
if (!secret || secret.length < 32) {
  process.stderr.write('需要 SECRET_ENCRYPTION_KEY（≥32 字符，且必须与走查 API 进程使用的一致）\n')
  process.exit(1)
}

const baseURL = argValue('--base-url', `http://127.0.0.1:${process.env.FAKE_LLM_PORT || 4340}/v1`)
const apiKey = argValue('--api-key', 'walk-fake-llm-key')
const model = argValue('--model', 'deepseek-v4-flash')

function encryptSecret(plain) {
  const key = scryptSync(secret, Buffer.from('ai-job-print-cipher-salt-v1', 'utf-8'), 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  return `${iv.toString('base64')}:${ct.toString('base64')}:${cipher.getAuthTag().toString('base64')}`
}

const PARENT_KEYS = ['assistant_chat', 'resume_diagnosis', 'resume_generate', 'resume_optimize', 'mock_interview']
const config = Object.fromEntries(PARENT_KEYS.map((key) => [key, {
  vendor: 'deepseek',
  model,
  baseURL,
  temperature: 0.3,
  enabled: true,
  apiKeyEncrypted: encryptSecret(apiKey),
  explicitlyConfigured: true,
}]))

const dir = resolve(dataDir)
mkdirSync(dir, { recursive: true })
const file = join(dir, 'ai-model-configs.json')
if (existsSync(file)) {
  const backup = `${file}.bak-${Date.now()}`
  copyFileSync(file, backup)
  process.stdout.write(`已备份原配置到 ${backup}\n`)
}
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
process.stdout.write(`已写入 ${file}：${PARENT_KEYS.join(' / ')} → ${baseURL}（model=${model}）。请重启走查 API。\n`)
