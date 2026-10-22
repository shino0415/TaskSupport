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

type CompaniesPageProps = {
  apiKey: string
  initialDetailCompanyId?: number | null
}

/** 「選考ページ」（`/companies`）— 企業・選考ステップ管理画面を表示する。 */
function CompaniesPage({ apiKey, initialDetailCompanyId = null }: CompaniesPageProps) {
  return <CompaniesPanel apiKey={apiKey} initialDetailCompanyId={initialDetailCompanyId} />
}

/** `/companies/:companyId` — 選考ページの企業詳細ダイアログを開いた状態で表示する。 */
function CompanyDetailRoute({ apiKey }: { apiKey: string }) {
  const { companyId } = useParams()
  const id = Number(companyId)
  return <CompaniesPage apiKey={apiKey} initialDetailCompanyId={Number.isNaN(id) ? null : id} />
}

/** `/courses/:courseId` — 授業ページで指定の授業を選択し、課題一覧を開いた状態で表示する。 */
function CourseAssignmentsRoute({ apiKey }: { apiKey: string }) {
  const { courseId } = useParams()
  const id = Number(courseId)
  return <CoursesPanel apiKey={apiKey} initialSelectedCourseId={Number.isNaN(id) ? null : id} />
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
            {/* 廃止した旧案件系のURL（/projects・/tasks 等）もここで横断一覧へ案内する */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Stack>
      </Container>
    </BrowserRouter>
  )
}
