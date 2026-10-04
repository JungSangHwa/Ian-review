import { subtitleTextProblems } from './subtitles'
import type { Translation, TranslationSegment } from '../types/translation'
import type { ReviewIssue } from '../types/issue'
import { now, uid, type GlossaryEntry } from './model'
import { applicableTerms, containsTerm, normalizeKnownVariants, sourceUsesTerm } from './terminology'
const normalized = (s: string) => s.normalize('NFKC').toLocaleLowerCase()
const smallNumbers = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
const tensNumbers = ['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
const below100 = '(?:' + tensNumbers.join('|') + ')(?:[ -](?:' + smallNumbers.slice(1,10).join('|') + '))?|(?:' + smallNumbers.join('|') + ')'
const below1000 = '(?:(?:a|' + smallNumbers.slice(1,10).join('|') + ') hundred(?: (?:and )?(?:' + below100 + '))?|(?:' + below100 + '))'
const writtenNumber = new RegExp('\\b(?:' + below1000 + ' thousand(?: (?:and )?' + below1000 + ')?|' + below1000 + ')\\b', 'gi')
const nativeUnits: Record<string,number> = { 한:1, 하나:1, 두:2, 둘:2, 세:3, 셋:3, 네:4, 넷:4, 다섯:5, 여섯:6, 일곱:7, 여덟:8, 아홉:9 }
const nativeTens: Record<string,number> = { 열:10, 스물:20, 스무:20, 서른:30, 마흔:40, 쉰:50, 예순:60, 일흔:70, 여든:80, 아흔:90 }
// Read native Korean cardinals only before explicit counters, not syllables
// inside ordinary words such as 세관 or 네모. Standalone one remains ambiguous.
const koreanCardinal = new RegExp('(?<![가-힣])((?:' + Object.keys(nativeTens).join('|') + ')(?:\\s*(?:' + Object.keys(nativeUnits).join('|') + '))?|(?:' + Object.keys(nativeUnits).join('|') + '))\\s*(?:차례|개월|시간|마리|사람|번(?!째)|개|명(?!령)|권|척|잔|대|장|살|년|해|분|초|일|주)', 'g')
const numbers = (s: string, language: string) => {
  const text = s.normalize('NFKC').replace(/\u2212/g, '-')
  const digits = [...text.matchAll(/[+-]?\d+(?:[,.]\d+)*/g)].map(match => {
    let value = match[0]
    // A hyphen inside an ISO date, range or identifier is not a unary minus.
    if (/^[+-]/.test(value) && match.index > 0 && /[a-zA-Z0-9_.]/.test(text[match.index - 1])) value = value.slice(1)
    return value.replace(/^\+/, '').replace(/,(?=\d{3}(?:\D|$))/g, '')
  })
  if (language === 'ko') {
    const words = [...text.matchAll(koreanCardinal)].flatMap(match => {
      if (match[0] === '열대') return [] // tropical, unlike the explicit count 열 대
      const token = match[1].replace(/\s/g,'')
      const ten = Object.keys(nativeTens).find(word => token.startsWith(word))
      const value = ten ? nativeTens[ten] + (nativeUnits[token.slice(ten.length)] ?? 0) : nativeUnits[token]
      return value > 1 ? [String(value)] : []
    })
    return [...digits,...words].sort()
  }
  if (language !== 'en') return digits.sort()
  const words = [...text.matchAll(writtenNumber)].flatMap(match => {
    // Standalone 'one' can be an indefinite pronoun. Keep that ambiguous case
    // outside this literal cardinal check; compound numbers still include it.
    if (match[0].toLowerCase() === 'one') return []
    let total = 0, group = 0
    for (const word of match[0].toLowerCase().split(/[ -]+/)) {
      if (word === 'and') continue
      if (word === 'hundred') group *= 100
      else if (word === 'thousand') { total += group * 1000; group = 0 }
      else if (word === 'a') group += 1
      else if (smallNumbers.includes(word)) group += smallNumbers.indexOf(word)
      else group += (tensNumbers.indexOf(word) + 2) * 10
    }
    return [String(total + group)]
  })
  const repetitions = [...text.matchAll(/\btwice\b/gi)].map(()=>'2')
  return [...digits, ...words, ...repetitions].sort()
}
const placeholders = (s: string) => (s.match(/\$\{[^}]+\}|\{\{[^}]+\}\}|\{[\w.]+\}|%%|%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdif]/g) ?? []).filter(value => value !== '%%').sort()
const equal = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
export function inspectSegment(segment: TranslationSegment, doc: Pick<Translation, 'sourceLang' | 'targetLang' | 'contentType'> & { domain?: string }, glossary: GlossaryEntry[]): ReviewIssue[] {
  const out: ReviewIssue[] = []
  const add = (code: string, type: string, severity: ReviewIssue['severity'], reason: string, suggestion?: string, sourceQuote?: string) => {
    out.push({ id: uid(), segmentId: segment.id, targetRevision: segment.revision, type, severity, reason,
      ...(suggestion !== undefined ? { suggestedTargetText: suggestion } : {}), ...(sourceQuote ? { sourceQuote } : {}),
      targetQuote: segment.targetText.slice(0, 240), status: 'open', origin: 'rule',
      fingerprint: JSON.stringify([segment.id, segment.revision, code, severity, reason, suggestion]), createdAt: now() })
  }
  const source = segment.sourceText, target = segment.targetText
  if (!target.trim()) { add('empty', '번역 누락', 'error', '번역문이 비어 있습니다. 번역을 입력해 주세요.'); return out }
  if (doc.contentType === 'subtitle') for (const issue of subtitleTextProblems(source, target)) add(issue.code, issue.type, 'error', issue.reason)
  const sourceNumbers = numbers(source, doc.sourceLang), targetNumbers = numbers(target, doc.targetLang)
  if (!equal(sourceNumbers, targetNumbers)) add('numbers', '숫자 확인', 'warning', `원문 숫자(${sourceNumbers.join(', ').slice(0, 180) || '없음'})와 번역 숫자(${targetNumbers.join(', ').slice(0, 180) || '없음'})가 다릅니다. 날짜·단위 변환 등 의도된 차이인지 확인해 주세요.`)
  if (!equal(placeholders(source), placeholders(target))) add('placeholder', '변수 확인', 'error', '변수 또는 자리표시자가 원문과 다릅니다. {name}, {{value}}, %s 등을 정확히 보존했는지 확인해 주세요.')
  if (doc.sourceLang !== doc.targetLang && normalized(source.trim()) === normalized(target.trim()) && source.trim().length > 20) add('identical', '미번역 의심', 'warning', '번역문이 원문과 같습니다. 고유명사 등 그대로 유지해야 하는 문장인지 확인해 주세요.')
  const cleaned = target.trim().replace(/[ \t]{2,}/g, ' ')
  if (cleaned !== target) add('spaces', '공백 정리', 'info', '앞뒤 공백 또는 연속 공백이 있습니다. 서식을 위한 공백인지 확인해 주세요.', cleaned)
  const relevant = applicableTerms(doc, glossary).filter(term => sourceUsesTerm(source, term))
  for (const term of relevant) {
    const replaced = normalizeKnownVariants(target, [term])
    const mixed = replaced !== target
    if (mixed || !containsTerm(target, term.target)) {
      const suggested = normalizeKnownVariants(target, relevant)
      add(`term:${term.id}`, mixed ? '표기 혼용' : '용어 일관성', term.severity, mixed ? `“${term.source}”의 다른 표기가 쓰였습니다. 이 작품에서는 “${term.target}”로 통일합니다.${term.note ? ` ${term.note}` : ''}` : `용어집의 “${term.source} → ${term.target}”가 반영되지 않았습니다. 문맥에 맞게 적용하거나 예외 처리해 주세요.`, suggested !== target ? suggested : undefined, term.source)
      out[out.length - 1].termId = term.id
    }
  }
  return out
}
/** Re-running checks preserves decisions only for the same segment revision and rule result. */
export function analyzeDocument(doc: Translation, glossary: GlossaryEntry[]) {
  const generated = doc.segments.flatMap(s => inspectSegment(s, doc, glossary))
  if (generated.length + doc.issues.filter(i => i.origin === 'manual' && i.status === 'open').length > 4500) throw new Error('문서의 검사 결과가 너무 많습니다. 문서를 나누거나 용어집 범위를 줄여 주세요.')
  const existing = new Map(doc.issues.filter(i => i.origin === 'rule').map(i => [i.fingerprint, i]))
  const fingerprints = new Set(generated.map(i => i.fingerprint))
  const historical = doc.issues.filter(i => i.origin === 'manual' || !fingerprints.has(i.fingerprint)).map(i => i.origin === 'rule' && i.status === 'open' ? { ...i, status: 'resolved' as const } : i)
  doc.issues = [...historical, ...generated.map(i => existing.get(i.fingerprint) ?? i)]
  // Bound resolved audit data; never silently discard open issues.
  const closed = doc.issues.filter(i => i.status !== 'open').slice(-1500)
  doc.issues = [...closed, ...doc.issues.filter(i => i.status === 'open')]
}
