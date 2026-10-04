import { parseTiming } from './subtitles'
import { canFinalize, canSubmit, LANGUAGES, LIMITS, type Workspace } from './model'
import { AI_PROVIDERS } from './aiTypes'
function fail(path: string): never { throw new Error(`백업 데이터 형식이 올바르지 않습니다: ${path}`) }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Record<string, unknown>
}
function array(value: unknown, path: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) fail(path); return value }
function string(v: unknown, p: string, max: number, required = false) { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(p) }
function integer(v: unknown, p: string, min = 0, max = Number.MAX_SAFE_INTEGER) { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail(p) }
function choice(v: unknown, p: string, allowed: readonly unknown[]) { if (!allowed.includes(v)) fail(p) }
function date(v: unknown, p: string) { string(v, p, 40, true); if (!/^\d{4}-\d{2}-\d{2}T/.test(v as string) || !Number.isFinite(Date.parse(v as string))) fail(p) }
function id(v: unknown, p: string) { string(v, p, 100, true); if (!/^[a-zA-Z0-9_-]+$/.test(v as string)) fail(p) }
function optionalString(v: unknown, p: string, max: number) { if (v !== undefined) string(v, p, max) }
function ids(items: unknown[], p: string) {
  const set = new Set<string>()
  for (const item of items) { const o = object(item, p); id(o.id, `${p}.id`); if (set.has(o.id as string)) fail(`${p} 중복 ID`); set.add(o.id as string) }
  return set
}
function aiOrigin(value: unknown) {
  const o=object(value,'aiOrigin');choice(o.provider,'aiOrigin.provider',Object.keys(AI_PROVIDERS));string(o.model,'aiOrigin.model',200,true);id(o.documentId,'aiOrigin.documentId');id(o.segmentId,'aiOrigin.segmentId');string(o.quote,'aiOrigin.quote',1000,true);date(o.createdAt,'aiOrigin.createdAt')
}
export function parseBackup(text: string): Workspace {
  if (new TextEncoder().encode(text).length > LIMITS.fileBytes) throw new Error('백업 파일은 10MB 이하여야 합니다.')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('JSON 파일을 읽을 수 없습니다. 원본 백업 파일인지 확인해 주세요.') }
  const root = object(raw, '파일')
  if (root.format !== 'ian-review-workspace' || root.version !== 1) throw new Error('지원하지 않는 백업 형식입니다. Ian v1 JSON 백업을 선택해 주세요.')
  return validateWorkspace(root.data)
}
export function validateWorkspace(raw: unknown): Workspace {
  const s = object(raw, 'workspace'); choice(s.schemaVersion, 'schemaVersion', [1]); integer(s.revision, 'revision'); date(s.updatedAt, 'updatedAt')
  if (s.projects !== undefined) { const names = array(s.projects, 'projects', LIMITS.documents), seen = new Set<string>(); for (const name of names) { string(name, 'project.name', 80, true); const key = (name as string).normalize('NFKC').trim().toLowerCase(); if (seen.has(key)) fail('중복 프로젝트'); seen.add(key) } }
  const languages = Object.keys(LANGUAGES)
  const docs = array(s.translations, 'translations', LIMITS.documents); ids(docs, 'documents')
  for (const item of docs) {
    const d = object(item, 'document')
    string(d.projectId, 'projectId', 100, true); string(d.title, 'title', 120, true); string(d.domain, 'domain', 80)
    choice(d.sourceLang, 'sourceLang', languages); choice(d.targetLang, 'targetLang', languages)
    choice(d.status, 'status', ['DRAFT', 'IN_REVIEW', 'FINALIZED']); date(d.createdAt, 'createdAt'); date(d.updatedAt, 'updatedAt')
    if (d.contentType !== undefined) choice(d.contentType, 'contentType', ['novel', 'subtitle'])
    if (d.subtitle !== undefined) { const meta = object(d.subtitle, 'subtitle'); choice(meta.format, 'subtitle.format', ['srt', 'vtt']); optionalString(meta.header, 'subtitle.header', 2000); if (meta.trailing !== undefined) for (const block of array(meta.trailing, 'subtitle.trailing', 100)) string(block, 'subtitle.block', 20000) }
    if (d.isDemo !== undefined && typeof d.isDemo !== 'boolean') fail('isDemo')
    const segments = array(d.segments, 'segments', LIMITS.segments); if (!segments.length) fail('문단 수')
    const segmentIds = ids(segments, 'segments')
    if (d.aiRun !== undefined) {
      const run=object(d.aiRun,'aiRun');id(run.id,'aiRun.id');choice(run.provider,'aiRun.provider',Object.keys(AI_PROVIDERS));string(run.model,'aiRun.model',200,true);choice(run.status,'aiRun.status',['running','paused','failed','completed']);date(run.updatedAt,'aiRun.updatedAt');optionalString(run.error,'aiRun.error',500)
      integer(run.total,'aiRun.total',1,LIMITS.segments);integer(run.completed,'aiRun.completed',0,run.total as number);integer(run.addedTerms,'aiRun.addedTerms',0,1000);integer(run.conflicts,'aiRun.conflicts',0,1000)
      const pending=array(run.pendingIds,'aiRun.pendingIds',LIMITS.segments);if(new Set(pending).size!==pending.length||pending.some(id=>!segmentIds.has(id as string))||pending.length+(run.completed as number)!==run.total||(run.status==='completed'&&pending.length))fail('aiRun.pendingIds')
    }
    const revisions = new Map<string, number>()
    for (const item of segments) {
      const segment = object(item, 'segment')
      string(segment.sourceText, 'sourceText', LIMITS.text, true); string(segment.targetText, 'targetText', LIMITS.text); string(segment.originalTargetText, 'originalTargetText', LIMITS.text)
      if (segment.cue !== undefined) { const cue = object(segment.cue, 'cue'); string(cue.timing, 'cue.timing', 500, true); optionalString(cue.identifier, 'cue.identifier', 500); if (!d.subtitle) fail('subtitle'); parseTiming(cue.timing as string, (d.subtitle as { format: 'srt' | 'vtt' }).format); if (cue.prefix !== undefined) for (const block of array(cue.prefix, 'cue.prefix', 100)) string(block, 'cue.block', 20000) }
      if (d.subtitle && !segment.cue) fail('cue');
      integer(segment.revision, 'segment.revision', 1); revisions.set(segment.id as string, segment.revision as number)
      if (typeof segment.reviewed !== 'boolean' || (segment.reviewed && !(segment.targetText as string).trim())) fail('reviewed')
      for (const v of array(segment.history, 'history', 30)) { const h = object(v, 'history'); string(h.text, 'history.text', LIMITS.text); string(h.label, 'history.label', 100); date(h.at, 'history.at') }
    }
    const issues = array(d.issues, 'issues', 6000); ids(issues, 'issues')
    for (const item of issues) {
      const i = object(item, 'issue')
      if (!segmentIds.has(i.segmentId as string)) fail('issue.segmentId')
      integer(i.targetRevision, 'targetRevision', 1, revisions.get(i.segmentId as string))
      choice(i.severity, 'severity', ['error', 'warning', 'info']); choice(i.status, 'issue.status', ['open', 'applied', 'dismissed', 'resolved']); choice(i.origin, 'origin', ['rule', 'manual'])
      string(i.type, 'type', 100, true); string(i.reason, 'reason', 5000, true); string(i.fingerprint, 'fingerprint', 60000, true); date(i.createdAt, 'issue.createdAt')
      if (i.termId !== undefined) id(i.termId, 'termId')
      optionalString(i.sourceQuote, 'sourceQuote', LIMITS.text); optionalString(i.targetQuote, 'targetQuote', LIMITS.text); optionalString(i.suggestedTargetText, 'suggestedTargetText', LIMITS.text)
    }
    if (d.status === 'FINALIZED' && canFinalize(d as unknown as Workspace['translations'][0])) fail('완료 문서의 검수 상태')
  }
  const terms = array(s.glossary, 'glossary', LIMITS.glossary); ids(terms, 'glossary')
  const termKeys = new Set<string>()
  for (const item of terms) {
    const t = object(item, 'term'); string(t.source, 'term.source', 100, true); string(t.target, 'term.target', 100, true)
    choice(t.sourceLang, 'term.sourceLang', languages); choice(t.targetLang, 'term.targetLang', languages); choice(t.severity, 'term.severity', ['info', 'warning', 'error'])
    optionalString(t.project, 'term.project', 80); optionalString(t.note, 'term.note', 1000)
    if(t.reviewStatus!==undefined)choice(t.reviewStatus,'term.reviewStatus',['draft','approved'])
    if(t.aiOrigin!==undefined)aiOrigin(t.aiOrigin)
    if (t.category !== undefined) choice(t.category, 'term.category', ['character', 'place', 'title', 'term', 'phrase'])
    for (const field of ['aliases', 'variants']) if (t[field] !== undefined) for (const value of array(t[field], `term.${field}`, 30)) string(value, `term.${field}`, 100, true)
    const key = `${typeof t.project === 'string' ? t.project.normalize('NFKC').trim().toLowerCase() : ''}:${t.sourceLang}:${t.targetLang}:${(t.source as string).normalize('NFKC').toLowerCase()}`
    if (termKeys.has(key)) fail('중복 용어'); termKeys.add(key)
  }
  if(s.aiProjects!==undefined){
    const configs=array(s.aiProjects,'aiProjects',LIMITS.documents),projects=new Set<string>()
    for(const value of configs){const config=object(value,'aiProject');if(Object.keys(config).some(k=>!['project','provider','model','instructions','batchChars'].includes(k)))fail('모델 설정의 알 수 없는 필드 또는 인증 정보');string(config.project,'aiProject.project',80,true);choice(config.provider,'aiProject.provider',Object.keys(AI_PROVIDERS));string(config.model,'aiProject.model',200,true);if(!/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/.test(config.model as string))fail('aiProject.model');string(config.instructions,'aiProject.instructions',3000);choice(config.batchChars,'aiProject.batchChars',[2000,4000,6000]);const key=(config.project as string).normalize('NFKC').trim().toLowerCase();if(projects.has(key))fail('중복 모델 설정');projects.add(key)}
  }
  if(s.termSuggestions!==undefined){
    const suggestions=array(s.termSuggestions,'termSuggestions',1000);ids(suggestions,'termSuggestions');for(const value of suggestions){const item=object(value,'termSuggestion');id(item.termId,'suggestion.termId');string(item.project,'suggestion.project',80,true);string(item.source,'suggestion.source',100,true);string(item.target,'suggestion.target',100,true);string(item.note,'suggestion.note',1000);choice(item.status,'suggestion.status',['pending','accepted','dismissed']);aiOrigin(item.origin)}
  }
  if (s.glossaryRuns !== undefined) {
    const runs = array(s.glossaryRuns, 'glossaryRuns', LIMITS.documents), projects = new Set<string>()
    for (const value of runs) {
      const run = object(value, 'glossaryRun')
      string(run.project, 'glossaryRun.project', 80, true)
      const key = (run.project as string).normalize('NFKC').trim().toLowerCase()
      if (projects.has(key)) fail('중복 glossaryRun'); projects.add(key)
      choice(run.status, 'glossaryRun.status', ['running', 'paused', 'failed', 'completed'])
      date(run.updatedAt, 'glossaryRun.updatedAt')
      if (run.completedAt !== undefined) date(run.completedAt, 'glossaryRun.completedAt')
      optionalString(run.error, 'glossaryRun.error', 500)
      const fingerprints = array(run.completedFingerprints, 'glossaryRun.completedFingerprints', 5000)
      if (new Set(fingerprints).size !== fingerprints.length || fingerprints.some(value => typeof value !== 'string' || !/^[0-9a-f]{16}$/.test(value))) fail('glossaryRun.completedFingerprints')
    }
  }
  const evaluations = array(s.evaluations, 'evaluations', LIMITS.evaluations); ids(evaluations, 'evaluations')
  for (const item of evaluations) {
    const e = object(item, 'evaluation'); optionalString(e.project, 'evaluation.project', 80); string(e.title, 'evaluation.title', 120, true); string(e.sourceText, 'evaluation.sourceText', 100000, true)
    choice(e.sourceLang, 'evaluation.sourceLang', languages); choice(e.targetLang, 'evaluation.targetLang', languages)
    const c = array(e.candidates, 'candidates', 2); if (c.length !== 2) fail('candidates')
    for (const item of c) { const candidate = object(item, 'candidate'); string(candidate.label, 'candidate.label', 80, true); string(candidate.text, 'candidate.text', 100000, true) }
    const ratings = array(e.ratings, 'ratings', 2); if (ratings.length !== 2) fail('ratings')
    for (const item of ratings) { const r = object(item, 'rating'); for (const k of ['accuracy', 'fluency', 'terminology']) integer(r[k], `rating.${k}`, 0, 5) }
    choice(e.preference, 'preference', ['', 'A', 'B', 'tie', 'abstain']); choice(e.status, 'evaluation.status', ['DRAFT', 'SUBMITTED'])
    string(e.comment, 'comment', 3000); string(e.reviewer, 'reviewer', 80); date(e.createdAt, 'evaluation.createdAt'); date(e.updatedAt, 'evaluation.updatedAt')
    if (e.isDemo !== undefined && typeof e.isDemo !== 'boolean') fail('evaluation.isDemo')
    if (e.submittedAt !== undefined) date(e.submittedAt, 'submittedAt')
    if (e.status === 'SUBMITTED' && (canSubmit(e as unknown as Workspace['evaluations'][0]) || !e.submittedAt)) fail('제출된 평가의 점수')
  }
  const activity = array(s.activity, 'activity', 300); ids(activity, 'activity')
  for (const item of activity) { const a = object(item, 'activity'); string(a.message, 'activity.message', 500, true); date(a.at, 'activity.at'); if (a.documentId !== undefined) id(a.documentId, 'activity.documentId') }
  if (new TextEncoder().encode(JSON.stringify(s)).length > 8 * 1024 * 1024) throw new Error('작업 공간의 8MB 보관 한도에 도달했습니다. 전체 JSON 백업 후 불필요한 문서를 정리해 주세요.')
  const result = structuredClone(s) as unknown as Workspace
  // Older backups derived projects from their contents. Materialize those names so
  // deleting the last linked document cannot silently delete the project.
  const names = [...(result.projects ?? []), ...result.translations.map(d => d.domain), ...result.glossary.map(t => t.project ?? ''), ...(result.aiProjects ?? []).map(c => c.project), ...result.evaluations.map(e => e.project ?? ''), ...(result.termSuggestions ?? []).map(t => t.project), ...(result.glossaryRuns ?? []).map(r => r.project)]
  const seen = new Set<string>()
  result.projects = names.map(name => name.trim()).filter(name => { const key = name.normalize('NFKC').toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true })
  return result
}
