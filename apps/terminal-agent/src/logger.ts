function ts(): string {
  return new Date().toISOString()
}

export function log(msg: string): void {
  process.stdout.write(`[${ts()}] INFO  ${msg}\n`)
}

export function warn(msg: string): void {
  process.stdout.write(`[${ts()}] WARN  ${msg}\n`)
}

export function err(msg: string): void {
  process.stderr.write(`[${ts()}] ERROR ${msg}\n`)
}

export function section(title: string): void {
  process.stdout.write(`\n${'─'.repeat(56)}\n  ${title}\n${'─'.repeat(56)}\n`)
}
