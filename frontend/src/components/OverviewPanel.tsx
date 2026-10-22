import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'

import { fetchUpcomingAssignments } from '../api/assignments'
import { fetchCompanies } from '../api/companies'
import { toDisplayMessage } from '../api/errors'
import { fetchUpcomingInterviewSteps } from '../api/interviewSteps'
import type { Company, InterviewStep, UpcomingAssignment } from '../api/types'
import { isDeadlinePassed } from '../assignmentDeadline'

type Props = {
  apiKey: string
}

/**
 * アプリの入口として、締切が近い課題（GET /assignments/upcoming）と
 * 日付が近い選考ステップ（GET /interview-steps/upcoming）を確認できる画面。
 * 課題のレスポンスは授業名を含むため、授業一覧の別途取得はしない。
 * APIは自テーブルの情報しか返さないため、選考ステップの企業名は
 * GET /companies を別途取得して突き合わせる（企業一覧の取得に失敗しても
 * 選考ステップ自体は表示できるよう、企業名の表示のみ企業IDへ代替する）。
 */
export function OverviewPanel({ apiKey }: Props) {
  const [assignments, setAssignments] = useState<UpcomingAssignment[] | null>(null)
  const [assignmentsErrorMessage, setAssignmentsErrorMessage] = useState<string | null>(null)
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false)

  const [steps, setSteps] = useState<InterviewStep[] | null>(null)
  const [stepsErrorMessage, setStepsErrorMessage] = useState<string | null>(null)
  const [isLoadingSteps, setIsLoadingSteps] = useState(false)

  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [companiesErrorMessage, setCompaniesErrorMessage] = useState<string | null>(null)
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false)

  const reloadAssignments = useCallback(async () => {
    if (apiKey === '') {
      setAssignments(null)
      setAssignmentsErrorMessage(null)
      return
    }
    setIsLoadingAssignments(true)
    setAssignmentsErrorMessage(null)
    try {
      setAssignments(await fetchUpcomingAssignments(apiKey))
    } catch (error) {
      setAssignments(null)
      setAssignmentsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingAssignments(false)
    }
  }, [apiKey])

  useEffect(() => {
    void reloadAssignments()
  }, [reloadAssignments])

  const reloadSteps = useCallback(async () => {
    if (apiKey === '') {
      setSteps(null)
      setStepsErrorMessage(null)
      return
    }
    setIsLoadingSteps(true)
    setStepsErrorMessage(null)
    try {
      setSteps(await fetchUpcomingInterviewSteps(apiKey))
    } catch (error) {
      setSteps(null)
      setStepsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingSteps(false)
    }
  }, [apiKey])

  useEffect(() => {
    void reloadSteps()
  }, [reloadSteps])

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

  const companyName = (companyId: number): string =>
    companies?.find((company) => company.id === companyId)?.name ?? `企業ID: ${companyId}`

  const now = new Date()

  return (
    <Paper component="section" aria-label="横断一覧" sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
        横断一覧
      </Typography>

      <Box component="section" aria-label="締切が近い課題">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ mb: 2, alignItems: { sm: 'center' } }}
        >
          <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }}>
            締切が近い課題
          </Typography>
          <Button
            variant="outlined"
            onClick={() => void reloadAssignments()}
            disabled={isLoadingAssignments}
          >
            課題一覧を再読み込み
          </Button>
        </Stack>

        {isLoadingAssignments && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <CircularProgress size={20} />
            <Typography>読み込み中...</Typography>
          </Stack>
        )}

        {!isLoadingAssignments && assignmentsErrorMessage !== null && (
          <Alert severity="error" sx={{ mb: 3 }}>
            締切が近い課題を取得できませんでした。{assignmentsErrorMessage}
          </Alert>
        )}

        {!isLoadingAssignments && assignmentsErrorMessage === null && assignments !== null && (
          <>
            <Typography sx={{ mb: 1 }}>取得件数: {assignments.length} 件</Typography>
            {assignments.length === 0 ? (
              <Alert severity="info" sx={{ mb: 3 }}>
                締切が近い課題は0件です。
              </Alert>
            ) : (
              <TableContainer sx={{ mb: 3 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>課題名</TableCell>
                      <TableCell>授業</TableCell>
                      <TableCell>提出期限</TableCell>
                      <TableCell>ステータス</TableCell>
                      <TableCell>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {assignments.map((assignment) => {
                      const isOverdue = isDeadlinePassed(assignment.deadline, now)
                      return (
                        <TableRow key={assignment.id}>
                          <TableCell>{assignment.name}</TableCell>
                          <TableCell>{assignment.course_name}</TableCell>
                          <TableCell sx={isOverdue ? { color: 'error.main' } : undefined}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <span>{assignment.deadline ?? '-'}</span>
                              {isOverdue && (
                                <Typography
                                  component="span"
                                  variant="body2"
                                  sx={{
                                    px: 1,
                                    borderRadius: 1,
                                    fontWeight: 'bold',
                                    color: 'error.contrastText',
                                    bgcolor: 'error.main',
                                  }}
                                >
                                  期限切れ
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell>{assignment.status}</TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              component={RouterLink}
                              to={`/courses/${assignment.course_id}`}
                              aria-label={`課題「${assignment.name}」の授業「${assignment.course_name}」の課題一覧へ`}
                            >
                              授業の課題一覧
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Box>

      <Box component="section" aria-label="予定の近い選考ステップ">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ mb: 2, alignItems: { sm: 'center' } }}
        >
          <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }}>
            予定の近い選考ステップ
          </Typography>
          <Button
            variant="outlined"
            onClick={() => {
              void reloadSteps()
              void reloadCompanies()
            }}
            disabled={isLoadingSteps}
          >
            選考ステップ一覧を再読み込み
          </Button>
        </Stack>

        {!isLoadingCompanies && companiesErrorMessage !== null && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            企業名の取得に失敗したため、選考ステップの企業名は企業IDで表示します。
            {companiesErrorMessage}
          </Alert>
        )}

        {isLoadingSteps && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <CircularProgress size={20} />
            <Typography>読み込み中...</Typography>
          </Stack>
        )}

        {!isLoadingSteps && stepsErrorMessage !== null && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {stepsErrorMessage}
          </Alert>
        )}

        {!isLoadingSteps && stepsErrorMessage === null && steps !== null && (
          <>
            <Typography sx={{ mb: 1 }}>取得件数: {steps.length} 件</Typography>
            {steps.length === 0 ? (
              <Alert severity="info" sx={{ mb: 3 }}>
                予定の近い選考ステップは0件です。
              </Alert>
            ) : (
              <TableContainer sx={{ mb: 3 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>企業</TableCell>
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
                        <TableCell>{companyName(step.company_id)}</TableCell>
                        <TableCell>{step.type}</TableCell>
                        <TableCell>{step.date ?? '未定'}</TableCell>
                        <TableCell>{step.prep_status}</TableCell>
                        <TableCell>{step.result}</TableCell>
                        <TableCell>{step.memo ?? '-'}</TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            component={RouterLink}
                            to={`/companies/${step.company_id}`}
                            aria-label={`企業「${companyName(step.company_id)}」の詳細へ`}
                          >
                            企業の詳細
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Box>
    </Paper>
  )
}
