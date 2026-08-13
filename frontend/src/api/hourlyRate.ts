import { apiRequest } from './client'
import type { HourlyRate } from './types'

export function fetchHourlyRate(
  apiKey: string,
  projectId: number,
  signal?: AbortSignal,
): Promise<HourlyRate> {
  return apiRequest<HourlyRate>(`/projects/${projectId}/hourly-rate`, apiKey, { signal })
}
