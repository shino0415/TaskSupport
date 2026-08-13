import { apiRequest } from './client'
import type { InterviewStep, InterviewStepInput, InterviewStepPatchResponse } from './types'

export function fetchInterviewSteps(
  apiKey: string,
  companyId: number,
  signal?: AbortSignal,
): Promise<InterviewStep[]> {
  return apiRequest<InterviewStep[]>(`/companies/${companyId}/interview-steps`, apiKey, {
    signal,
  })
}

export function createInterviewStep(
  apiKey: string,
  companyId: number,
  input: InterviewStepInput,
): Promise<InterviewStep> {
  return apiRequest<InterviewStep>(`/companies/${companyId}/interview-steps`, apiKey, {
    method: 'POST',
    body: input,
  })
}

export function updateInterviewStep(
  apiKey: string,
  interviewStepId: number,
  input: InterviewStepInput,
): Promise<InterviewStepPatchResponse> {
  return apiRequest<InterviewStepPatchResponse>(`/interview-steps/${interviewStepId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteInterviewStep(apiKey: string, interviewStepId: number): Promise<void> {
  return apiRequest<void>(`/interview-steps/${interviewStepId}`, apiKey, { method: 'DELETE' })
}
