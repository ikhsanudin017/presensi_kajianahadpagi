export async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await res.text().catch(() => "");
    console.error("Expected JSON response", {
      url: res.url,
      status: res.status,
      contentType,
      bodyPreview: body.slice(0, 200),
    });
    return null;
  }

  try {
    return (await res.json()) as T;
  } catch (error) {
    console.error("Failed to parse JSON", { url: res.url, status: res.status, error });
    return null;
  }
}
