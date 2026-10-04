import type { GlossaryEntry } from './model'
import type { Translation } from '../types/translation'
export const termKey = (text: string) => text.normalize('NFKC').trim().toLowerCase()
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function containsTerm(text: string, term: string) {
  const needle = termKey(term), haystack = termKey(text)
  if (!needle) return false
  return /^[a-z0-9 _-]+$/i.test(needle) ? new RegExp(`(^|[^a-z0-9])${escape(needle)}($|[^a-z0-9])`, 'i').test(haystack) : haystack.includes(needle)
}
export function applicableTerms(doc: Pick<Translation, 'sourceLang' | 'targetLang'> & { domain?: string }, terms: GlossaryEntry[]) {
  const scoped = terms.filter(t => t.sourceLang === doc.sourceLang && t.targetLang === doc.targetLang && (!t.project || termKey(t.project) === termKey(doc.domain ?? '')))
  return scoped.filter(t => t.project || !scoped.some(other => other.project && termKey(other.source) === termKey(t.source)))
}
export const sourceUsesTerm = (source: string, term: GlossaryEntry) => [term.source, ...(term.aliases ?? [])].some(alias => containsTerm(source, alias))

/** One pass over the original text: canonical forms are protected and replacements never cascade. */
export function normalizeKnownVariants(text: string, terms: GlossaryEntry[]) {
  const canonical = new Set(terms.map(t => termKey(t.target)))
  const candidates = new Map<string, { original: string; targets: Set<string> }>()
  for (const term of terms) for (const variant of term.variants ?? []) {
    const key = termKey(variant)
    if (!key || canonical.has(key)) continue
    const entry = candidates.get(key) ?? { original: variant, targets: new Set<string>() }
    entry.targets.add(term.target); candidates.set(key, entry)
  }
  const options = [...terms.map(t => t.target), ...[...candidates.values()].map(v => v.original)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!options.length) return text
  const pattern = new RegExp(options.map(value => /^[a-z0-9 _-]+$/i.test(value) ? `(?<![a-zA-Z0-9])${escape(value)}(?![a-zA-Z0-9])` : escape(value)).join('|'), 'giu')
  return text.replace(pattern, match => {
    if (canonical.has(termKey(match))) return match
    const replacements = candidates.get(termKey(match))?.targets
    return replacements?.size === 1 ? [...replacements][0] : match
  })
}
export function terminologyPatches(doc: Translation, glossary: GlossaryEntry[]) {
  const terms = applicableTerms(doc, glossary)
  return doc.segments.flatMap(segment => {
    const relevant = terms.filter(t => sourceUsesTerm(segment.sourceText, t))
    const target = normalizeKnownVariants(segment.targetText, relevant)
    return target === segment.targetText ? [] : [{ segmentId: segment.id, revision: segment.revision, before: segment.targetText, after: target }]
  })
}
export const isTerminologyIssue = (issue: { type: string; termId?: string }) => !!issue.termId || ['용어 일관성', '표기 혼용'].includes(issue.type)
