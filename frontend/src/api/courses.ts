import { apiRequest } from './client'
import type { Course, CourseInput } from './types'

export function fetchCourses(apiKey: string, signal?: AbortSignal): Promise<Course[]> {
  return apiRequest<Course[]>('/courses', apiKey, { signal })
}

export function createCourse(apiKey: string, input: CourseInput): Promise<Course> {
  return apiRequest<Course>('/courses', apiKey, { method: 'POST', body: input })
}

export function updateCourse(apiKey: string, courseId: number, input: CourseInput): Promise<Course> {
  return apiRequest<Course>(`/courses/${courseId}`, apiKey, { method: 'PATCH', body: input })
}

export function deleteCourse(apiKey: string, courseId: number): Promise<void> {
  return apiRequest<void>(`/courses/${courseId}`, apiKey, { method: 'DELETE' })
}
