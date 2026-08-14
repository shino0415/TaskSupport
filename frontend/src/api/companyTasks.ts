import { apiRequest } from './client'
import type { CompanyTask, CompanyTaskInput, CompanyTaskPatchResponse } from './types'

export function fetchCompanyTasks(
  apiKey: string,
  companyId: number,
  signal?: AbortSignal,
): Promise<CompanyTask[]> {
  return apiRequest<CompanyTask[]>(`/companies/${companyId}/company-tasks`, apiKey, { signal })
}

export function createCompanyTask(
  apiKey: string,
  companyId: number,
  input: CompanyTaskInput,
): Promise<CompanyTask> {
  return apiRequest<CompanyTask>(`/companies/${companyId}/company-tasks`, apiKey, {
    method: 'POST',
    body: input,
  })
}

export function updateCompanyTask(
  apiKey: string,
  companyTaskId: number,
  input: CompanyTaskInput,
): Promise<CompanyTaskPatchResponse> {
  return apiRequest<CompanyTaskPatchResponse>(`/company-tasks/${companyTaskId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteCompanyTask(apiKey: string, companyTaskId: number): Promise<void> {
  return apiRequest<void>(`/company-tasks/${companyTaskId}`, apiKey, { method: 'DELETE' })
}
