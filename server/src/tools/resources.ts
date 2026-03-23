import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResourceService } from '../services/resources.js';
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

export function registerResourceTools(
  server: McpServer,
  svc: ResourceService,
  sessions: Map<string, SessionState>,
  notify: () => void,
): void {
  // 1. learn_add_resource
  server.tool(
    'learn_add_resource',
    'Add a reference link to the active topic (or a specific topic by ID)',
    {
      title: z.string().describe('Resource title'),
      url: z.string().describe('Resource URL'),
      topic_id: z.number().optional().describe('Topic ID (defaults to active topic)'),
      session_id: z.string().optional(),
    },
    async ({ title, url, topic_id, session_id }) => {
      const tid = topic_id ?? getSession(sessions, session_id).topicId;
      if (tid === null) {
        return err('No active topic. Use learn_set_topic first or provide topic_id.');
      }
      const resource = svc.addResource(tid, title, url, 'manual');
      notify();
      return ok(`Added resource "${resource.title}" (id=${resource.id}) to topic ${tid}`);
    },
  );

  // 2. learn_import_resources
  server.tool(
    'learn_import_resources',
    'Bulk import resource links from a JSON array of {topic_id, title, url} objects',
    {
      resources_json: z.string().describe('JSON array of {topic_id: number, title: string, url: string}'),
    },
    async ({ resources_json }) => {
      let resources: Array<{ topic_id: number; title: string; url: string }>;
      try {
        resources = JSON.parse(resources_json);
      } catch {
        return err('Invalid JSON');
      }
      if (!Array.isArray(resources)) {
        return err('Expected a JSON array');
      }
      const count = svc.importResources(resources);
      notify();
      return ok(`Imported ${count} resources`);
    },
  );
}
