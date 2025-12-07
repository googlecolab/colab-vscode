// Simple helper functions to upload/download text files to a Colab runtime via
// the runtime proxy (Jupyter Contents API).
//
// Notes:
// - Adjust the Authorization header if this repo uses a different header for the
//   runtimeProxyInfo.token (check src/colab/headers.ts or existing requests in
//   src/colab/client.ts).
// - The extension environment may or may not have global fetch; if not, import
//   a fetch polyfill (node-fetch) the project already uses.

export interface RuntimeProxyInfo {
  url: string;
  token: string;
}

/**
 * Upload (create or overwrite) a text file at `targetPath` inside the Colab VM.
 * targetPath should be an absolute path in the Colab VM (e.g. "/content/my.py")
 */
export async function uploadTextFile(
  runtime: RuntimeProxyInfo,
  targetPath: string,
  content: string
): Promise<any> {
  const base = runtime.url.replace(/\/$/, "");
  // Jupyter contents API: PUT /api/contents/<path>
  // Ensure the path is URL-encoded and doesn't duplicate slashes.
  const apiPath = `${base}/api/contents${targetPath.startsWith("/") ? targetPath : "/" + targetPath}`;
  const body = {
    type: "file",
    format: "text",
    content,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Common pattern: Bearer token. If this repo uses a different header,
    // change this to match (see src/colab/headers.ts).
    Authorization: `Bearer ${runtime.token}`,
  };

  const res = await fetch(apiPath, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/**
 * Download a text file from `targetPath` inside the Colab VM.
 * Returns the file content as a string.
 */
export async function downloadTextFile(
  runtime: RuntimeProxyInfo,
  targetPath: string
): Promise<string> {
  const base = runtime.url.replace(/\/$/, "");
  const apiPath = `${base}/api/contents${targetPath.startsWith("/") ? targetPath : "/" + targetPath}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${runtime.token}`,
  };

  const res = await fetch(apiPath, { method: "GET", headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed ${res.status} ${res.statusText}: ${text}`);
  }

  const j = await res.json();
  // Jupyter Contents API returns { content, format, type, ... }
  // If format is "text" then content is the text. If it's base64, adjust.
  if (j.format === "text" && typeof j.content === "string") {
    return j.content;
  }
  if (j.format === "base64" && typeof j.content === "string") {
    // decode base64
    return Buffer.from(j.content, "base64").toString("utf8");
  }
  // Otherwise, throw or stringify
  throw new Error("Unexpected content format from Colab contents API");
}
