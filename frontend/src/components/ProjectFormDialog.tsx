import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'

import type { Project, ProjectInput, ProjectStatus } from '../api/types'
import { PROJECT_STATUSES } from '../api/types'
import type { ProjectFormErrors, ProjectFormValues } from '../projectForm'
import { toProjectFormValues, toProjectInput, validateProjectForm } from '../projectForm'

type Props = {
  open: boolean
  /** nullなら新規登録、指定時はその案件の編集。 */
  project: Project | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: ProjectInput) => void
  onClose: () => void
}

export function ProjectFormDialog({
  open,
  project,
  errorMessage,
  isSubmitting,
  onSubmit,
  onClose,
}: Props) {
  const [values, setValues] = useState<ProjectFormValues>(() => toProjectFormValues(project))
  const [errors, setErrors] = useState<ProjectFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toProjectFormValues(project))
      setErrors({})
    }
  }, [open, project])

  const isEdit = project !== null

  const update = <K extends keyof ProjectFormValues>(field: K, value: ProjectFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateProjectForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toProjectInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? `案件を編集（ID: ${project.id}）` : '案件を新規登録'}</DialogTitle>
      <Box
        component="form"
        // 未入力の指摘はブラウザ標準のツールチップではなく項目ごとのメッセージで行う
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}
            <TextField
              label="案件名"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              error={errors.name !== undefined}
              helperText={errors.name ?? ''}
              required
              fullWidth
            />
            <TextField
              label="クライアント名"
              value={values.client_name}
              onChange={(event) => update('client_name', event.target.value)}
              error={errors.client_name !== undefined}
              helperText={errors.client_name ?? ''}
              required
              fullWidth
            />
            <TextField
              select
              label="ステータス"
              value={values.status}
              onChange={(event) => update('status', event.target.value as ProjectStatus)}
              fullWidth
            >
              {PROJECT_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="報酬額"
              type="number"
              value={values.reward}
              onChange={(event) => update('reward', event.target.value)}
              error={errors.reward !== undefined}
              helperText={errors.reward ?? ''}
              required
              fullWidth
            />
            <TextField
              label="応募日"
              type="date"
              value={values.applied_date}
              onChange={(event) => update('applied_date', event.target.value)}
              error={errors.applied_date !== undefined}
              helperText={errors.applied_date ?? ''}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="納期"
              type="date"
              value={values.deadline}
              onChange={(event) => update('deadline', event.target.value)}
              helperText="未設定でも登録できます。"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="プラットフォーム"
              value={values.platform}
              onChange={(event) => update('platform', event.target.value)}
              error={errors.platform !== undefined}
              helperText={errors.platform ?? ''}
              required
              fullWidth
            />
            <TextField
              label="メモ"
              value={values.memo}
              onChange={(event) => update('memo', event.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isEdit ? '更新する' : '登録する'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
