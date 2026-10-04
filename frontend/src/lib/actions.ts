import type { Translation, Language } from '../types/translation'
import type { ReviewIssue } from '../types/issue'
import { assertEditable, canFinalize, getDocument, logActivity, LIMITS, now, uid, type Workspace, type Evaluation, canSubmit } from './model'
import { analyzeDocument } from './rules'
import { termKey } from './terminology'
import { ensureProject } from './projects'
export type NewDocument = { title: string; domain: string; sourceLang: Language; targetLang: Language; pairs: { source: string; target: string; cue?: Translation['segments'][number]['cue'] }[]; contentType?: Translation['contentType']; subtitle?: Translation['subtitle'] }
export function createDocument(state: Workspace, input: NewDocument): string {
  if (state.translations.length >= LIMITS.documents) throw new Error(`문서는 최대 ${LIMITS.documents}개까지 보관할 수 있습니다. 먼저 백업 후 정리해 주세요.`)
  if (!input.title.trim() || input.title.length > 120) throw new Error('문서 제목은 1~120자로 입력해 주세요.')
  if (!input.pairs.length || input.pairs.length > LIMITS.segments) throw new Error(`문단은 1~${LIMITS.segments}개까지 등록할 수 있습니다.`)
  if (input.pairs.some(p => !p.source.trim() || p.source.length > LIMITS.text || p.target.length > LIMITS.text)) throw new Error(`원문은 비울 수 없으며, 문단별 원문·번역문은 각각 ${LIMITS.text.toLocaleString()}자 이하여야 합니다.`)
  if (input.domain.trim()) ensureProject(state, input.domain)
  const doc: Translation = { id: uid(), projectId: termKey(input.domain) || 'local', title: input.title.trim(), domain: input.domain.trim(), sourceLang: input.sourceLang, targetLang: input.targetLang, status: 'IN_REVIEW',
    segments: input.pairs.map(p => ({ id: uid(), sourceText: p.source, targetText: p.target, originalTargetText: p.target, revision: 1, reviewed: false, history: [], ...(p.cue ? { cue: structuredClone(p.cue) } : {}) })),
    issues: [], createdAt: now(), updatedAt: now(), ...(input.contentType ? { contentType: input.contentType } : {}), ...(input.subtitle ? { subtitle: structuredClone(input.subtitle) } : {}) }
  analyzeDocument(doc, state.glossary)
  state.translations.unshift(doc)
  logActivity(state, `“${doc.title}” 문서를 등록했습니다.`, doc.id)
  return doc.id
}
export function editSegment(state: Workspace, docId: string, segmentId: string, revision: number, text: string, label = '직접 수정') {
  const doc = getDocument(state, docId); assertEditable(doc)
  const segment = doc.segments.find(s => s.id === segmentId)
  if (!segment || segment.revision !== revision) throw new Error('문단 버전이 변경되었습니다. 현재 입력을 복사한 뒤 새로고침해 주세요.')
  if (text.length > LIMITS.text) throw new Error(`번역문은 ${LIMITS.text.toLocaleString()}자 이하여야 합니다.`)
  if (segment.targetText === text) return
  segment.history.push({ text: segment.targetText, at: now(), label })
  segment.history = segment.history.slice(-30)
  segment.targetText = text; segment.revision++; segment.reviewed = false
  doc.updatedAt = now(); doc.status = 'IN_REVIEW'
  analyzeDocument(doc, state.glossary)
  logActivity(state, `“${doc.title}” ${doc.segments.indexOf(segment) + 1}번 문단 · ${label}`, doc.id)
}
export function decideIssue(state: Workspace, docId: string, issueId: string, action: 'apply' | 'dismiss' | 'resolve' | 'reopen') {
  const doc = getDocument(state, docId); assertEditable(doc)
  const issue = doc.issues.find(i => i.id === issueId)
  if (!issue) throw new Error('이슈를 찾을 수 없습니다.')
  const segment = doc.segments.find(s => s.id === issue.segmentId)
  if (!segment) throw new Error('문단을 찾을 수 없습니다.')
  if (action === 'reopen') {
    if (issue.origin === 'rule' && issue.targetRevision !== segment.revision) throw new Error('이전 버전의 자동 검사입니다. 현재 문단을 다시 검사해 주세요.')
    issue.status = 'open'; segment.reviewed = false
  } else {
    if (issue.status !== 'open') throw new Error('이미 처리된 이슈입니다.')
    if (action === 'apply') {
      if (issue.targetRevision !== segment.revision) throw new Error('수정안이 이전 버전을 기준으로 합니다. 현재 번역을 직접 수정해 주세요.')
      if (issue.suggestedTargetText === undefined) throw new Error('자동 적용할 수정안이 없습니다.')
      const suggestion = issue.suggestedTargetText
      issue.status = 'applied'
      editSegment(state, docId, segment.id, segment.revision, suggestion, '수정안 적용')
    } else issue.status = action === 'dismiss' ? 'dismissed' : 'resolved'
  }
  doc.updatedAt = now()
  logActivity(state, `“${doc.title}” 이슈를 ${action === 'apply' ? '적용' : action === 'dismiss' ? '무시' : action === 'reopen' ? '다시 열기' : '해결 처리'}했습니다.`, doc.id)
}
export function markReviewed(state: Workspace, docId: string, segmentId: string, value: boolean) {
  const doc = getDocument(state, docId); assertEditable(doc)
  const segment = doc.segments.find(s => s.id === segmentId)
  if (!segment) throw new Error('문단을 찾을 수 없습니다.')
  if (value && !segment.targetText.trim()) throw new Error('빈 번역문은 확인 완료로 표시할 수 없습니다.')
  segment.reviewed = value; doc.updatedAt = now()
  logActivity(state, `“${doc.title}” ${doc.segments.indexOf(segment) + 1}번 문단 ${value ? '확인 완료' : '확인 취소'}`, doc.id)
}
export function finalizeDocument(state: Workspace, id: string) {
  const doc = getDocument(state, id); assertEditable(doc)
  const problem = canFinalize(doc); if (problem) throw new Error(problem)
  doc.status = 'FINALIZED'; doc.updatedAt = now()
  logActivity(state, `“${doc.title}” 검수를 완료했습니다.`, id)
}
export function addManualIssue(state: Workspace, docId: string, segmentId: string, input: Pick<ReviewIssue, 'type' | 'severity' | 'reason' | 'suggestedTargetText'>) {
  const doc = getDocument(state, docId); assertEditable(doc)
  const segment = doc.segments.find(s => s.id === segmentId)
  if (!segment || !input.reason.trim() || input.reason.length > 2000) throw new Error('이슈 사유를 1~2,000자로 입력해 주세요.')
  if ((input.suggestedTargetText?.length ?? 0) > LIMITS.text) throw new Error('수정안이 너무 깁니다.')
  if (doc.issues.filter(i => i.origin === 'manual').length >= 500) throw new Error('수동 이슈는 문서당 최대 500개입니다.')
  const id = uid()
  doc.issues.push({ ...input, id, segmentId, targetRevision: segment.revision, reason: input.reason.trim(), status: 'open', origin: 'manual', fingerprint: id, targetQuote: segment.targetText.slice(0, 240), createdAt: now() })
  segment.reviewed = false; doc.updatedAt = now()
  logActivity(state, `“${doc.title}”에 검수 이슈를 추가했습니다.`, docId)
}
export function saveEvaluation(state: Workspace, id: string, patch: Pick<Evaluation, 'ratings' | 'preference' | 'comment' | 'reviewer'>, submit: boolean) {
  const e = state.evaluations.find(v => v.id === id)
  if (!e || e.status === 'SUBMITTED') throw new Error('평가가 없거나 이미 제출되었습니다.')
  if (patch.comment.length > 3000 || patch.reviewer.length > 80) throw new Error('평가 의견 또는 평가자 이름이 너무 깁니다.')
  Object.assign(e, patch)
  if (submit) { const error = canSubmit(e); if (error) throw new Error(error); e.status = 'SUBMITTED'; e.submittedAt = now() }
  e.updatedAt = now()
  logActivity(state, `“${e.title}” 평가를 ${submit ? '제출' : '임시 저장'}했습니다.`)
}
