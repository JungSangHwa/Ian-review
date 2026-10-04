import type { Translation } from '../types/translation'
import type { Evaluation, Workspace } from './model'
import { CRITERIA, LIMITS, now } from './model'
export function splitText(text: string, mode: 'paragraph' | 'line'): string[] {
  const value = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trim()
  if (!value) return []
  return value.split(mode === 'line' ? /\n/ : /\n[\t ]*\n+/).map(v => v.trim()).filter(Boolean)
}
/** RFC 4180-style parser: quoted commas, newlines, escaped quotes, BOM, CRLF. */
export function parseCSV(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',' || c === '\n') {
      row.push(field); field = ''; closed = false
      if (c === '\n') { rows.push(row); row = [] }
    } else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') throw new Error('CSV 따옴표 형식이 올바르지 않습니다. 쉼표와 줄바꿈이 있는 셀은 큰따옴표로 감싸 주세요.'); field += c }
  }
  if (quoted) throw new Error('CSV의 닫는 큰따옴표가 없습니다.')
  if (field || row.length || closed) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim()))
}
export function importPairs(input: string): { source: string; target: string }[] {
  const rows = parseCSV(input)
  if (!rows.length) throw new Error('CSV 파일이 비어 있습니다.')
  const header = rows[0].map(s => s.trim().toLowerCase())
  const sourceIndex = header.indexOf('source'), targetIndex = header.indexOf('target')
  if (sourceIndex < 0 || targetIndex < 0) throw new Error('첫 줄에 source,target 열 이름이 필요합니다. 제공된 CSV 예제를 참고해 주세요.')
  if (new Set(header).size !== header.length) throw new Error('CSV 열 이름이 중복되었습니다.')
  const result = rows.slice(1).map((r, i) => {
    if (r.length !== header.length) throw new Error(`${i + 2}행의 열 개수가 첫 줄과 다릅니다.`)
    if (!r[sourceIndex].trim()) throw new Error(`${i + 2}행에 원문이 없습니다.`)
    if (r[sourceIndex].length > LIMITS.text || r[targetIndex].length > LIMITS.text) throw new Error(`${i + 2}행이 문단 길이 제한을 넘었습니다.`)
    return { source: r[sourceIndex], target: r[targetIndex] }
  })
  if (!result.length || result.length > LIMITS.segments) throw new Error(`CSV 문단 수는 1~${LIMITS.segments}개여야 합니다.`)
  return result
}
export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  // Prevent formula execution when exported CSV is opened in a spreadsheet.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
export const makeCSV = (rows: unknown[][]) => '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')
// eslint-disable-next-line no-control-regex
export const safeName = (title: string) => title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 90) || 'ian-export'
export function download(content: string, name: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export function exportTranslation(doc: Translation, format: 'txt' | 'csv') {
  const content = format === 'txt' ? doc.segments.map(s => s.targetText).join('\n\n') : makeCSV([
    ['source', 'target', 'reviewed', 'revision'], ...doc.segments.map(s => [s.sourceText, s.targetText, s.reviewed, s.revision]),
  ])
  download(content, `${safeName(doc.title)}.${format}`, format === 'csv' ? 'text/csv;charset=utf-8' : undefined)
}
export function backupText(state: Workspace): string {
  return JSON.stringify({ format: 'ian-review-workspace', version: 1, exportedAt: now(), data: state })
}
export function exportBackup(state: Workspace) { download(backupText(state), `ian-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json') }
export function exportEvaluations(items: Evaluation[]) {
  download(makeCSV([
    ['title', 'status', 'reviewer', 'A_label', 'B_label', ...Object.keys(CRITERIA).map(c => `A_${c}`), ...Object.keys(CRITERIA).map(c => `B_${c}`), 'preference', 'comment', 'submitted_at'],
    ...items.map(e => [e.title, e.status, e.reviewer, e.status === 'SUBMITTED' ? e.candidates[0].label : '미공개', e.status === 'SUBMITTED' ? e.candidates[1].label : '미공개',
      e.ratings[0].accuracy, e.ratings[0].fluency, e.ratings[0].terminology, e.ratings[1].accuracy, e.ratings[1].fluency, e.ratings[1].terminology, e.preference, e.comment, e.submittedAt ?? '']),
  ]), 'ian-evaluations.csv', 'text/csv;charset=utf-8')
}
export async function readTextFile(file: File, maxBytes = LIMITS.fileBytes): Promise<string> {
  if (file.size > maxBytes) throw new Error(`파일은 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 이하여야 합니다.`)
  const buffer = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { throw new Error('UTF-8 파일이 아닙니다. UTF-8 형식으로 다시 저장해 주세요.') }
}
