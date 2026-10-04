import type { SubtitleCue, Translation } from '../types/translation'
export function parseTiming(line: string, format: 'srt' | 'vtt') {
  const clock = format === 'srt' ? '(\\d{2,}:\\d{2}:\\d{2},\\d{3})' : '((?:\\d{2,}:)?\\d{2}:\\d{2}\\.\\d{3})'
  const match = line.match(new RegExp(`^${clock}\\s+-->\\s+${clock}(?:[ \\t]+([^\\r\\n]+))?$`))
  if (!match) throw new Error(`자막 시간 형식이 올바르지 않습니다: ${line}`)
  const milliseconds = (value: string) => {
    const [seconds, fraction] = value.replace(',', '.').split('.'), parts = seconds.split(':').map(Number)
    const sec = parts.pop()!, min = parts.pop()!, hours = parts.pop() ?? 0
    if (min > 59 || sec > 59) throw new Error('자막 분·초는 0~59여야 합니다.')
    return ((hours * 60 + min) * 60 + sec) * 1000 + Number(fraction)
  }
  const start = milliseconds(match[1]), end = milliseconds(match[2])
  if (end <= start) throw new Error('자막 종료 시각은 시작 시각보다 뒤여야 합니다.')
  return { start, end }
}
export function parseSubtitles(input: string, format: 'srt' | 'vtt') {
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/)
  let header = ''
  if (format === 'vtt') {
    header = blocks.shift() ?? ''
    if (!/^WEBVTT(?:[ \t].*)?(?:\n[\s\S]*)?$/.test(header) || header.includes('-->')) throw new Error('WEBVTT 헤더와 그 뒤 빈 줄이 필요합니다.')
  }
  const pairs: { source: string; target: string; cue: SubtitleCue }[] = []
  let pending: string[] = []
  for (const block of blocks) {
    if (format === 'vtt' && /^(NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) { pending.push(block); continue }
    const lines = block.split('\n'), timingIndex = lines[0]?.includes('-->') ? 0 : 1
    const timing = lines[timingIndex] ?? ''
    parseTiming(timing, format)
    const source = lines.slice(timingIndex + 1).join('\n')
    if (!source.trim()) throw new Error('내용이 없는 자막 구간이 있습니다.')
    pairs.push({ source, target: '', cue: { ...(timingIndex ? { identifier: lines[0] } : {}), timing, ...(pending.length ? { prefix: pending } : {}) } })
    pending = []
  }
  if (!pairs.length || pairs.length > 500) throw new Error('자막은 1~500개 구간씩 나누어 가져와 주세요.')
  return { pairs, subtitle: { format, ...(header ? { header } : {}), ...(pending.length ? { trailing: pending } : {}) } }
}
/** Structural subtitle checks shared by model validation and the review screen. */
export function subtitleTextProblems(source: string, target: string) {
  const problems: { code: string; type: string; reason: string }[] = []
  const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').length
  if (lines(source) !== lines(target)) problems.push({ code: 'subtitle-lines', type: '자막 줄바꿈', reason: `자막 원문 ${lines(source)}줄과 번역 ${lines(target)}줄이 다릅니다. 원문의 줄바꿈 수를 보존해 주세요.` })
  const tags = (text: string) => text.match(/<\/?(?:[a-zA-Z][^<>]*|\d{2}:[^<>]*)>/g) ?? []
  if (JSON.stringify(tags(source)) !== JSON.stringify(tags(target))) problems.push({ code: 'subtitle-tags', type: '자막 태그', reason: '자막의 서식·화자·시간 태그가 원문과 다릅니다. 태그와 순서를 그대로 보존해 주세요.' })
  if (/\n[ \t]*\n/.test(target) || target.includes('-->')) problems.push({ code: 'subtitle-cue', type: '자막 구간 구조', reason: '번역문에 자막 구간을 분리하는 빈 줄 또는 시간 화살표가 있습니다.' })
  return problems
}
export function serializeSubtitles(doc: Translation) {
  if (!doc.subtitle) throw new Error('자막 시간 정보가 없는 문서입니다.')
  const blocks: string[] = doc.subtitle.format === 'vtt' ? [doc.subtitle.header || 'WEBVTT'] : []
  doc.segments.forEach((s, i) => {
    if (!s.cue || !s.targetText.trim()) throw new Error(`${i + 1}번 자막의 시간 정보 또는 번역문이 비어 있습니다.`)
    parseTiming(s.cue.timing, doc.subtitle!.format)
    if (/\n[ \t]*\n/.test(s.targetText) || s.targetText.includes('-->')) throw new Error(`${i + 1}번 번역문에 자막을 분리하는 빈 줄 또는 시간 화살표가 있습니다. 줄바꿈을 정리해 주세요.`)
    blocks.push(...(s.cue.prefix ?? []), [s.cue.identifier ?? (doc.subtitle!.format === 'srt' ? String(i + 1) : ''), s.cue.timing, s.targetText].filter(Boolean).join('\n'))
  })
  blocks.push(...(doc.subtitle.trailing ?? []))
  return blocks.join('\n\n') + '\n'
}
