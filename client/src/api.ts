import type { Avatar } from '../../shared/protocol.ts';

// ?profile=b → lưu phiên riêng, tiện thử 2 người trên cùng một trình duyệt
const profile = new URLSearchParams(location.search).get('profile');
const KEY = `toeic3d.token${profile ? `.${profile}` : ''}`;

export interface Me {
  id: string;
  name: string;
  tag: string;
  avatar: Avatar;
}

export const auth = {
  get token() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set token(v: string | null) {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch {
      /* chế độ riêng tư */
    }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Lỗi ${res.status}`);
  return json as T;
}
