export async function triggerWorkflow(
  workflow: "listup" | "screening" | "monitoring",
  payload: Record<string, unknown> = {}
) {
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: workflow,
        client_payload: payload,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub dispatch 실패: ${res.status}`);
  }
}
