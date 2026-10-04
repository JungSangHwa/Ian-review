import type { Language, Translation } from '../types/translation'
import type { IssueSeverity } from '../types/issue'
export const LANGUAGES: Record<Language, string> = { en: '영어', ko: '한국어', ja: '일본어', zh: '중국어', de: '독일어', fr: '프랑스어', es: '스페인어' }
export const STATUS = { DRAFT: '초안', IN_REVIEW: '검수 중', FINALIZED: '검수 완료' }
export const SEVERITY = { error: '중요', warning: '확인 필요', info: '참고' }
export const CRITERIA = { accuracy: '정확성', fluency: '자연스러움', terminology: '용어 일관성' }
export type Criterion = keyof typeof CRITERIA
export type Ratings = Record<Criterion, number>
export type Candidate = { label: string; text: string }
export type Evaluation = {
  id: string; project?: string; title: string; sourceText: string; sourceLang: Language; targetLang: Language
  candidates: [Candidate, Candidate]; ratings: [Ratings, Ratings]
  preference: '' | 'A' | 'B' | 'tie' | 'abstain'; comment: string; reviewer: string
  status: 'DRAFT' | 'SUBMITTED'; createdAt: string; updatedAt: string; submittedAt?: string; isDemo?: boolean
}
export type GlossaryEntry = { id: string; source: string; target: string; sourceLang: Language; targetLang: Language; severity: IssueSeverity; project?: string; category?: 'character' | 'place' | 'title' | 'term' | 'phrase'; aliases?: string[]; variants?: string[]; note?: string; reviewStatus?: 'draft' | 'approved'; aiOrigin?: import('./aiTypes').AITermOrigin }
export const TERM_CATEGORIES = { character: '인물명', place: '지명·조직', title: '호칭', term: '설정·전문어', phrase: '반복 표현' }
export type Activity = { id: string; at: string; message: string; documentId?: string }
export type ProjectGlossaryRun = { project: string; completedFingerprints: string[]; status: 'running' | 'paused' | 'failed' | 'completed'; updatedAt: string; completedAt?: string; error?: string }
export type Workspace = {
  schemaVersion: 1; revision: number; updatedAt: string
  translations: Translation[]; evaluations: Evaluation[]; glossary: GlossaryEntry[]; activity: Activity[]
  projects?: string[]
  aiProjects?: import('./aiTypes').ProjectAIConfig[]
  termSuggestions?: import('./aiTypes').AITermSuggestion[]
  glossaryRuns?: ProjectGlossaryRun[]
}
export const LIMITS = { documents: 200, segments: 500, text: 20000, evaluations: 200, glossary: 1000, fileBytes: 10 * 1024 * 1024 }
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const emptyRatings = (): Ratings => ({ accuracy: 0, fluency: 0, terminology: 0 })
export const emptyWorkspace = (): Workspace => ({ schemaVersion: 1, revision: 0, updatedAt: now(), translations: [], evaluations: [], glossary: [], activity: [], projects: [] })
export const openIssues = (doc: Translation) => doc.issues.filter(i => i.status === 'open')
export const progress = (doc: Translation) => Math.round(doc.segments.filter(s => s.reviewed).length / Math.max(doc.segments.length, 1) * 100)
export function logActivity(state: Workspace, message: string, documentId?: string) {
  state.activity.unshift({ id: uid(), at: now(), message, ...(documentId ? { documentId } : {}) })
  state.activity = state.activity.slice(0, 300)
}
export function getDocument(state: Workspace, id: string) {
  const doc = state.translations.find(d => d.id === id)
  if (!doc) throw new Error('문서를 찾을 수 없습니다. 문서 목록을 확인해 주세요.')
  return doc
}
export function assertEditable(doc: Translation) {
  if (doc.status === 'FINALIZED') throw new Error('완료된 문서입니다. 검수를 다시 열어 주세요.')
}
export function canFinalize(doc: Translation): string | null {
  if (!doc.segments.length) return '검수할 문단이 없습니다.'
  if (doc.segments.some(s => !s.targetText.trim())) return '빈 번역문을 먼저 작성해 주세요.'
  if (openIssues(doc).length) return `미처리 이슈 ${openIssues(doc).length}개를 해결하거나 무시해 주세요.`
  if (doc.segments.some(s => !s.reviewed)) return '모든 문단을 확인 완료로 표시해 주세요.'
  return null
}
export function canSubmit(e: Evaluation): string | null {
  if (e.ratings.some(r => Object.values(r).some(v => !Number.isInteger(v) || v < 1 || v > 5))) return 'A와 B의 평가 항목 6개에 모두 점수를 선택해 주세요.'
  if (!e.preference) return '최종 선호도를 선택해 주세요.'
  return null
}
export const average = (r: Ratings) => ((r.accuracy + r.fluency + r.terminology) / 3).toFixed(1)
export function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value))
}
export function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`
  return formatDate(value)
}
