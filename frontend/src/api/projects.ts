import { apiRequest } from './client'
import type { Project } from './types'

export function fetchProjects(apiKey: string, signal?: AbortSignal): Promise<Project[]> {
  return apiRequest<Project[]>('/projects', apiKey, { signal })
}
