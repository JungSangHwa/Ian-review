export type IssueSeverity = 'info' | 'warning' | 'error'
export type IssueStatus = 'open' | 'applied' | 'dismissed' | 'resolved'
export type ReviewIssue = {
  id: string
  segmentId: string
  targetRevision: number
  type: string
  severity: IssueSeverity
  reason: string
  sourceQuote?: string
  targetQuote?: string
  suggestedTargetText?: string
  status: IssueStatus
  origin: 'rule' | 'manual'
  fingerprint: string
  createdAt: string
  termId?: string
}
