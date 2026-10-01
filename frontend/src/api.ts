import type { Lang } from './i18n';

export class ApiError extends Error {
  constructor(public status: number, public data: any) { super(data?.error ?? String(status)); }
}

/** Fired when the server says the login is gone (expired, signed out elsewhere, or account disabled). */
export const UNAUTHORIZED_EVENT = 'healtrip:unauthorized';

/** Every call is same-origin with the session cookie; the custom header is the CSRF guard the server requires. */
export async function call<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-HealTrip-CSRF': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: 'bad_response' }; }
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface Provider {
  id: string; type: 'doctor' | 'hospital'; name_en: string; name_ar: string; specialty: string; city: string;
  hospital_en: string; hospital_ar: string; languages: string[]; accepts_insurance: string[]; er_available: boolean;
  accepting_second_opinions: boolean; rating: number; phone: string; match_score?: number;
}
export interface User { id: string; email: string; name: string; picture?: string; role: 'user' | 'admin' }
export interface AuthConfig { googleClientId: string | null; devLogin: boolean }
export interface PublicConfig { auth: AuthConfig; emergencyNumber: string }
export interface Config extends PublicConfig {
  welcome: Record<Lang, string>; examples: Record<Lang, string[]>; departments: Record<string, Record<Lang, string>>;
  models: { key: string; label: string }[]; activeModel: string;
}
export interface Reply {
  reply: string; nextStep: string; urgency?: string; providers: Provider[];
  sources: { id: string; title: string; text: string }[];
  trace: { tool: string; ok: boolean; summary: string }[]; disclaimer: string; lang: Lang; model: { provider: string; id: string };
}
export interface ChatResponse extends Reply { conversationId: string; title: string; limitReached: boolean }
export interface Message { role: 'user' | 'assistant'; text: string; at: string; data?: Reply }
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; limitReached: boolean }

export const getConfig = () => call<PublicConfig | Config>('/api/config');
export const getMe = () => call<{ user: User | null }>('/api/auth/me');
export const logout = () => call('/api/auth/logout', 'POST');
export const getHealth = () => call<{ ok: boolean; llm?: string; provider?: string; model?: string; fallback?: boolean }>('/api/health');

export const listConversations = () => call<{ conversations: ConversationSummary[] }>('/api/conversations').then((r) => r.conversations);
export const getConversation = (id: string) => call<Conversation>('/api/conversations/' + encodeURIComponent(id));
export const renameConversation = (id: string, title: string) => call('/api/conversations/' + encodeURIComponent(id), 'PATCH', { title });
export const deleteConversation = (id: string) => call('/api/conversations/' + encodeURIComponent(id), 'DELETE');
export const deleteAllConversations = () => call<{ deleted: number }>('/api/conversations', 'DELETE');
export const sendMessage = (message: string, lang: Lang, conversationId?: string, model?: string) =>
  call<ChatResponse>('/api/chat', 'POST', { message, lang, conversationId, model: model || undefined });
