import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { commitWorkspace, ConflictError, initializeWorkspace, loadWorkspace } from '../lib/database'
import type { Workspace } from '../lib/model'
import Icon from '../components/Icon'
import { registerWorkspaceTools } from '../lib/webmcp'
type Notice = { id: number; message: string; kind: 'success' | 'error' | 'info' }
type Context = { state: Workspace; read: () => Workspace; busy: boolean; stale: boolean; notify: (message: string, kind?: Notice['kind']) => void; run: (recipe: (draft: Workspace) => void, message?: string, recovery?: boolean) => Promise<boolean> }
const WorkspaceContext = createContext<Context | null>(null)
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() { const ctx = useContext(WorkspaceContext); if (!ctx) throw new Error('WorkspaceProvider가 필요합니다.'); return ctx }
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Workspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [stale, setStale] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const stateRef = useRef(state); stateRef.current = state
  useEffect(() => registerWorkspaceTools(() => stateRef.current), [])
  const writing = useRef(false), channel = useRef<BroadcastChannel | null>(null), timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const notify = useCallback((message: string, kind: Notice['kind'] = 'success') => {
    const id = Date.now() + Math.random(); setNotices(n => [...n.slice(-3), { id, message, kind }])
    timers.current.push(setTimeout(() => setNotices(n => n.filter(v => v.id !== id)), kind === 'error' ? 10000 : 4500))
  }, [])
  useEffect(() => {
    let mounted = true
    const pendingTimers = timers.current
    initializeWorkspace().then(({ state: v, notice }) => { if (mounted) { stateRef.current = v; setState(v); if (notice) notify(notice, 'info') } }).catch(e => { if (mounted) setError(e instanceof Error ? e.message : '저장소를 읽을 수 없습니다.') })
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('ian-review-changes')
      channel.current.onmessage = event => { if (typeof event.data?.revision === 'number' && event.data.revision > (stateRef.current?.revision ?? 0)) setStale(true) }
    }
    const check = () => { if (stateRef.current && !writing.current) loadWorkspace().then(v => { if (mounted && v.revision !== stateRef.current?.revision) setStale(true) }).catch(() => {}) }
    window.addEventListener('focus', check)
    return () => { mounted = false; channel.current?.close(); window.removeEventListener('focus', check); pendingTimers.forEach(clearTimeout) }
  }, [notify])
  const run = useCallback(async (recipe: (draft: Workspace) => void, message = '저장했습니다.', recovery = false) => {
    if (writing.current || !stateRef.current) return false
    writing.current = true; setBusy(true)
    try {
      const next = await commitWorkspace(stateRef.current.revision, recipe, recovery)
      stateRef.current = next; setState(next); setStale(false); channel.current?.postMessage({ revision: next.revision })
      if (message) notify(message)
      return true
    } catch (e) { if (e instanceof ConflictError) setStale(true); notify(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도해 주세요.', 'error'); return false }
    finally { writing.current = false; setBusy(false) }
  }, [notify])
  if (error) return <div className="boot-state"><div className="boot-icon"><Icon name="alert" size={30} /></div><h1>저장소를 열 수 없습니다</h1><p>{error}</p><p>데이터를 임의로 초기화하지 않았습니다. 시크릿 모드·저장소 권한을 확인해 주세요.</p><button className="button" onClick={() => location.reload()}>다시 시도</button></div>
  if (!state) return <div className="boot-state" role="status"><div className="spinner" /><h2>작업 공간을 열고 있습니다</h2><p>이 브라우저에 저장된 문서를 확인합니다.</p></div>
  return <WorkspaceContext.Provider value={{ state, read: () => stateRef.current!, busy, stale, run, notify }}>{children}<div className="toast-stack" aria-live="polite" aria-atomic="false">{notices.map(n => <div className={`toast ${n.kind}`} key={n.id} role={n.kind === 'error' ? 'alert' : 'status'}><Icon name={n.kind === 'success' ? 'check' : n.kind === 'error' ? 'alert' : 'help'} /><span>{n.message}</span><button aria-label="알림 닫기" onClick={() => setNotices(v => v.filter(i => i.id !== n.id))}><Icon name="close" size={16} /></button></div>)}</div></WorkspaceContext.Provider>
}
