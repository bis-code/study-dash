import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VizService } from '../services/viz.js';
import type { SessionState, VizStep } from '../types.js';

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

export function registerVizTools(
  server: McpServer,
  svc: VizService,
  sessions: Map<string, SessionState>,
  notify: () => void,
): void {
  // 1. learn_create_viz
  server.tool(
    'learn_create_viz',
    'Create a step-by-step HTML visualization for the active topic',
    {
      title: z.string().describe('Title for the visualization'),
      steps: z
        .string()
        .describe('JSON array of steps, each with { html: string, description: string }'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ title, steps, session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      let parsedSteps: VizStep[];
      try {
        parsedSteps = JSON.parse(steps);
      } catch {
        return err('Invalid JSON in steps parameter');
      }

      if (!Array.isArray(parsedSteps)) {
        return err('steps must be a JSON array');
      }

      const viz = svc.create(session.topicId, title, parsedSteps);
      notify();
      return ok(`Created visualization "${viz.title}" (id=${viz.id})`);
    },
  );

  // 2. learn_get_viz
  server.tool(
    'learn_get_viz',
    'Get all visualizations for the active topic',
    {
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      const vizList = svc.listForTopic(session.topicId);
      return ok(JSON.stringify(vizList, null, 2));
    },
  );
}
