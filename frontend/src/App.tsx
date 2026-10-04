import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import HomePage from './pages/HomePage'
import DocumentsPage from './pages/DocumentsPage'
import NewDocumentPage from './pages/NewDocumentPage'
import ReviewPage from './pages/ReviewPage'
import EvaluationsPage from './pages/EvaluationsPage'
import NewEvaluationPage from './pages/NewEvaluationPage'
import EvaluationDetailPage from './pages/EvaluationDetailPage'
import GlossaryPage from './pages/GlossaryPage'
import SettingsPage from './pages/SettingsPage'
import HelpPage from './pages/HelpPage'
import NotFoundPage from './pages/NotFoundPage'
import ModelsPage from './pages/ModelsPage'
import ProjectGate from './components/ProjectGate'
const router = createBrowserRouter([{ element: <AppLayout />, errorElement: <div className="boot-state"><h1>화면을 열지 못했습니다</h1><p>저장된 데이터는 임의로 삭제하지 않았습니다. 새로고침해 다시 시도해 주세요.</p><button className="button" onClick={() => location.reload()}>다시 열기</button></div>, children: [
  { index: true, element: <HomePage /> }, { path: 'documents', element: <DocumentsPage /> }, { path: 'documents/new', element: <NewDocumentPage /> },
  { path: 'review/:translationId', element: <ReviewPage /> }, { path: 'evaluations', element: <EvaluationsPage /> }, { path: 'evaluations/new', element: <NewEvaluationPage /> },
  { path: 'evaluation/:evaluationId', element: <EvaluationDetailPage /> }, { path: 'glossary', element: <GlossaryPage /> }, { path: 'settings', element: <SettingsPage /> },
  { path: 'models', element: <ModelsPage /> },
  { path: 'projects/:project', element: <ProjectGate />, children: [
    { index: true, element: <HomePage /> }, { path: 'documents', element: <DocumentsPage /> }, { path: 'documents/new', element: <NewDocumentPage /> },
    { path: 'review/:translationId', element: <ReviewPage /> }, { path: 'glossary', element: <GlossaryPage /> }, { path: 'models', element: <ModelsPage /> },
    { path: 'evaluations', element: <EvaluationsPage /> }, { path: 'evaluations/new', element: <NewEvaluationPage /> }, { path: 'evaluation/:evaluationId', element: <EvaluationDetailPage /> },
  ] },
  { path: 'help', element: <HelpPage /> }, { path: 'home', element: <Navigate to="/" replace /> }, { path: '*', element: <NotFoundPage /> },
] }])
export default function App() { return <RouterProvider router={router} /> }
