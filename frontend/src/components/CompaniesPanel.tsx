import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import { createCompany, deleteCompany, fetchCompanies } from '../api/companies'
import { toDisplayMessage } from '../api/errors'
import {
  createInterviewStep,
  deleteInterviewStep,
  fetchInterviewSteps,
  updateInterviewStep,
} from '../api/interviewSteps'
import type { Company, CompanyInput, InterviewStep, InterviewStepInput } from '../api/types'
import { CompanyDetailDialog } from './CompanyDetailDialog'
import { CompanyFormDialog } from './CompanyFormDialog'
import { InterviewStepFormDialog } from './InterviewStepFormDialog'

type Props = {
  apiKey: string
  /** 横断一覧等からの遷移で、指定した企業の詳細ダイアログを開いた状態で表示する。 */
  initialDetailCompanyId?: number | null
}

type Notice = {
  severity: 'success' | 'warning'
  message: string
}

const NO_SELECTION = '' as const

/**
 * 企業の一覧・登録・詳細・削除と、選択した企業配下の選考ステップの一覧・追加・編集・削除を
 * まとめた画面。企業詳細（GET /companies/{id}）は選考ステップの情報を含めないため、
 * 選考ステップは別途 GET /companies/{id}/interview-steps で取得して表示する。
 */
