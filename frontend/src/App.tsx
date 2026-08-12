import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { clearApiKey, loadApiKey, saveApiKey } from './api/apiKeyStorage'
import { toDisplayMessage } from './api/errors'
import { fetchProjects } from './api/projects'
import type { Project } from './api/types'
import { ApiKeyPanel } from './components/ApiKeyPanel'
import { ProjectsPanel } from './components/ProjectsPanel'
import { getApiBaseUrl } from './config'

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const baseUrl = getApiBaseUrl()

  const reload = useCallback(async (key: string) => {
    if (key === '') {
      setProjects(null)
      setErrorMessage(null)
      return
    }
    setIsLoading(true)
    setErrorMessage(null)
    try {
      setProjects(await fetchProjects(key))
    } catch (error) {
      setProjects(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload(apiKey)
  }, [apiKey, reload])

  const handleSave = (value: string) => {
    const trimmed = value.trim()
    saveApiKey(trimmed)
    setApiKey(trimmed)
    void reload(trimmed)
  }

  const handleClear = () => {
    clearApiKey()
    setApiKey('')
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
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

        <ProjectsPanel
          projects={projects}
          errorMessage={errorMessage}
          isLoading={isLoading}
          onReload={() => void reload(apiKey)}
        />
      </Stack>
    </Container>
  )
}
