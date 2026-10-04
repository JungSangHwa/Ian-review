import { Link, Outlet, useParams } from 'react-router-dom'
import { projectNames, sameProject } from '../lib/projects'
import { useWorkspace } from '../state/WorkspaceContext'

export default function ProjectGate() {
  const { project } = useParams(), { state } = useWorkspace()
  if (!project || !projectNames(state).some(name => sameProject(name, project))) {
    return <section className="panel"><h1>프로젝트를 찾을 수 없습니다</h1><p>프로젝트 목록에서 작업할 작품을 선택해 주세요.</p><Link className="button button--primary" to="/">전체 프로젝트 보기</Link></section>
  }
  return <Outlet />
}
