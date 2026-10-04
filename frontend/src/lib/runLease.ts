// A short browser lease distinguishes a live task in another tab from a task
// left in `running` after a tab or process was closed.
const owner = crypto.randomUUID()
const prefix = 'ian-review-ai-run:'
const ttl = 7000
const active = new Set<string>()
type Lease = { owner: string; expires: number }

function read(runId: string): Lease | null {
  try {
    const value = localStorage.getItem(prefix + runId)
    if (!value) return null
    const lease = JSON.parse(value) as Lease
    return typeof lease.owner === 'string' && Number.isFinite(lease.expires) ? lease : null
  } catch { return null }
}

export function isRunActive(runId: string) {
  const lease = read(runId)
  return !!lease && lease.expires > Date.now()
}

export function acquireRun(runId: string) {
  if (active.has(runId)) throw new Error('이 작업은 이미 이 탭에서 실행 중입니다.')
  const lease = read(runId)
  if (lease && lease.expires > Date.now() && lease.owner !== owner) throw new Error('다른 탭에서 이 번역 작업을 실행 중입니다.')
  const renew = () => { try { localStorage.setItem(prefix + runId, JSON.stringify({ owner, expires: Date.now() + ttl })) } catch { /* Private storage may be unavailable. */ } }
  renew()
  active.add(runId)
  const timer = typeof localStorage === 'undefined' ? undefined : setInterval(renew, 2000)
  return () => {
    active.delete(runId)
    if (timer) clearInterval(timer)
    if (read(runId)?.owner === owner) { try { localStorage.removeItem(prefix + runId) } catch { /* no storage */ } }
  }
}
