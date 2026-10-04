import { LIMITS, now, uid, type GlossaryEntry, type Workspace } from './model'
import { applicableTerms, containsTerm, termKey } from './terminology'
import { putGlossaryTerm } from './glossary'
import type { Translation } from '../types/translation'
import type { AITermOrigin } from './aiTypes'

const unique = (values: string[]) => [...new Map(values.map(value => [termKey(value), value])).values()].slice(0, 30)
export const NARRATION_RULE = 'For Korean novel narration, consistently use plain literary declarative endings (such as ~다). Do not change correct plain narration into polite endings (~습니다/~어요) during review. Preserve dialogue voices and relationships. Check every source sentence for its actor, speaker, negation, time and uncertainty; a subordinate clause can have a different subject from the main clause. Keep the distinction between pretending, believing and remembering. Do not omit concrete clues, names or possessions for fluency. Proofread Korean particles and spelling as well as meaning. An explicit project style guide overrides this default. 한국어 소설의 지문은 일관된 ~다 문체로 쓰고, 검증 시 ~습니다/~어요로 바꾸지 않습니다. 종속절과 주절의 행동 주체를 구분하고, 가장·믿음·기억을 같은 뜻으로 바꾸지 않습니다. 단서와 부정을 생략하지 않고 조사와 오탈자도 검증합니다. 대사의 높임말은 원문에 맞게 유지하고 명시된 프로젝트 문체를 우선합니다. For subtitles, preserve the source speaker tone and line breaks.'

export const GLOSSARY_RULE = 'Keep personal names, full/short names, epithets and ranks as separate entries when their translated wording differs, even if they refer to the same person. aliases may contain only source spellings that use exactly the same target wording; record same-person relationships in notes instead. Do not put a title translation into a personal-name avoid list. Extract reusable names without incidental quantities or articles (Silver Keys, not 3 Silver Keys). Do not extract ordinary actions or sentence fragments. A phrase must be a distinctive repeated expression, not a one-off narrative sentence. Use character for named persons, title for epithets/ranks, place for places/organizations, term for artifacts. Independently check the source-language meaning of each proposed target before accepting it: preserve occupations, actions and object functions; never turn an ordinary role into an invented supernatural species. Literary wording must still express the source meaning. Notes may state only facts explicitly supported by the supplied source; omit uncertain quantities, ownership, jobs or relationships rather than inventing them. 이름과 호칭은 뜻에 맞는 별도 기준 번역으로 보존합니다. 직업이나 역할의 원뜻을 검증하고 원문에 없는 종족·신분·설정을 창작하지 않습니다. 단순 행동 문장과 수량을 고유명사로 만들지 말고, 근거가 없는 설정은 메모에서 제외합니다.'

/** A byte budget limits reference material, not the stored project glossary.
 * Required entries retain all their notes and spellings. Optional canon is
 * supplied before optional notes so long notes cannot hide later names.
 * This is not a tokenizer; Ollama must also reject context truncation.
 */
export function modelGlossaryContext(terms: GlossaryEntry[], sources: string[], nearby: string[] = []) {
  const budget = 20000, encoder = new TextEncoder()
  const uses = (texts: string[], term: GlossaryEntry) => texts.some(text => [term.source, ...(term.aliases ?? [])].some(alias => containsTerm(text, alias)))
  const required = terms.filter(term => uses(sources, term))
  const optional = terms.filter(term => !required.includes(term))
  optional.sort((a, b) => Number(uses(nearby, b)) - Number(uses(nearby, a)))
  const entries: { source: string; target: string; aliases: string[]; avoid: string[]; category: string; note: string }[] = []
  const selected: GlossaryEntry[] = []
  let bytes = 2
  for (const term of [...required, ...optional]) {
    const item = { source: term.source, target: term.target, aliases: term.aliases ?? [], avoid: term.variants ?? [], category: term.category ?? 'term', note: required.includes(term) ? term.note ?? '' : '' }
    const size = encoder.encode(JSON.stringify(item)).length + (entries.length ? 1 : 0)
    if (bytes + size > budget) {
      if (required.includes(term)) throw new Error(`이 구간에 필요한 용어 “${term.source}”의 메모가 모델 요청 한도를 넘습니다. 원문 묶음이나 용어 메모를 줄여 주세요.`)
      continue
    }
    entries.push(item); selected.push(term); bytes += size
  }
  entries.forEach((item, index) => {
    if (required.includes(selected[index]) || !selected[index].note) return
    const enriched = { ...item, note: selected[index].note! }
    const extra = encoder.encode(JSON.stringify(enriched)).length - encoder.encode(JSON.stringify(item)).length
    if (bytes + extra <= budget) { entries[index] = enriched; bytes += extra }
  })
  return entries
}

