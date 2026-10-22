import { apiRequest } from './client'
import type {
  Assignment,
  AssignmentInput,
  AssignmentPatchResponse,
  UpcomingAssignment,
} from './types'

export function fetchAssignments(
  apiKey: string,
  courseId: number,
  signal?: AbortSignal,
): Promise<Assignment[]> {
  return apiRequest<Assignment[]>(`/courses/${courseId}/assignments`, apiKey, { signal })
}

export function createAssignment(
  apiKey: string,
  courseId: number,
  input: AssignmentInput,
): Promise<Assignment> {
  return apiRequest<Assignment>(`/courses/${courseId}/assignments`, apiKey, {
    method: 'POST',
    body: input,
  })
}

export function updateAssignment(
  apiKey: string,
  assignmentId: number,
  input: AssignmentInput,
): Promise<AssignmentPatchResponse> {
  return apiRequest<AssignmentPatchResponse>(`/assignments/${assignmentId}`, apiKey, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteAssignment(apiKey: string, assignmentId: number): Promise<void> {
  return apiRequest<void>(`/assignments/${assignmentId}`, apiKey, { method: 'DELETE' })
}

/** 締切が近い課題（提出済み・期限なしを除き、期限切れを含めて期限の早い順）を授業横断で取得する。 */
export function fetchUpcomingAssignments(
  apiKey: string,
  signal?: AbortSignal,
): Promise<UpcomingAssignment[]> {
  return apiRequest<UpcomingAssignment[]>('/assignments/upcoming', apiKey, { signal })
}
