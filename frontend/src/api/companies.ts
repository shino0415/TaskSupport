import { apiRequest } from './client'
import type {
  Company,
  CompanyInput,
  CompanyListItem,
  CompanyPatchResponse,
  CompanyUpdateInput,
} from './types'

export function fetchCompanies(apiKey: string, signal?: AbortSignal): Promise<CompanyListItem[]> {
  return apiRequest<CompanyListItem[]>('/companies', apiKey, { signal })
}

export function fetchCompany(
  apiKey: string,
  companyId: number,
  signal?: AbortSignal,
): Promise<Company> {
  return apiRequest<Company>(`/companies/${companyId}`, apiKey, { signal })
}

export function createCompany(apiKey: string, input: CompanyInput): Promise<Company> {
  return apiRequest<Company>('/companies', apiKey, { method: 'POST', body: input })
}

export function updateCompany(
  apiKey: string,
  companyId: number,
  input: CompanyUpdateInput,
): Promise<CompanyPatchResponse> {
  return apiRequest<CompanyPatchResponse>(`/companies/${companyId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteCompany(apiKey: string, companyId: number): Promise<void> {
  return apiRequest<void>(`/companies/${companyId}`, apiKey, { method: 'DELETE' })
}
