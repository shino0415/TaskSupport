import { useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { toDisplayMessage } from '../api/errors'
import { fetchProject } from '../api/projects'
import type { Project } from '../api/types'

type Props = {
  open: boolean
  projectId: number | null
  apiKey: string
  onClose: () => void
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
        {value}
      </Typography>
    </Stack>
  )
}

/**
 * 案件詳細。一覧の値を使い回さず GET /projects/{id} を叩いて表示する
 * （削除済みの案件が参照できないことも、この取得結果で分かる）。
 */
export function ProjectDetailDialog({ open, projectId, apiKey, onClose }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open || projectId === null) {
      return
    }
    const controller = new AbortController()
    setProject(null)
    setErrorMessage(null)
    setIsLoading(true)
    fetchProject(apiKey, projectId, controller.signal)
      .then((fetched) => setProject(fetched))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setErrorMessage(toDisplayMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })
    return () => controller.abort()
  }, [open, projectId, apiKey])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>案件詳細{projectId === null ? '' : `（ID: ${projectId}）`}</DialogTitle>
      <DialogContent>
        {isLoading && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography>読み込み中...</Typography>
          </Stack>
        )}
        {!isLoading && errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}
        {!isLoading && errorMessage === null && project !== null && (
          <Stack spacing={1}>
            <DetailRow label="案件名" value={project.name} />
            <DetailRow label="クライアント名" value={project.client_name} />
            <DetailRow label="ステータス" value={project.status} />
            <DetailRow label="報酬額" value={project.reward.toLocaleString()} />
            <DetailRow label="応募日" value={project.applied_date} />
            <DetailRow label="納期" value={project.deadline ?? '未設定'} />
            <DetailRow label="プラットフォーム" value={project.platform} />
            <DetailRow label="メモ" value={project.memo ?? '（なし）'} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}
