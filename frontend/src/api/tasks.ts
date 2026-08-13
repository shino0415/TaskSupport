import { apiRequest } from './client'
import type { Task, TaskInput, TaskPatchResponse } from './types'

export function fetchTasks(apiKey: string, projectId: number, signal?: AbortSignal): Promise<Task[]> {
  return apiRequest<Task[]>(`/projects/${projectId}/tasks`, apiKey, { signal })
}

export function createTask(apiKey: string, projectId: number, input: TaskInput): Promise<Task> {
  return apiRequest<Task>(`/projects/${projectId}/tasks`, apiKey, { method: 'POST', body: input })
}

export function updateTask(
  apiKey: string,
  taskId: number,
  input: TaskInput,
): Promise<TaskPatchResponse> {
  return apiRequest<TaskPatchResponse>(`/tasks/${taskId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteTask(apiKey: string, taskId: number): Promise<void> {
  return apiRequest<void>(`/tasks/${taskId}`, apiKey, { method: 'DELETE' })
}
