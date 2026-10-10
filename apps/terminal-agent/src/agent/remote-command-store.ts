/** 复用 Agent SQLite；仅保存指令结果，无打印/扫描 PII。 */
import { getActiveDatabase, type AgentDatabase } from './db'
import type { RemoteCommandResult } from './remote-commands'

export interface StoredCommandResult {
  commandId: string
  type: 'clear_print_queue'
  result: RemoteCommandResult
  remainingJobs: number
  finishedAt: string
}
export interface RemoteCommandStore {
  get: (id: string) => StoredCommandResult | undefined
  put: (record: StoredCommandResult) => void
  prune: (now: Date) => void
}
export function createRemoteCommandStore(
  database: () => AgentDatabase = getActiveDatabase,
): RemoteCommandStore {
  const db = () => {
    const value = database()
    if (!value) throw new Error('REMOTE_COMMAND_DB_UNAVAILABLE')
    return value
  }
  return {
    get: (id) => db().prepare('SELECT commandId, type, result, remainingJobs, finishedAt FROM remote_command_results WHERE commandId = ?').get(id) as unknown as StoredCommandResult | undefined,
    put: (row) => {
      db().prepare(`INSERT INTO remote_command_results (commandId, type, result, remainingJobs, finishedAt)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(commandId) DO UPDATE SET result=excluded.result,
        remainingJobs=excluded.remainingJobs`).run(row.commandId, row.type, row.result, row.remainingJobs, row.finishedAt)
    },
    prune: (now) => {
      db().prepare('DELETE FROM remote_command_results WHERE finishedAt < ?')
        .run(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
    },
  }
}
