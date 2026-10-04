import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import type { Translation } from '../types/translation'
import { STATUS } from '../lib/model'
import Icon, { type IconName } from './Icon'
export function Button({ children, icon, variant = 'primary', small, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; small?: boolean }) {
  return <button {...rest} className={`button button--${variant} ${small ? 'button--small' : ''} ${rest.className ?? ''}`}>{icon && <Icon name={icon} size={small ? 15 : 17} />}{children}</button>
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge badge--${tone}`}>{children}</span> }
export function StatusBadge({ status }: { status: Translation['status'] }) { return <Badge tone={status === 'FINALIZED' ? 'green' : status === 'IN_REVIEW' ? 'purple' : 'neutral'}><span className="status-dot" />{STATUS[status]}</Badge> }
export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="heading-actions">{children}</div></div> }
export function EmptyState({ icon = 'file', title, description, children }: { icon?: IconName; title: string; description: string; children?: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={26} /></span><h3>{title}</h3><p>{description}</p>{children}</div> }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close() }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'modal--wide' : ''}`} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose() }}><div className="modal-heading"><h2 id={id}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><Icon name="close" /></button></div>{children}</dialog>
}
export function ConfirmDialog({ title, description, onClose, onConfirm, busy, confirmLabel = '삭제', danger = true }: { title: string; description: string; onClose: () => void; onConfirm: () => void; busy?: boolean; confirmLabel?: string; danger?: boolean }) {
  return <Modal title={title} onClose={() => { if (!busy) onClose() }}><p className="modal-description">{description}</p><div className="modal-actions"><Button variant="secondary" onClick={onClose} disabled={busy}>취소</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{busy ? '처리 중…' : confirmLabel}</Button></div></Modal>
}
export function ProgressBar({ value }: { value: number }) { return <div className="progress" role="progressbar" aria-label="검수 진행률" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div> }
export function MissingDocument({ title = '문서를 찾을 수 없습니다', to = '/documents' }: { title?: string; to?: string }) { return <EmptyState icon="search" title={title} description="삭제되었거나 이 브라우저에 저장되지 않은 항목입니다."><Link to={to} className="button button--primary">목록으로 돌아가기</Link></EmptyState> }
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  if (blocker.state !== 'blocked') return null
  return <ConfirmDialog title="저장하지 않은 변경이 있습니다" description="이 페이지를 떠나면 현재 입력이 사라집니다. 돌아가서 먼저 저장할 수 있습니다." confirmLabel="저장하지 않고 나가기" onClose={() => blocker.reset()} onConfirm={() => blocker.proceed()} />
}
