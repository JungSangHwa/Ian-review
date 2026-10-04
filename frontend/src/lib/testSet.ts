import { addManualIssue, createDocument } from './actions'
import { emptyRatings, emptyWorkspace, LIMITS, logActivity, now, uid, type Workspace } from './model'
import { inspectSegment } from './rules'
import { validateWorkspace } from './validation'
import { TEST_CASES, TEST_EVALUATIONS, TEST_GROUPS, TEST_SET_ID, TEST_TERMS, TEST_TITLE_PREFIX } from './testCorpus'

export function hasTestSet(state: Workspace) {
  return state.translations.some(doc => doc.domain === TEST_SET_ID) || state.evaluations.some(e => e.title.startsWith(TEST_TITLE_PREFIX))
}

export function loadTestSet(state: Workspace) {
  if (hasTestSet(state)) throw new Error('검증 세트가 이미 있습니다. 번역 문서와 블라인드 평가의 [검증 세트] 항목을 확인해 주세요.')
  if (state.translations.length + TEST_GROUPS.length > LIMITS.documents || state.evaluations.length + TEST_EVALUATIONS.length > LIMITS.evaluations) throw new Error('검증 세트를 추가할 보관 공간이 부족합니다. 문서 4개와 평가 4개를 추가할 수 있어야 합니다.')
  const draft = structuredClone(state)
  for (const term of TEST_TERMS) {
    const existing = draft.glossary.find(t => t.sourceLang === term.sourceLang && t.targetLang === term.targetLang && t.source.normalize('NFKC').toLowerCase() === term.source.normalize('NFKC').toLowerCase())
    if (existing && existing.target !== term.target) throw new Error(`기존 용어 “${term.source} → ${existing.target}”가 테스트 기준과 다릅니다. 기존 용어를 보존하기 위해 추가를 중단했습니다.`)
    if (!existing) draft.glossary.push({ ...term, id: uid() })
  }
  for (const group of TEST_GROUPS) {
    const cases = TEST_CASES.filter(c => c.group === group.id)
    const id = createDocument(draft, { title: TEST_TITLE_PREFIX + group.title, domain: TEST_SET_ID, sourceLang: group.sourceLang, targetLang: group.targetLang, pairs: cases.map(c => ({ source: c.source, target: c.target })) })
    const doc = draft.translations.find(d => d.id === id)!
    cases.forEach((c, index) => {
      if (c.manualReason) addManualIssue(draft, id, doc.segments[index].id, { type: '의미 정확성', severity: 'error', reason: `[${c.id}] ChatGPT 검수: ${c.manualReason}`, suggestedTargetText: c.reference })
    })
  }
  for (const item of TEST_EVALUATIONS) {
    const candidates: Workspace['evaluations'][number]['candidates'] = [{ label: 'ChatGPT 기준 번역', text: item.reference }, { label: 'ChatGPT 의도적 오류·직역 후보', text: item.perturbed }]
    if (crypto.getRandomValues(new Uint8Array(1))[0] % 2) candidates.reverse()
    draft.evaluations.push({ id: uid(), project: TEST_SET_ID, title: TEST_TITLE_PREFIX + item.title, sourceText: item.source, sourceLang: item.sourceLang, targetLang: item.targetLang, candidates, ratings: [emptyRatings(), emptyRatings()], preference: '', comment: '', reviewer: '', status: 'DRAFT', createdAt: now(), updatedAt: now() })
  }
  logActivity(draft, 'ChatGPT 검증 세트: 문서 4개·36문단, A/B 평가 4개를 추가했습니다.')
  Object.assign(state, validateWorkspace(draft))
}

export function buildTestWorkspace() {
  const state = emptyWorkspace()
  loadTestSet(state)
  return state
}

/** Checks declared rule expectations in an isolated workspace, never the user's documents. */
export function inspectTestCorpus() {
  const glossary = TEST_TERMS.map((t, i) => ({ ...t, id: `qa_term_${i}` }))
  return TEST_CASES.map(c => {
    const group = TEST_GROUPS.find(g => g.id === c.group)!
    const issues = inspectSegment({ id: c.id, sourceText: c.source, targetText: c.target, originalTargetText: c.target, revision: 1, reviewed: false, history: [] }, group, glossary)
    const expected = [...c.expectedRules].sort(), actual = issues.map(i => i.type).sort()
    return { id: c.id, purpose: c.purpose, expected, actual, passed: JSON.stringify(expected) === JSON.stringify(actual), manualReviewRequired: !!c.manualReason, intentionalDifference: !!c.intentionalDifference }
  })
}
