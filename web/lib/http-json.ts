export async function readJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;

  let detail = "";
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body?.error === "string") detail = `: ${body.error}`;
  } catch {
    // Error bodies are not guaranteed to be JSON.
  }
  throw new Error(`HTTP ${response.status}${detail}`);
}
