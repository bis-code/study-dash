import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QAService } from '../services/qa.js';
import type { SessionState } from '../types.js';

function getSession(sessions: Map<string, SessionState>, sessionId?: string): SessionState {
  const key = sessionId || '_default';
  if (!sessions.has(key)) {
    sessions.set(key, { subjectId: null, topicId: null });
  }
  return sessions.get(key)!;
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerQATools(
  server: McpServer,
  svc: QAService,
  sessions: Map<string, SessionState>,
  notify: () => void,
): void {
  // 1. learn_log_question
  server.tool(
    'learn_log_question',
    'Log a question for the active topic',
    {
      content: z.string().describe('The question text'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ content, session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      const entry = svc.logEntry(session.topicId, 'question', content, session_id);
      notify();
      return ok(`Logged question (id=${entry.id})`);
    },
  );

  // 2. learn_log_answer
  server.tool(
    'learn_log_answer',
    'Log an answer or note for the active topic',
    {
      content: z.string().describe('The answer or note text'),
      question_id: z.number().optional().describe('ID of the question this answers (optional)'),
      kind: z.enum(['answer', 'note']).optional().describe('Entry kind: answer or note (defaults to answer)'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ content, question_id, kind, session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      const entryKind = kind ?? 'answer';
      const entry = svc.logEntry(session.topicId, entryKind, content, session_id, question_id);
      notify();
      return ok(`Logged ${entryKind} (id=${entry.id})`);
    },
  );

  // 3. learn_search
  server.tool(
    'learn_search',
    'Full-text search across all entries',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }) => {
      const results = svc.search(query);
      if (results.length === 0) {
        return ok('No results found.');
      }
      return ok(JSON.stringify(results, null, 2));
    },
  );
}
