import assert from 'node:assert/strict'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { createApiClient, createDirectHttpAgents } from '../src/agent/api-client'

type AgentWithOptions = HttpAgent & { options: { keepAlive?: boolean } }

function getHeaderValue(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined
  const record = headers as Record<string, unknown>
  return record[name] ?? record[name.toLowerCase()]
}

function keepAliveOf(agent: HttpAgent): boolean | undefined {
  return (agent as AgentWithOptions).options.keepAlive
}

const directAgents = createDirectHttpAgents()

assert.ok(directAgents.httpAgent instanceof HttpAgent, 'httpAgent must be a Node HTTP Agent')
assert.ok(directAgents.httpsAgent instanceof HttpsAgent, 'httpsAgent must be a Node HTTPS Agent')
assert.equal(keepAliveOf(directAgents.httpAgent), false, 'HTTP agent must not keep sockets alive')
assert.equal(keepAliveOf(directAgents.httpsAgent), false, 'HTTPS agent must not keep sockets alive')

const client = createApiClient('http://127.0.0.1:3000/api/v1', 'agent-token', 'terminal-01')

assert.ok(client.defaults.httpAgent instanceof HttpAgent, 'API client must use direct HTTP agent')
assert.ok(client.defaults.httpsAgent instanceof HttpsAgent, 'API client must use direct HTTPS agent')
assert.equal(keepAliveOf(client.defaults.httpAgent), false, 'API HTTP agent must not keep sockets alive')
assert.equal(keepAliveOf(client.defaults.httpsAgent), false, 'API HTTPS agent must not keep sockets alive')
assert.equal(client.defaults.proxy, false, 'API client must bypass proxy auto-detection')
assert.equal(getHeaderValue(client.defaults.headers, 'Connection'), 'close', 'API client must request connection close')

console.log('verify-direct-http-agents: ok')