/** Store a model-verified term as canon. Established targets stay stable across batches. */
export function storeModelTerm(state: Workspace, doc: Translation, term: Pick<GlossaryEntry, 'source' | 'target' | 'category' | 'aliases' | 'note'>, origin: AITermOrigin) {
  const scoped = applicableTerms(doc, state.glossary)
  const known = scoped.find(entry => termKey(entry.source) === termKey(term.source)) ?? scoped.find(entry => (entry.category ?? 'term') === (term.category ?? 'term') && entry.aliases?.some(alias => termKey(alias) === termKey(term.source)))
  const safeAliases = (aliases: string[], source: string, target: string) => unique(aliases).filter(alias => termKey(alias) !== termKey(source) && !scoped.some(entry => termKey(entry.source) === termKey(alias) && termKey(entry.target) !== termKey(target)))
  const separateAlias = (source: string, target: string, id: string) => {
    for (const entry of scoped) {
      if (entry.id === id || termKey(entry.target) === termKey(target) || !entry.aliases?.some(alias => termKey(alias) === termKey(source))) continue
      // A newly verified title has its own wording. Remove the old same-target
      // alias within this project, without changing a shared glossary entry.
      putGlossaryTerm(state, { ...entry, id: entry.project ? entry.id : uid(), project: doc.domain, aliases: entry.aliases.filter(alias => termKey(alias) !== termKey(source)) }, false)
    }
  }
  if (!known) {
    const id = uid()
    putGlossaryTerm(state, { ...term, aliases: safeAliases(term.aliases ?? [], term.source, term.target), id, project: doc.domain, sourceLang: doc.sourceLang, targetLang: doc.targetLang, severity: 'warning', reviewStatus: 'approved', aiOrigin: origin }, false)
    separateAlias(term.source, term.target, id)
    return { added: 1, conflicts: 0 }
  }
  const conflict = termKey(known.target) !== termKey(term.target)
  const aliases = safeAliases([...(known.aliases ?? []), ...(term.aliases ?? [])], known.source, known.target)
  if (!known.project && !conflict && JSON.stringify(aliases) === JSON.stringify(known.aliases ?? []) && (known.note || !term.note)) return { added: 0, conflicts: 0 }
  // Keep shared entries unchanged; observations belong to this project only.
  const entry = known.project ? known : { ...known, id: uid(), project: doc.domain }
  entry.aliases = aliases
  entry.variants = unique([...(entry.variants ?? []), ...(conflict ? [term.target] : [])]).filter(variant => termKey(variant) !== termKey(entry.target))
  if (!entry.note) entry.note = term.note
  putGlossaryTerm(state, entry, false)
  separateAlias(entry.source, entry.target, entry.id)
  if (conflict) {
    const history = state.termSuggestions ??= []
    if (!history.some(item => item.termId === entry.id && termKey(item.project) === termKey(doc.domain) && termKey(item.target) === termKey(term.target))) {
      if (history.length >= LIMITS.glossary) {
        const old = history.findIndex(item => item.status !== 'pending')
        if (old >= 0) history.splice(old, 1)
      }
      if (history.length < LIMITS.glossary) history.push({ id: uid(), termId: entry.id, project: doc.domain, source: entry.source, target: term.target, note: `모델 검증: 기준 “${entry.target}” 유지. ${term.note ?? ''}`.slice(0, 1000), origin, status: 'dismissed' })
    }
  }
  return { added: 0, conflicts: conflict ? 1 : 0 }
}

export function glossaryDocument(state: Workspace, project: string) {
  const config = state.aiProjects?.find(item => termKey(item.project) === termKey(project))
  const documents = state.translations.filter(doc => termKey(doc.domain) === termKey(project))
  const entries = state.glossary.filter(term => termKey(term.project ?? '') === termKey(project) || (!term.project && documents.some(doc => applicableTerms(doc, state.glossary).includes(term))))
  return `# ${project} · 번역 기준 문서\n\n작성 시각: ${now()}\n\n## 적용 규칙\n\n모든 번역과 모델 재검증에서 같은 기준 번역을 사용합니다. 별칭에는 같은 번역을 쓰는 원어 표기만 연결합니다. 같은 인물의 이름과 호칭도 번역이 다르면 별도 기준을 사용하고 관계는 맥락에 기록합니다. 피할 표기는 기준 번역으로 통일합니다. 근거가 부족한 관계와 설정은 만들어 내지 않습니다.\n\n## 문체와 관계\n\n한국어 웹소설의 서술문은 기본적으로 ‘~다’ 문체를 유지하고 대화는 원문의 말투와 인물 관계를 따릅니다. 자막은 화자의 어조와 줄바꿈을 보존합니다. 프로젝트에서 명시한 문체가 우선합니다.\n\n${config?.instructions || '원문의 문체와 인물 관계를 유지합니다.'}\n\n## 용어\n\n${entries.map(term => `### ${term.source} → ${term.target}\n\n- 언어: ${term.sourceLang} → ${term.targetLang}\n- 별칭: ${term.aliases?.join(', ') || '없음'}\n- 피할 표기: ${term.variants?.join(', ') || '없음'}\n- 맥락: ${term.note || '없음'}\n${term.aiOrigin ? `- 원문 근거: ${term.aiOrigin.quote}\n` : ''}`).join('\n')}`
}
