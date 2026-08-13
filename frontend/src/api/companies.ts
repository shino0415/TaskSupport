import { apiRequest } from './client'
import type { Company, CompanyInput } from './types'

export function fetchCompanies(apiKey: string, signal?: AbortSignal): Promise<Company[]> {
  return apiRequest<Company[]>('/companies', apiKey, { signal })
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

export function deleteCompany(apiKey: string, companyId: number): Promise<void> {
  return apiRequest<void>(`/companies/${companyId}`, apiKey, { method: 'DELETE' })
}
