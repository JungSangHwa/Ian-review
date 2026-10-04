export type TranslationStatus = 'DRAFT' | 'IN_REVIEW' | 'FINALIZED'
export type Language = 'en' | 'ko' | 'ja' | 'zh' | 'de' | 'fr' | 'es'
export type Revision = { text: string; at: string; label: string }
export type SubtitleCue = { identifier?: string; timing: string; prefix?: string[] }
export type TranslationSegment = {
  id: string
  sourceText: string
  originalTargetText: string
  targetText: string
  revision: number
  reviewed: boolean
  history: Revision[]
  cue?: SubtitleCue
}
export type Translation = {
  id: string
  projectId: string
  title: string
  domain: string
  sourceLang: Language
  targetLang: Language
  status: TranslationStatus
  segments: TranslationSegment[]
  issues: import('./issue').ReviewIssue[]
  createdAt: string
  updatedAt: string
  isDemo?: boolean
  contentType?: 'novel' | 'subtitle'
  subtitle?: { format: 'srt' | 'vtt'; header?: string; trailing?: string[] }
  aiRun?: import('../lib/aiTypes').AIRun
}
