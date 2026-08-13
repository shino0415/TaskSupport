import { apiRequest } from './client'
import type { Project, ProjectInput, ProjectPatchResponse } from './types'

type ListOptions = {
  /** 指定するとステータスで絞り込む（未指定は全件）。 */
  status?: string
  signal?: AbortSignal
}

export function fetchProjects(apiKey: string, options: ListOptions = {}): Promise<Project[]> {
  const query =
    options.status === undefined || options.status === ''
      ? ''
      : `?status=${encodeURIComponent(options.status)}`
  return apiRequest<Project[]>(`/projects${query}`, apiKey, { signal: options.signal })
}

export function fetchProject(
  apiKey: string,
  projectId: number,
  signal?: AbortSignal,
): Promise<Project> {
  return apiRequest<Project>(`/projects/${projectId}`, apiKey, { signal })
}

export function createProject(apiKey: string, input: ProjectInput): Promise<Project> {
  return apiRequest<Project>('/projects', apiKey, { method: 'POST', body: input })
}

export function updateProject(
  apiKey: string,
  projectId: number,
  input: ProjectInput,
): Promise<ProjectPatchResponse> {
  return apiRequest<ProjectPatchResponse>(`/projects/${projectId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteProject(apiKey: string, projectId: number): Promise<void> {
  return apiRequest<void>(`/projects/${projectId}`, apiKey, { method: 'DELETE' })
}
