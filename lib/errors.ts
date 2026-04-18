export function apiError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

export function notFound(resource: string) {
  return apiError(`${resource} not found`, 404);
}
