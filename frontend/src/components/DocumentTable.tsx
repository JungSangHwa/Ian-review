import { Link, useParams } from 'react-router-dom'
import { projectPath } from '../lib/projects'
import type { Translation } from '../types/translation'
import { openIssues, progress, relativeTime } from '../lib/model'
import { Badge, ProgressBar, StatusBadge } from './UI'
import Icon from './Icon'
export default function DocumentTable({ documents, onDelete }: { documents: Translation[]; onDelete?: (doc: Translation) => void }) {
  const { project } = useParams()
  const reviewPath = (doc: Translation) => project || doc.domain ? projectPath(project || doc.domain, `review/${doc.id}`) : `/review/${doc.id}`
  return <div className="table-scroll"><table className="document-table"><caption className="sr-only">번역 문서 목록</caption><thead><tr><th>문서 이름</th><th>언어</th><th>상태</th><th>검수 진행률</th><th>최근 수정</th><th><span className="sr-only">작업</span></th></tr></thead><tbody>{documents.map(doc => <tr key={doc.id}><td><Link className="document-name" to={reviewPath(doc)}><span className={`doc-icon ${doc.status === 'FINALIZED' ? 'doc-icon--done' : ''}`}><Icon name="file" size={20} /></span><span><strong>{doc.title}</strong><small>{doc.domain || '일반 문서'}<span>·</span>{doc.segments.length}개 {doc.contentType === 'subtitle' ? '자막' : '문단'}{doc.isDemo && <Badge>예제</Badge>}</small></span></Link></td><td><span className="language-pair">{doc.sourceLang.toUpperCase()}<Icon name="arrow" size={12} />{doc.targetLang.toUpperCase()}</span></td><td><StatusBadge status={doc.status} /></td><td><div className="table-progress"><ProgressBar value={progress(doc)} /><span>{progress(doc)}%</span></div><small className="issue-count">{openIssues(doc).length ? `이슈 ${openIssues(doc).length}개` : '미처리 이슈 없음'}</small></td><td className="date-cell">{relativeTime(doc.updatedAt)}</td><td>{onDelete ? <button className="icon-button delete-document" aria-label={`${doc.title} 삭제`} onClick={() => onDelete(doc)}><Icon name="trash" size={16} /></button> : <Link className="icon-button" to={reviewPath(doc)} aria-label={`${doc.title} 열기`}><Icon name="chevron" size={17} /></Link>}</td></tr>)}</tbody></table></div>
}
