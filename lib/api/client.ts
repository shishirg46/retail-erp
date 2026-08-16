// Typed same-origin API client (D22.5).
//
// The ERP is a single-origin JSON API (F-11 no-CORS): every call is a plain
// same-origin fetch and the session cookie (D9.5) flows automatically. Errors
// surface the API's `{ message }` contract (sanitized, F-03) as ApiError so
// the UI can show the exact server text inline (D21.8).

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// 401 from the API means the session died — the UI redirects to /sign-in
// (D22.7). 429 is the per-user rate limit (F-08).
export function isAuthLostError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isRateLimitedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path, window.location.origin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;

  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      message = body.message;
    }
  } catch {
    // Non-JSON error body: keep the fallback message.
  }

  return new ApiError(response.status, message);
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { params?: Record<string, string | undefined>; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(buildUrl(path, options.params), {
    method,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    return request<T>("GET", path, { params });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("POST", path, { body });
  },
};
