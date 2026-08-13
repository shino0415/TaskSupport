import { useState } from 'react'

import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

import { clearApiKey, loadApiKey, saveApiKey } from './api/apiKeyStorage'
import { ApiKeyPanel } from './components/ApiKeyPanel'
import { CompaniesPanel } from './components/CompaniesPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { ProjectsPanel } from './components/ProjectsPanel'
import { TasksPanel } from './components/TasksPanel'
import { WorkTrackingPanel } from './components/WorkTrackingPanel'
import { getApiBaseUrl } from './config'

type PanelsProps = {
  apiKey: string
  initialDetailProjectId?: number | null
  initialDetailCompanyId?: number | null
  initialTaskProjectId?: number | null
  initialHighlightTaskId?: number | null
}

/** 5画面すべてを1ページにまとめた表示。ルートごとに、対応する画面へ初期選択状態を渡す。 */
function Panels({
  apiKey,
  initialDetailProjectId = null,
  initialDetailCompanyId = null,
  initialTaskProjectId = null,
  initialHighlightTaskId = null,
}: PanelsProps) {
  return (
    <>
      <OverviewPanel apiKey={apiKey} />

      <ProjectsPanel apiKey={apiKey} initialDetailProjectId={initialDetailProjectId} />

      <TasksPanel
        apiKey={apiKey}
        initialSelectedProjectId={initialTaskProjectId}
        initialHighlightTaskId={initialHighlightTaskId}
      />

      <WorkTrackingPanel apiKey={apiKey} />

      <CompaniesPanel apiKey={apiKey} initialDetailCompanyId={initialDetailCompanyId} />
    </>
  )
}

/** `/projects/:projectId` — 案件管理画面の詳細ダイアログを開いた状態で表示する。 */
function ProjectDetailRoute({ apiKey }: { apiKey: string }) {
  const { projectId } = useParams()
  const id = Number(projectId)
  return <Panels apiKey={apiKey} initialDetailProjectId={Number.isNaN(id) ? null : id} />
}

/** `/companies/:companyId` — 選考管理画面の詳細ダイアログを開いた状態で表示する。 */
function CompanyDetailRoute({ apiKey }: { apiKey: string }) {
  const { companyId } = useParams()
  const id = Number(companyId)
  return <Panels apiKey={apiKey} initialDetailCompanyId={Number.isNaN(id) ? null : id} />
}

/** `/tasks/:projectId/:taskId` — タスク管理画面で対象案件を選択し、対象タスクを目立たせた状態で表示する。 */
function TaskDetailRoute({ apiKey }: { apiKey: string }) {
  const { projectId, taskId } = useParams()
  const projectIdNumber = Number(projectId)
  const taskIdNumber = Number(taskId)
  return (
    <Panels
      apiKey={apiKey}
      initialTaskProjectId={Number.isNaN(projectIdNumber) ? null : projectIdNumber}
      initialHighlightTaskId={Number.isNaN(taskIdNumber) ? null : taskIdNumber}
    />
  )
}

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())

  const baseUrl = getApiBaseUrl()

  const handleSave = (value: string) => {
    const trimmed = value.trim()
    saveApiKey(trimmed)
    setApiKey(trimmed)
  }

  const handleClear = () => {
    clearApiKey()
    setApiKey('')
  }

  return (
    <BrowserRouter>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={3}>
          <div>
            <Typography variant="h4" component="h1" gutterBottom>
              案件・選考トラッカー
            </Typography>
            <Typography variant="body2" color="text.secondary">
              接続先: {baseUrl ?? '(未設定)'}
            </Typography>
          </div>

          <ApiKeyPanel savedApiKey={apiKey} onSave={handleSave} onClear={handleClear} />

          {apiKey === '' && (
            <Alert severity="info">API Keyを入力すると、APIへ接続して案件一覧を表示します。</Alert>
          )}

          <Routes>
            <Route path="/" element={<Panels apiKey={apiKey} />} />
            <Route path="/projects/:projectId" element={<ProjectDetailRoute apiKey={apiKey} />} />
            <Route path="/companies/:companyId" element={<CompanyDetailRoute apiKey={apiKey} />} />
            <Route
              path="/tasks/:projectId/:taskId"
              element={<TaskDetailRoute apiKey={apiKey} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Stack>
      </Container>
    </BrowserRouter>
  )
}
