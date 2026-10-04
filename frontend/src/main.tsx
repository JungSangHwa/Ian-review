import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { WorkspaceProvider } from './state/WorkspaceContext'
import { AIJobsProvider } from './state/AIJobsContext'
import './styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Ian render error', error, info.componentStack) }
  render() { return this.state.error ? <div className="boot-state"><h1>예상치 못한 화면 오류가 발생했습니다</h1><p>저장 데이터는 유지됩니다. 새로고침해 주세요.</p><button className="button" onClick={() => location.reload()}>새로고침</button></div> : this.props.children }
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><WorkspaceProvider><AIJobsProvider><App /></AIJobsProvider></WorkspaceProvider></ErrorBoundary></StrictMode>)
