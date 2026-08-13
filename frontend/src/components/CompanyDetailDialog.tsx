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

import { fetchCompany } from '../api/companies'
import { toDisplayMessage } from '../api/errors'
import type { Company } from '../api/types'

type Props = {
  open: boolean
  companyId: number | null
  apiKey: string
  onClose: () => void
}

/**
 * 企業詳細。一覧の値を使い回さず GET /companies/{id} を叩いて表示する
 * （削除済みの企業が参照できないことも、この取得結果で分かる）。
 * 選考ステップの情報は含めない（別途 GET /companies/{id}/interview-steps を叩く）。
 */
export function CompanyDetailDialog({ open, companyId, apiKey, onClose }: Props) {
  const [company, setCompany] = useState<Company | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open || companyId === null) {
      return
    }
    const controller = new AbortController()
    setCompany(null)
    setErrorMessage(null)
    setIsLoading(true)
    fetchCompany(apiKey, companyId, controller.signal)
      .then((fetched) => setCompany(fetched))
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
  }, [open, companyId, apiKey])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>企業詳細{companyId === null ? '' : `（ID: ${companyId}）`}</DialogTitle>
      <DialogContent>
        {isLoading && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography>読み込み中...</Typography>
          </Stack>
        )}
        {!isLoading && errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}
        {!isLoading && errorMessage === null && company !== null && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
              企業名
            </Typography>
            <Typography variant="body1">{company.name}</Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}
