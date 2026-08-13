import { apiRequest } from './client'
import type { WorkLog } from './types'

export function fetchWorkLogs(
  apiKey: string,
  taskId: number,
  signal?: AbortSignal,
): Promise<WorkLog[]> {
  return apiRequest<WorkLog[]>(`/tasks/${taskId}/work-logs`, apiKey, { signal })
}

export function startWorkLog(apiKey: string, taskId: number): Promise<WorkLog> {
  return apiRequest<WorkLog>(`/tasks/${taskId}/work-logs/start`, apiKey, { method: 'POST' })
}

export function stopWorkLog(apiKey: string, workLogId: number): Promise<WorkLog> {
  return apiRequest<WorkLog>(`/work-logs/${workLogId}/stop`, apiKey, { method: 'PATCH' })
}

export function deleteWorkLog(apiKey: string, workLogId: number): Promise<void> {
  return apiRequest<void>(`/work-logs/${workLogId}`, apiKey, { method: 'DELETE' })
}
