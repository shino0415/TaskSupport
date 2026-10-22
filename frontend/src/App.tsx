import { useState } from 'react'

import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

import { clearApiKey, loadApiKey, saveApiKey } from './api/apiKeyStorage'
import { ApiKeyPanel } from './components/ApiKeyPanel'
import { CompaniesPanel } from './components/CompaniesPanel'
import { CoursesPanel } from './components/CoursesPanel'
import { NavBar } from './components/NavBar'
import { OverviewPanel } from './components/OverviewPanel'
import { getApiBaseUrl } from './config'
import { parsePositiveIntegerParam } from './routeParams'

type CompaniesPageProps = {
  apiKey: string
  initialDetailCompanyId?: number | null
}

/** 「選考ページ」（`/companies`）— 企業・選考ステップ管理画面を表示する。 */
function CompaniesPage({ apiKey, initialDetailCompanyId = null }: CompaniesPageProps) {
  return <CompaniesPanel apiKey={apiKey} initialDetailCompanyId={initialDetailCompanyId} />
}

/** `/companies/:companyId` — 選考ページの企業詳細ダイアログを開いた状態で表示する。不正なidは選考ページへ案内する。 */
function CompanyDetailRoute({ apiKey }: { apiKey: string }) {
  const id = parsePositiveIntegerParam(useParams().companyId)
  if (id === null) {
    return <Navigate to="/companies" replace />
  }
  return <CompaniesPage apiKey={apiKey} initialDetailCompanyId={id} />
}

/** `/courses/:courseId` — 授業ページで指定の授業を選択し、課題一覧を開いた状態で表示する。不正なidは授業ページへ案内する。 */
function CourseAssignmentsRoute({ apiKey }: { apiKey: string }) {
  const id = parsePositiveIntegerParam(useParams().courseId)
  if (id === null) {
    return <Navigate to="/courses" replace />
  }
  return <CoursesPanel apiKey={apiKey} initialSelectedCourseId={id} />
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
              授業タスク・選考トラッカー
            </Typography>
            <Typography variant="body2" color="text.secondary">
              接続先: {baseUrl ?? '(未設定)'}
            </Typography>
          </div>

          <NavBar />

          <ApiKeyPanel savedApiKey={apiKey} onSave={handleSave} onClear={handleClear} />

          {apiKey === '' && (
            <Alert severity="info">API Keyを入力すると、APIへ接続して各画面のデータを表示します。</Alert>
          )}

          <Routes>
            <Route path="/" element={<OverviewPanel apiKey={apiKey} />} />
            <Route path="/courses" element={<CoursesPanel apiKey={apiKey} />} />
            <Route path="/courses/:courseId" element={<CourseAssignmentsRoute apiKey={apiKey} />} />
            <Route path="/companies" element={<CompaniesPage apiKey={apiKey} />} />
            <Route path="/companies/:companyId" element={<CompanyDetailRoute apiKey={apiKey} />} />
            {/* 廃止済みの旧URL（/projects・/tasks 等）もここで横断一覧へ案内する */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Stack>
      </Container>
    </BrowserRouter>
  )
}
