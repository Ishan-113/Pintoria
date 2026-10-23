export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

const ACCESS_KEY = 'pt.access';
const REFRESH_KEY = 'pt.refresh';

export function storeTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function refreshDot(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      storeTokens(body.accessToken, body.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** One fetch entry point: base URL, bearer token, one-shot refresh, typed errors. */
export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const doFetch = async (): Promise<Response> =>
    fetch(`/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${localStorage.getItem(ACCESS_KEY) ?? ''}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch();
  }

  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({ code: 'ERROR', message: 'No response body.' }))) as
    | (T & { code?: string })
    | ApiError;

  if (!res.ok) {
    const err = json as ApiError;
    throw {
      status: res.status,
      code: err.code ?? 'ERROR',
      message: err.message ?? 'Request failed.',
      details: err.details,
      logout: res.status === 401,
    } satisfies ApiError & { status: number; logout: boolean };
  }
  return json as T;
}

/** Multipart upload — same auth/refresh/error semantics as api() but raw FormData. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const doFetch = () =>
    fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem(ACCESS_KEY) ?? ''}` },
      body: form,
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch();
  }
  const json = (await res.json().catch(() => ({ code: 'ERROR', message: 'No response body.' }))) as
    | (T & { code?: string })
    | ApiError;
  if (!res.ok) {
    const err = json as ApiError;
    throw {
      status: res.status,
      code: err.code ?? 'ERROR',
      message: err.message ?? 'Upload failed.',
      details: err.details,
      logout: res.status === 401,
    };
  }
  return json as T;
}

/** Authenticated binary download (fetch + save-as) for stored artifacts. */
export async function apiDownload(
  path: string,
  saveName: string,
  onFail: (message: string) => void,
): Promise<void> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(ACCESS_KEY) ?? ''}` },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiError | null;
      onFail(err?.message ?? `Download failed (HTTP ${res.status}).`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = saveName;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    onFail('Network error during download.');
  }
}
