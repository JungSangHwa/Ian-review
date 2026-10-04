import { LANGUAGES, LIMITS, TERM_CATEGORIES, now, uid, type GlossaryEntry, type Workspace } from './model'
import { analyzeDocument } from './rules'
import { parseCSV } from './files'
import { termKey } from './terminology'
export const glossaryIdentity = (t: Pick<GlossaryEntry, 'source' | 'project' | 'sourceLang' | 'targetLang'>) => `${termKey(t.project ?? '')}:${t.sourceLang}:${t.targetLang}:${termKey(t.source)}`
export function refreshGlossaryDocuments(state: Workspace) {
  for (const doc of state.translations.filter(d => d.status !== 'FINALIZED')) {
    const previous = new Set(doc.issues.map(i => i.id)), before = JSON.stringify(doc.issues)
    analyzeDocument(doc, state.glossary)
    for (const issue of doc.issues.filter(i => i.status === 'open' && !previous.has(i.id))) {
      const segment = doc.segments.find(s => s.id === issue.segmentId); if (segment) segment.reviewed = false
    }
    if (before !== JSON.stringify(doc.issues)) doc.updatedAt = now()
  }
}
export function putGlossaryTerm(state: Workspace, term: GlossaryEntry, refresh = true) {
  if (!term.source.trim() || !term.target.trim()) throw new Error('원어와 기준 번역을 입력해 주세요.')
  if (state.glossary.some(t => t.id !== term.id && glossaryIdentity(t) === glossaryIdentity(term))) throw new Error('같은 작품과 언어 쌍에 이미 등록된 원어입니다.')
  const index = state.glossary.findIndex(t => t.id === term.id)
  if (index < 0) { if (state.glossary.length >= LIMITS.glossary) throw new Error('용어는 최대 1,000개까지 보관할 수 있습니다.'); state.glossary.push(term) }
  else state.glossary[index] = term
  if (refresh) refreshGlossaryDocuments(state)
}
export function parseGlossaryCSV(text: string, defaultProject = ''): GlossaryEntry[] {
  const rows = parseCSV(text), header = rows.shift()?.map(v => v.trim().toLowerCase()) ?? []
  if (!header.includes('source') || !header.includes('target') || new Set(header).size !== header.length) throw new Error('중복 없는 source,target 열 이름이 필요합니다.')
  const terms = rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`${index + 2}행의 열 개수가 다릅니다.`)
    const get = (key: string) => row[header.indexOf(key)]?.trim() ?? ''
    const sourceLang = get('source_language') || 'en', targetLang = get('target_language') || 'ko', severity = get('severity') || 'warning', category = get('category') || 'term'
    if (!Object.hasOwn(LANGUAGES, sourceLang) || !Object.hasOwn(LANGUAGES, targetLang) || !['info','warning','error'].includes(severity) || !Object.hasOwn(TERM_CATEGORIES, category)) throw new Error(`${index + 2}행의 언어·분류·중요도를 확인해 주세요.`)
    return { id: uid(), source: get('source'), target: get('target'), sourceLang, targetLang, severity, category, project: get('project') || defaultProject, aliases: get('aliases').split('|').map(v => v.trim()).filter(Boolean), variants: get('variants').split('|').map(v => v.trim()).filter(Boolean), note: get('note') } as GlossaryEntry
  })
  if (!terms.length || terms.length > LIMITS.glossary || terms.some(t => !t.source || !t.target)) throw new Error('원어·기준 번역이 있는 용어를 1~1,000개 입력해 주세요.')
  if (new Set(terms.map(glossaryIdentity)).size !== terms.length) throw new Error('CSV 안에 같은 작품·언어·원어가 중복됩니다.')
  return terms
}
