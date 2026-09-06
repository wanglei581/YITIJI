#!/usr/bin/env node
// Baidu BOS BCE authentication v1. Algorithm source: Baidu Cloud BOS API
// authentication documentation (bce-auth-v1 canonical request signing).
// This client intentionally uses only Node.js built-ins so it can run before
// package installation in CI and on the production host.

import { createHmac } from 'node:crypto'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const DEFAULT_ENDPOINT = 'bj.bcebos.com'
const DEFAULT_BUCKET = 'ai-job-print-release'
const AUTH_EXPIRE_SECONDS = 1800
const REQUEST_TIMEOUT_MS = 60_000

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function canonicalUriForKey(key) {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('BOS key must be a non-empty relative path without dot segments')
  }
  return `/${key.split('/').map(encodeRfc3986).join('/')}`
}

function canonicalHeaders(headers, signedHeaderNames) {
  return signedHeaderNames
    .map((name) => {
      const value = headers[name]
      if (value === undefined) throw new Error(`missing signed header: ${name}`)
      return `${encodeRfc3986(name)}:${encodeRfc3986(String(value).trim().replace(/\s+/g, ' '))}`
    })
    .join('\n')
}

function hmacSha256(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding)
}

/** Creates a BCE v1 Authorization header without exposing secret values. */
export function createAuthorization({ accessKey, secretKey, method, host, canonicalUri, date, expireSeconds = AUTH_EXPIRE_SECONDS }) {
  const signedHeaders = ['host', 'x-bce-date']
  const authStringPrefix = `bce-auth-v1/${accessKey}/${date}/${expireSeconds}`
  const headers = { host, 'x-bce-date': date }
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    '',
    canonicalHeaders(headers, signedHeaders),
  ].join('\n')
  const signingKey = hmacSha256(secretKey, authStringPrefix)
  const signature = hmacSha256(signingKey, canonicalRequest, 'hex')
  return `${authStringPrefix}/${signedHeaders.join(';')}/${signature}`
}

function readConfig() {
  const accessKey = process.env.BOS_RELEASE_ACCESS_KEY
  const secretKey = process.env.BOS_RELEASE_SECRET_KEY
  if (!accessKey || !secretKey) {
    console.error('BOS credentials are not configured')
    process.exit(2)
  }

  const scheme = process.env.BOS_RELEASE_SCHEME || 'https'
  if (scheme !== 'https' && scheme !== 'http') throw new Error('BOS_RELEASE_SCHEME must be https or http')
  const endpoint = process.env.BOS_RELEASE_ENDPOINT || DEFAULT_ENDPOINT
  const bucket = process.env.BOS_RELEASE_BUCKET || DEFAULT_BUCKET
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(bucket)) throw new Error('BOS_RELEASE_BUCKET is invalid')
  return { accessKey, secretKey, scheme, endpoint, bucket }
}

function bceDate(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function requestForKey(method, key, config) {
  const canonicalUri = canonicalUriForKey(key)
  const objectHost = `${config.bucket}.${config.endpoint}`
  const endpointUrl = new URL(`${config.scheme}://${config.endpoint}`)
  const date = bceDate()
  const authorization = createAuthorization({
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    method,
    host: objectHost,
    canonicalUri,
    date,
  })
  return {
    transport: endpointUrl.protocol === 'https:' ? https : http,
    options: {
      method,
      // 真实 BOS 走虚拟主机域名（bucket.endpoint），TLS SNI 与 Host 一致；http 仅供本地桩测试，桩监听的是 endpoint 本身。
      hostname: endpointUrl.protocol === 'https:' ? objectHost : endpointUrl.hostname,
      port: endpointUrl.port || undefined,
      path: canonicalUri,
      headers: { host: objectHost, 'x-bce-date': date, Authorization: authorization },
      timeout: REQUEST_TIMEOUT_MS,
    },
  }
}

function responseStatus(response, key) {
  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) return
  const status = response.statusCode || 0
  response.resume()
  const error = new Error(`BOS ${response.req.method} failed for ${key}: HTTP ${status}`)
  error.statusCode = status
  throw error
}

async function putObject(key, inputFile, config) {
  const size = statSync(inputFile).size
  const { transport, options } = requestForKey('PUT', key, config)
  options.headers['content-length'] = String(size)
  await new Promise((resolve, reject) => {
    const request = transport.request(options, (response) => {
      try {
        responseStatus(response, key)
        response.resume()
        response.on('end', resolve)
      } catch (error) {
        reject(error)
      }
    })
    request.on('timeout', () => request.destroy(new Error('BOS request timed out after 60s')))
    request.on('error', reject)
    createReadStream(inputFile).on('error', reject).pipe(request)
  })
}

async function getObject(key, outputFile, config) {
  const tempFile = `${outputFile}.partial-${process.pid}`
  try {
    await new Promise((resolve, reject) => {
      const { transport, options } = requestForKey('GET', key, config)
      const request = transport.request(options, (response) => {
        try {
          responseStatus(response, key)
          const output = createWriteStream(tempFile, { flags: 'w' })
          output.on('error', reject)
          output.on('finish', resolve)
          response.on('error', reject).pipe(output)
        } catch (error) {
          reject(error)
        }
      })
      request.on('timeout', () => request.destroy(new Error('BOS request timed out after 60s')))
      request.on('error', reject)
      request.end()
    })
    await rename(tempFile, outputFile)
  } catch (error) {
    await unlink(tempFile).catch(() => {})
    throw error
  }
}

async function headObject(key, config) {
  try {
    await new Promise((resolve, reject) => {
      const { transport, options } = requestForKey('HEAD', key, config)
      const request = transport.request(options, (response) => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          response.resume()
          resolve()
          return
        }
        const error = new Error(`BOS HEAD failed for ${key}: HTTP ${response.statusCode || 0}`)
        error.statusCode = response.statusCode || 0
        response.resume()
        reject(error)
      })
      request.on('timeout', () => request.destroy(new Error('BOS request timed out after 60s')))
      request.on('error', reject)
      request.end()
    })
  } catch (error) {
    if (error.statusCode === 404) process.exitCode = 3
    else throw error
  }
}

async function main() {
  const [command, key, file] = process.argv.slice(2)
  if (!['get', 'put', 'head'].includes(command) || !key || (command !== 'head' && !file)) {
    console.error('usage: bos-object.mjs get <key> <outfile> | put <key> <infile> | head <key>')
    process.exit(1)
  }
  const config = readConfig()
  if (command === 'get') await getObject(key, file, config)
  if (command === 'put') await putObject(key, file, config)
  if (command === 'head') await headObject(key, config)
}

// Fixed fake-key vector. It only runs under node --test when this module is named explicitly.
const isNodeTest = Boolean(process.env.NODE_TEST_CONTEXT)
if (isNodeTest) {
  test('BCE v1 authorization fixed vector', () => {
    assert.equal(
      createAuthorization({
        accessKey: 'AKIDEXAMPLE',
        secretKey: 'fake-secret-for-test-only',
        method: 'GET',
        host: 'ai-job-print-release.bj.bcebos.com',
        canonicalUri: '/release-abc.bundle',
        date: '2026-09-06T12:00:00Z',
      }),
      'bce-auth-v1/AKIDEXAMPLE/2026-09-06T12:00:00Z/1800/host;x-bce-date/96f36567ce5187188cf3dd477ab70eb3cad075b2dd4ae45b7bd1032b0c645846',
    )
  })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`BOS operation failed: ${error.message}`)
    process.exit(1)
  })
}
