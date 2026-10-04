import type { Workspace } from './model'
import { openIssues, progress } from './model'

type ModelContext = {
  registerTool: (tool: {
    name: string
    title: string
    description: string
    inputSchema: object
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
    execute: (input: unknown) => unknown
  }, options: { signal: AbortSignal }) => void | Promise<void>
}

/** Read the same current workspace shown by the UI, without changing documents. */
export function registerWorkspaceTools(read: () => Workspace | null) {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
  if (!context?.registerTool) return
  const lifecycle = new AbortController()
  try {
    void Promise.resolve(context.registerTool({
      name: 'get_review_workspace_summary',
      title: '번역 검수 작업 현황 읽기',
      description: 'Read document titles, review progress, open issue counts, evaluation count and glossary count from this browser workspace. Does not modify or export data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('입력은 빈 객체여야 합니다.')
        const state = read()
        if (!state) throw new Error('작업 공간을 아직 읽지 못했습니다.')
        return {
          documents: state.translations.map(doc => ({ id: doc.id, title: doc.title, status: doc.status, progress: progress(doc), openIssues: openIssues(doc).length })),
          evaluationCount: state.evaluations.length,
          glossaryCount: state.glossary.length,
        }
      },
    }, { signal: lifecycle.signal })).catch(() => {})
  } catch { /* Optional browser capability; normal app use remains available. */ }
  return () => lifecycle.abort()
}
