import { emptyWorkspace, now, type Workspace } from './model'
import { validateWorkspace } from './validation'
import { hasLiteraryExamples, loadLiteraryExamples, LITERARY_SEED_ID } from './literaryDemo'
import { isRunActive } from './runLease'
const DB_NAME = 'ian-review-workspace-v1', STORE = 'workspace'
let database: Promise<IDBDatabase> | undefined
export class ConflictError extends Error { constructor() { super('다른 탭에서 데이터가 변경되었습니다. 현재 입력을 복사한 뒤 새로고침해 주세요. 기존 저장 데이터는 덮어쓰지 않았습니다.'); this.name = 'ConflictError' } }
function openDB(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('이 브라우저에서 저장소를 사용할 수 없습니다. 일반 모드의 최신 Chrome 또는 Edge에서 열어 주세요.')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error ?? new Error('저장소에 연결할 수 없습니다.'))
    request.onblocked = () => reject(new Error('다른 탭의 저장소 연결을 닫고 다시 시도해 주세요.'))
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined }; resolve(request.result) }
  }).catch(error => { database = undefined; throw error })
  return database
}
export async function loadWorkspace(): Promise<Workspace> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get('current')
    let result: Workspace, error: unknown
    request.onsuccess = () => { try { result = request.result ? validateWorkspace(request.result) : emptyWorkspace(); if (!request.result) store.put(result, 'current') } catch (e) { error = e; tx.abort() } }
    tx.oncomplete = () => resolve(result)
    tx.onerror = tx.onabort = () => reject(error ?? tx.error ?? new Error('저장 데이터를 읽지 못했습니다. 브라우저 저장소 권한을 확인해 주세요.'))
  })
}
/** Install this release's bundled test data once, in the same transaction as its marker. */
export async function initializeWorkspace(): Promise<{ state: Workspace; notice?: string }> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE)
    const marker = store.get(`installed:${LITERARY_SEED_ID}`)
    let result: Workspace, notice: string | undefined, error: unknown
    marker.onsuccess = () => {
      const current = store.get('current')
      current.onsuccess = () => {
        try {
          result = current.result ? validateWorkspace(current.result) : emptyWorkspace()
          let installed = !!marker.result
          if (!installed) {
            if (hasLiteraryExamples(result)) installed = true
            else {
              try {
                const next = structuredClone(result)
                loadLiteraryExamples(next)
                next.revision = result.revision + 1; next.updatedAt = now()
                result = validateWorkspace(next)
                installed = true
              } catch (e) {
                notice = `기존 작업을 유지했습니다. 작품 예제 자동 추가: ${e instanceof Error ? e.message : '추가하지 못했습니다. 데이터 관리에서 다시 시도해 주세요.'}`
              }
            }
            if (installed) store.put(true, `installed:${LITERARY_SEED_ID}`)
          }
          let recovered = false
          for (const doc of result.translations) if (doc.aiRun?.status === 'running' && !isRunActive(doc.aiRun.id)) { doc.aiRun.status = 'paused'; doc.aiRun.updatedAt = now(); recovered = true }
          for (const run of result.glossaryRuns ?? []) if (run.status === 'running' && !isRunActive(`glossary:${run.project.normalize('NFKC').trim().toLowerCase()}`)) { run.status = 'paused'; run.updatedAt = now(); recovered = true }
          const materialized = JSON.stringify(result.projects ?? []) !== JSON.stringify(current.result?.projects ?? [])
          if (recovered || (materialized && result.revision === current.result?.revision)) { result.revision++; result.updatedAt = now(); result = validateWorkspace(result) }
          if (!current.result || recovered || materialized || result.revision !== current.result.revision) store.put(result, 'current')
        } catch (e) { error = e; tx.abort() }
      }
    }
    tx.oncomplete = () => resolve({ state: result, ...(notice ? { notice } : {}) })
    tx.onerror = tx.onabort = () => reject(error ?? tx.error ?? new Error('작품 예제가 포함된 작업 공간을 열지 못했습니다.'))
  })
}
/** Read/compare/write happen in ONE IndexedDB transaction, preventing stale-tab overwrites. */
export async function commitWorkspace(expectedRevision: number, recipe: (draft: Workspace) => void, recovery = false): Promise<Workspace> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get('current')
    let next: Workspace, error: unknown
    request.onsuccess = () => {
      try {
        const previous: Workspace = request.result ?? emptyWorkspace()
        if (previous.revision !== expectedRevision) throw new ConflictError()
        next = structuredClone(previous); recipe(next)
        next.revision = previous.revision + 1; next.updatedAt = now()
        validateWorkspace(next)
        if (recovery) store.put(previous, 'recovery')
        store.put(next, 'current')
      } catch (e) { error = e; tx.abort() }
    }
    tx.oncomplete = () => resolve(next)
    tx.onerror = tx.onabort = () => reject(error ?? (tx.error?.name === 'QuotaExceededError' ? new Error('브라우저 저장 공간이 부족합니다. 기존 데이터는 유지됩니다. 백업 후 불필요한 문서를 정리해 주세요.') : tx.error) ?? new Error('저장하지 못했습니다. 입력을 복사해 두고 다시 시도해 주세요.'))
  })
}
export async function readRecovery(): Promise<Workspace | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => { const r = db.transaction(STORE).objectStore(STORE).get('recovery'); r.onsuccess = () => { try { resolve(r.result ? validateWorkspace(r.result) : null) } catch (e) { reject(e) } }; r.onerror = () => reject(r.error) })
}
