import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'

import type { CompanyInput } from '../api/types'
import type { CompanyFormErrors, CompanyFormValues } from '../companyForm'
import { EMPTY_COMPANY_FORM_VALUES, toCompanyInput, validateCompanyForm } from '../companyForm'

type Props = {
  open: boolean
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: CompanyInput) => void
  onClose: () => void
}

/** 企業の新規登録フォーム（企業には更新エンドポイントが無いため編集モードは持たない）。 */
export function CompanyFormDialog({ open, errorMessage, isSubmitting, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM_VALUES)
  const [errors, setErrors] = useState<CompanyFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(EMPTY_COMPANY_FORM_VALUES)
      setErrors({})
    }
  }, [open])

  const handleSubmit = () => {
    const validationErrors = validateCompanyForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toCompanyInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>企業を新規登録</DialogTitle>
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
              label="企業名"
              value={values.name}
              onChange={(event) => setValues({ name: event.target.value })}
              error={errors.name !== undefined}
              helperText={errors.name ?? ''}
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            登録する
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
