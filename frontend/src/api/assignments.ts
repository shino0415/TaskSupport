import { apiRequest } from './client'
import type { Assignment, AssignmentInput, AssignmentPatchResponse } from './types'

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
