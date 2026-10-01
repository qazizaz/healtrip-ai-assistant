import { randomUUID } from 'node:crypto';
import type { RedFlag } from './triage/redFlags.js';
import type { AssessResult } from './triage/assess.js';

/** Agent working state for one conversation. Persisted (as SessionState) with the conversation it belongs to. */
export interface Session {
  id: string;
  messages: any[];                 // provider-format conversation (Anthropic message shape)
  pendingToolResults: any[];       // tool_results owed to the provider before the next user text
  userText: string;                // concatenated patient text, used for deterministic red-flag screening
  redFlags: Set<RedFlag>;
  assessment?: AssessResult;
  seenProviderIds: Set<string>;    // ids returned by search_providers: the ONLY ids the agent may recommend
  seenGuidanceIds: Set<string>;    // guidance passages retrieved this session: the only ones the agent may cite
  turns: number;
}

/** JSON-safe form of Session (Sets become arrays). */
export interface SessionState {
  messages: any[]; pendingToolResults: any[]; userText: string; redFlags: RedFlag[]; assessment?: AssessResult;
  seenProviderIds: string[]; seenGuidanceIds: string[]; turns: number;
}

export function newSession(id: string = randomUUID()): Session {
  return { id, messages: [], pendingToolResults: [], userText: '', redFlags: new Set(), seenProviderIds: new Set(), seenGuidanceIds: new Set(), turns: 0 };
}
/** Kept for tests and the eval harness. */
export const getOrCreateSession = () => newSession();

export function toState(s: Session): SessionState {
  return {
    messages: s.messages, pendingToolResults: s.pendingToolResults, userText: s.userText, redFlags: [...s.redFlags],
    assessment: s.assessment, seenProviderIds: [...s.seenProviderIds], seenGuidanceIds: [...s.seenGuidanceIds], turns: s.turns,
  };
}
export function fromState(id: string, st?: SessionState): Session {
  if (!st) return newSession(id);
  return {
    id, messages: structuredClone(st.messages ?? []), pendingToolResults: structuredClone(st.pendingToolResults ?? []), userText: st.userText ?? '',
    redFlags: new Set(st.redFlags ?? []), assessment: st.assessment, seenProviderIds: new Set(st.seenProviderIds ?? []),
    seenGuidanceIds: new Set(st.seenGuidanceIds ?? []), turns: st.turns ?? 0,
  };
}
