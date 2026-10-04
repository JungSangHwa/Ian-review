import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useWorkspace } from './WorkspaceContext'
import { cancelAITranslation, processAITranslation, resumeAITranslation, startAITranslation, stopAITranslation } from '../lib/aiTranslation'
import { processProjectGlossary, projectGlossaryProgress } from '../lib/projectGlossary'
import { getDocument, type Workspace } from '../lib/model'
import { sameProject } from '../lib/projects'
import { acquireRun, isRunActive } from '../lib/runLease'

type Kind = 'translation' | 'glossary'
type Phase = 'preparing' | 'extract' | 'verify' | 'translation' | 'validation' | 'saving' | 'stopping' | 'completed' | 'paused' | 'failed'
export type AIJobView = { kind: Kind; stage: Kind; project: string; docId?: string; phase: Phase; done: number; total: number; error?: string }
type Context = { job: AIJobView | null; startTranslation: (docId: string, mode: 'empty' | 'all' | 'resume') => Promise<void>; startGlossary: (project: string) => Promise<void>; pause: () => void; cancelTranslation: (docId: string) => Promise<void>; cancelGlossary: (project: string) => Promise<void> }
const AIJobsContext = createContext<Context | null>(null)
// eslint-disable-next-line react-refresh/only-export-components
export function useAIJobs() { const value = useContext(AIJobsContext); if (!value) throw new Error('AIJobsProvider가 필요합니다.'); return value }

