import { Link } from 'react-router-dom'
import { EmptyState } from '../components/UI'
export default function NotFoundPage() { return <EmptyState icon="search" title="페이지를 찾을 수 없습니다" description="주소를 확인하거나 작업 공간으로 돌아가 주세요."><Link className="button button--primary" to="/">작업 공간으로 돌아가기</Link></EmptyState> }