export function CompaniesPanel({ apiKey, initialDetailCompanyId = null }: Props) {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [companiesErrorMessage, setCompaniesErrorMessage] = useState<string | null>(null)
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [isCompanyFormOpen, setIsCompanyFormOpen] = useState(false)
  const [companyFormErrorMessage, setCompanyFormErrorMessage] = useState<string | null>(null)
  const [isSubmittingCompany, setIsSubmittingCompany] = useState(false)

  const [detailCompanyId, setDetailCompanyId] = useState<number | null>(null)
  const [deleteCompanyTarget, setDeleteCompanyTarget] = useState<Company | null>(null)

  const [selectedCompanyId, setSelectedCompanyId] = useState<number | typeof NO_SELECTION>(
    NO_SELECTION,
  )

  const [steps, setSteps] = useState<InterviewStep[] | null>(null)
  const [stepsErrorMessage, setStepsErrorMessage] = useState<string | null>(null)
  const [isLoadingSteps, setIsLoadingSteps] = useState(false)

  const [isStepFormOpen, setIsStepFormOpen] = useState(false)
  const [editingStep, setEditingStep] = useState<InterviewStep | null>(null)
  const [stepFormErrorMessage, setStepFormErrorMessage] = useState<string | null>(null)
  const [isSubmittingStep, setIsSubmittingStep] = useState(false)

  const [deleteStepTarget, setDeleteStepTarget] = useState<InterviewStep | null>(null)

  const reloadCompanies = useCallback(async () => {
    if (apiKey === '') {
      setCompanies(null)
      setCompaniesErrorMessage(null)
      return
    }
    setIsLoadingCompanies(true)
    setCompaniesErrorMessage(null)
    try {
      setCompanies(await fetchCompanies(apiKey))
    } catch (error) {
      setCompanies(null)
      setCompaniesErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingCompanies(false)
    }
  }, [apiKey])

  useEffect(() => {
    void reloadCompanies()
  }, [reloadCompanies])

  // 横断一覧等からの遷移（initialDetailCompanyIdの指定）で、詳細ダイアログを自動的に開く
  useEffect(() => {
    if (initialDetailCompanyId !== null) {
      setDetailCompanyId(initialDetailCompanyId)
    }
  }, [initialDetailCompanyId])

  const reloadSteps = useCallback(async () => {
    if (apiKey === '' || selectedCompanyId === NO_SELECTION) {
      setSteps(null)
      setStepsErrorMessage(null)
      return
    }
    setIsLoadingSteps(true)
    setStepsErrorMessage(null)
    try {
      setSteps(await fetchInterviewSteps(apiKey, selectedCompanyId))
    } catch (error) {
      setSteps(null)
      setStepsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingSteps(false)
    }
  }, [apiKey, selectedCompanyId])

  useEffect(() => {
    void reloadSteps()
  }, [reloadSteps])

  const openCreateCompanyForm = () => {
    setCompanyFormErrorMessage(null)
    setIsCompanyFormOpen(true)
  }

  const handleSubmitCompany = async (input: CompanyInput) => {
    setIsSubmittingCompany(true)
    setCompanyFormErrorMessage(null)
    try {
      await createCompany(apiKey, input)
      setNotice({ severity: 'success', message: '企業を登録しました。' })
      setIsCompanyFormOpen(false)
      await reloadCompanies()
    } catch (error) {
      setCompanyFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingCompany(false)
    }
  }

  const handleDeleteCompany = async (company: Company) => {
    setIsSubmittingCompany(true)
    try {
      await deleteCompany(apiKey, company.id)
      setDeleteCompanyTarget(null)
      if (detailCompanyId === company.id) {
        setDetailCompanyId(null)
      }
      if (selectedCompanyId === company.id) {
        setSelectedCompanyId(NO_SELECTION)
      }
      setNotice({ severity: 'success', message: `企業「${company.name}」を削除しました。` })
      await reloadCompanies()
    } catch (error) {
      setDeleteCompanyTarget(null)
      setCompaniesErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingCompany(false)
    }
  }

  const openCreateStepForm = () => {
    setEditingStep(null)
    setStepFormErrorMessage(null)
    setIsStepFormOpen(true)
  }

  const openEditStepForm = (step: InterviewStep) => {
    setEditingStep(step)
    setStepFormErrorMessage(null)
    setIsStepFormOpen(true)
  }

  const handleSubmitStep = async (input: InterviewStepInput) => {
    if (selectedCompanyId === NO_SELECTION) {
      return
    }
    setIsSubmittingStep(true)
    setStepFormErrorMessage(null)
    try {
      if (editingStep === null) {
        await createInterviewStep(apiKey, selectedCompanyId, input)
        setNotice({ severity: 'success', message: '選考ステップを追加しました。' })
      } else {
        const updated = await updateInterviewStep(apiKey, editingStep.id, input)
        // 準備状況・結果の逆行はブロックされず、更新は成立したうえで警告が返る
        // （両方同時に逆行した場合はAPI側で" / "区切りの1つの文字列にまとめられる）
        setNotice(
          updated.warning === null
            ? { severity: 'success', message: '選考ステップを更新しました。' }
            : {
                severity: 'warning',
                message: `選考ステップを更新しました（変更は保存されています）。${updated.warning}`,
              },
        )
      }
      setIsStepFormOpen(false)
      await reloadSteps()
    } catch (error) {
      setStepFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingStep(false)
    }
  }

  const handleDeleteStep = async (step: InterviewStep) => {
    setIsSubmittingStep(true)
    try {
      await deleteInterviewStep(apiKey, step.id)
      setDeleteStepTarget(null)
      setNotice({ severity: 'success', message: `選考ステップ「${step.type}」を削除しました。` })
      await reloadSteps()
    } catch (error) {
      setDeleteStepTarget(null)
      setStepsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingStep(false)
    }
  }

  const selectedCompany = companies?.find((company) => company.id === selectedCompanyId) ?? null

  return (
    <Paper component="section" aria-label="選考管理" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          企業一覧
        </Typography>
        <Button variant="contained" onClick={openCreateCompanyForm} disabled={apiKey === ''}>
          企業を新規登録
        </Button>
        <Button
          variant="outlined"
          onClick={() => void reloadCompanies()}
          disabled={isLoadingCompanies}
        >
          企業一覧を再読み込み
        </Button>
      </Stack>

      {notice !== null && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {isLoadingCompanies && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography>読み込み中...</Typography>
        </Stack>
      )}

      {!isLoadingCompanies && companiesErrorMessage !== null && (
        <Alert severity="error">{companiesErrorMessage}</Alert>
      )}

      {!isLoadingCompanies && companiesErrorMessage === null && companies !== null && (
        <>
          <Typography sx={{ mb: 1 }}>取得件数: {companies.length} 件</Typography>
          {companies.length === 0 ? (
            <Alert severity="info">企業は0件です。</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>企業名</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {companies.map((company) => (
                    <TableRow key={company.id} selected={company.id === selectedCompanyId}>
                      <TableCell>{company.id}</TableCell>
                      <TableCell>{company.name}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            aria-label={`企業「${company.name}」の詳細`}
                            onClick={() => {
                              setNotice(null)
                              setDetailCompanyId(company.id)
                            }}
                          >
                            詳細
                          </Button>
                          <Button
                            size="small"
                            aria-label={`企業「${company.name}」の選考ステップを表示`}
                            onClick={() => {
                              setNotice(null)
                              setSelectedCompanyId(company.id)
                            }}
                          >
                            選考ステップ
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            aria-label={`企業「${company.name}」を削除`}
                            onClick={() => setDeleteCompanyTarget(company)}
                          >
                            削除
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {selectedCompanyId !== NO_SELECTION && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ mt: 3, mb: 2, alignItems: { sm: 'center' } }}
          >
            <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }}>
              選考ステップ{selectedCompany === null ? '' : `（${selectedCompany.name}）`}
            </Typography>
            <Button variant="contained" onClick={openCreateStepForm} disabled={apiKey === ''}>
              選考ステップを追加
            </Button>
            <Button
              variant="outlined"
              onClick={() => void reloadSteps()}
              disabled={isLoadingSteps}
            >
              選考ステップ一覧を再読み込み
            </Button>
          </Stack>

          {isLoadingSteps && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography>読み込み中...</Typography>
            </Stack>
          )}

          {!isLoadingSteps && stepsErrorMessage !== null && (
            <Alert severity="error">{stepsErrorMessage}</Alert>
          )}

          {!isLoadingSteps && stepsErrorMessage === null && steps !== null && (
            <>
              <Typography sx={{ mb: 1 }}>取得件数: {steps.length} 件</Typography>
              {steps.length === 0 ? (
                <Alert severity="info">選考ステップは0件です。</Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>種別</TableCell>
                        <TableCell>予定日</TableCell>
                        <TableCell>準備状況</TableCell>
                        <TableCell>結果</TableCell>
                        <TableCell>メモ</TableCell>
                        <TableCell>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {steps.map((step) => (
                        <TableRow key={step.id}>
                          <TableCell>{step.id}</TableCell>
                          <TableCell>{step.type}</TableCell>
                          <TableCell>{step.date ?? '未定'}</TableCell>
                          <TableCell>{step.prep_status}</TableCell>
                          <TableCell>{step.result}</TableCell>
                          <TableCell>{step.memo ?? '-'}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                aria-label={`選考ステップ「${step.type}」を編集`}
                                onClick={() => openEditStepForm(step)}
                              >
                                編集
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                aria-label={`選考ステップ「${step.type}」を削除`}
                                onClick={() => setDeleteStepTarget(step)}
                              >
                                削除
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </>
      )}

      <CompanyFormDialog
        open={isCompanyFormOpen}
        errorMessage={companyFormErrorMessage}
        isSubmitting={isSubmittingCompany}
        onSubmit={(input) => void handleSubmitCompany(input)}
        onClose={() => setIsCompanyFormOpen(false)}
      />

      <CompanyDetailDialog
        open={detailCompanyId !== null}
        companyId={detailCompanyId}
        apiKey={apiKey}
        onClose={() => setDetailCompanyId(null)}
      />

      <Dialog open={deleteCompanyTarget !== null} onClose={() => setDeleteCompanyTarget(null)}>
        <DialogTitle>企業の削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteCompanyTarget === null
              ? ''
              : `企業「${deleteCompanyTarget.name}」を削除します。よろしいですか？`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteCompanyTarget(null)}>キャンセル</Button>
          <Button
            color="error"
            variant="contained"
            disabled={isSubmittingCompany}
            onClick={() => {
              if (deleteCompanyTarget !== null) {
                void handleDeleteCompany(deleteCompanyTarget)
              }
            }}
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>

      <InterviewStepFormDialog
        open={isStepFormOpen}
        step={editingStep}
        errorMessage={stepFormErrorMessage}
        isSubmitting={isSubmittingStep}
        onSubmit={(input) => void handleSubmitStep(input)}
        onClose={() => setIsStepFormOpen(false)}
      />

      <Dialog open={deleteStepTarget !== null} onClose={() => setDeleteStepTarget(null)}>
        <DialogTitle>選考ステップの削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteStepTarget === null
              ? ''
              : `選考ステップ「${deleteStepTarget.type}」を削除します。よろしいですか？`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteStepTarget(null)}>キャンセル</Button>
          <Button
            color="error"
            variant="contained"
            disabled={isSubmittingStep}
            onClick={() => {
              if (deleteStepTarget !== null) {
                void handleDeleteStep(deleteStepTarget)
              }
            }}
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