export function AIJobsProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace(), workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const [job, setJob] = useState<AIJobView | null>(null)
  const active = useRef<{ controller: AbortController; kind: Kind; project: string; docId?: string } | null>(null)
  const cancelAfter = useRef(false)
  const update = (patch: Partial<AIJobView>) => setJob(current => current ? { ...current, ...patch } : current)
  const commit = async (recipe: (state: Workspace) => void) => workspaceRef.current.run(recipe, '')
  const read = () => workspaceRef.current.read()
  const launch = async (initial: AIJobView, work: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) { workspaceRef.current.notify('이미 실행 중인 로컬 모델 작업이 있습니다. 사이드바에서 작업을 확인해 주세요.', 'info'); return }
    let releaseGlobal: () => void
    try { releaseGlobal = acquireRun('model-global') } catch (error) { workspaceRef.current.notify(error instanceof Error ? error.message : '다른 탭에서 모델이 실행 중입니다.', 'error'); return }
    const controller = new AbortController()
    active.current = { controller, kind: initial.kind, project: initial.project, docId: initial.docId }
    cancelAfter.current = false
    setJob(initial)
    try {
      await work(controller.signal)
      update({ phase: controller.signal.aborted ? 'paused' : 'completed' })
      workspaceRef.current.notify(controller.signal.aborted ? '작업을 일시 중지했습니다. 저장된 결과는 유지됩니다.' : '모델 작업을 완료했습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '모델 작업을 완료하지 못했습니다.'
      update({ phase: controller.signal.aborted ? 'paused' : 'failed', error: controller.signal.aborted ? undefined : message })
      workspaceRef.current.notify(controller.signal.aborted ? '작업을 일시 중지했습니다. 저장된 결과는 유지됩니다.' : message, controller.signal.aborted ? 'info' : 'error')
    } finally {
      if (cancelAfter.current) {
        if (initial.kind === 'translation' && initial.docId) {
          const runId = read().translations.find(d => d.id === initial.docId)?.aiRun?.id
          if (runId) await commit(state => cancelAITranslation(state, initial.docId!, runId))
        } else await commit(state => { state.glossaryRuns = (state.glossaryRuns ?? []).filter(run => !sameProject(run.project, initial.project)) })
        setJob(null)
      }
      active.current = null; cancelAfter.current = false
      releaseGlobal()
    }
  }
  const startTranslation = async (docId: string, mode: 'empty' | 'all' | 'resume') => {
    if (active.current) { workspaceRef.current.notify('이미 실행 중인 로컬 모델 작업이 있습니다.', 'info'); return }
    const doc = read().translations.find(d => d.id === docId)
    if (!doc) { workspaceRef.current.notify('문서를 찾을 수 없습니다.', 'error'); return }
    const config = read().aiProjects?.find(c => sameProject(c.project, doc.domain))
    if (!config || config.provider !== 'local') { workspaceRef.current.notify('이 작품의 로컬 Ollama 모델을 먼저 저장해 주세요.', 'error'); return }
    const selected = mode === 'resume' ? doc.segments.filter(s => doc.aiRun?.pendingIds.includes(s.id)) : mode === 'empty' ? doc.segments.filter(s => !s.targetText.trim()) : doc.segments
    if (selected.some(s => s.sourceText.length > 12000)) { workspaceRef.current.notify('12,000자를 넘는 원문 구간이 있습니다. 웹소설은 문단을 나누거나 수동으로 번역해 주세요. 자막 시간 구간은 자동 분할하지 않습니다.', 'error'); return }
    if (mode === 'resume' && doc.aiRun?.status === 'running' && isRunActive(doc.aiRun.id)) { workspaceRef.current.notify('다른 탭에서 이 작업을 실행 중입니다.', 'error'); return }
    const glossary = projectGlossaryProgress(read(), doc.domain)
    await launch({ kind: 'translation', stage: glossary.ready ? 'translation' : 'glossary', project: doc.domain, docId, phase: 'preparing', done: glossary.ready ? mode === 'resume' ? doc.aiRun?.completed ?? 0 : 0 : glossary.completed, total: glossary.ready ? mode === 'resume' ? doc.aiRun?.total ?? selected.length : selected.length : glossary.total }, async signal => {
      if (!projectGlossaryProgress(read(), doc.domain).ready) {
        await processProjectGlossary({ project: doc.domain, read, commit, apiKey: '', signal,
          onProgress: (done, total) => update({ done, total }), onPhase: phase => update({ phase }),
        })
      }
      signal.throwIfAborted()
      const saved = await commit(state => {
        if (mode === 'resume') { const run = getDocument(state, docId).aiRun; if (run?.status === 'running' && !isRunActive(run.id)) stopAITranslation(state, docId, run.id); resumeAITranslation(state, docId) }
        else startAITranslation(state, docId, mode)
      })
      if (!saved) throw new Error('번역 작업 상태를 저장하지 못했습니다.')
      const run = getDocument(read(), docId).aiRun!
      update({ stage: 'translation', done: run.completed, total: run.total, phase: 'translation' })
      await processAITranslation({ docId, read, commit, apiKey: '', signal, onPhase: phase => update({ phase }), onProgress: (done, total) => update({ done, total }) })
      const finished = getDocument(read(), docId).aiRun
      if (finished) update({ done: finished.completed, total: finished.total })
    })
  }
  const startGlossary = async (project: string) => {
    if (active.current) { workspaceRef.current.notify('이미 실행 중인 로컬 모델 작업이 있습니다.', 'info'); return }
    const progress = projectGlossaryProgress(read(), project)
    const config = read().aiProjects?.find(c => sameProject(c.project, project))
    if (!config || config.provider !== 'local') { workspaceRef.current.notify('로컬 Ollama 모델을 먼저 저장해 주세요.', 'error'); return }
    await launch({ kind: 'glossary', stage: 'glossary', project, phase: 'preparing', done: progress.completed, total: progress.total }, async signal => {
      await processProjectGlossary({ project, read, commit, apiKey: '', signal,
        onProgress: (done, total) => update({ done, total }), onPhase: phase => update({ phase }),
      })
    })
  }
  const pause = () => { if (active.current) { update({ phase: 'stopping' }); active.current.controller.abort() } }
  const cancelTranslation = async (docId: string) => {
    if (active.current?.docId === docId) { cancelAfter.current = true; pause(); return }
    const run = read().translations.find(d => d.id === docId)?.aiRun
    if (!run) return
    if (run.status === 'running' && isRunActive(run.id)) { workspaceRef.current.notify('다른 탭에서 이 작업을 실행 중입니다.', 'error'); return }
    if (await commit(state => cancelAITranslation(state, docId, run.id))) { setJob(null); workspaceRef.current.notify('번역 작업을 취소했습니다. 저장된 번역문은 유지됩니다.') }
  }
  const cancelGlossary = async (project: string) => {
    if (active.current?.kind === 'glossary' && sameProject(active.current.project, project)) { cancelAfter.current = true; pause(); return }
    if (await commit(state => { state.glossaryRuns = (state.glossaryRuns ?? []).filter(run => !sameProject(run.project, project)) })) { setJob(null); workspaceRef.current.notify('용어집 작업을 취소했습니다. 저장된 용어는 유지됩니다.') }
  }
  return <AIJobsContext.Provider value={{ job, startTranslation, startGlossary, pause, cancelTranslation, cancelGlossary }}>{children}</AIJobsContext.Provider>
}
