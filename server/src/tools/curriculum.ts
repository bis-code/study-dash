import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CurriculumService } from '../services/curriculum.js';
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

export function registerCurriculumTools(
  server: McpServer,
  svc: CurriculumService,
  sessions: Map<string, SessionState>,
  notify: () => void,
): void {
  // 1. learn_create_subject
  server.tool(
    'learn_create_subject',
    'Create a new subject to study',
    {
      name: z.string().describe('Subject name'),
      language: z.string().optional().describe('Programming language (optional)'),
      source: z.enum(['manual', 'roadmap', 'pdf']).optional().describe('Curriculum source'),
    },
    async ({ name, language, source }) => {
      const subject = svc.createSubject(name, language, source);
      notify();
      return ok(`Created subject "${subject.name}" (id=${subject.id}, slug=${subject.slug})`);
    },
  );

  // 2. learn_import_curriculum
  server.tool(
    'learn_import_curriculum',
    'Import a curriculum (phases + topics) for a subject from JSON',
    {
      subject_id: z.number().describe('Subject ID to import curriculum into'),
      phases_json: z.string().describe('JSON array of phases, each with name, description, and topics array'),
    },
    async ({ subject_id, phases_json }) => {
      let phases: unknown;
      try {
        phases = JSON.parse(phases_json);
      } catch {
        return err('Invalid JSON in phases_json');
      }
      if (!Array.isArray(phases)) {
        return err('phases_json must be a JSON array');
      }
      svc.importCurriculum(subject_id, phases as Parameters<CurriculumService['importCurriculum']>[1]);
      notify();
      return ok(`Imported ${phases.length} phase(s) into subject id=${subject_id}`);
    },
  );

  // 3. learn_switch_subject
  server.tool(
    'learn_switch_subject',
    'Switch the active subject for the session (by name or numeric ID)',
    {
      subject: z.string().describe('Subject name or numeric ID'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ subject, session_id }) => {
      const numId = Number(subject);
      let resolved = isNaN(numId)
        ? svc.findSubjectByName(subject)
        : svc.getSubject(numId) ?? svc.findSubjectByName(subject);

      if (!resolved) {
        return err(`Subject not found: "${subject}"`);
      }

      const session = getSession(sessions, session_id);
      session.subjectId = resolved.id;
      session.topicId = null;

      return ok(`Active subject: "${resolved.name}" (id=${resolved.id})`);
    },
  );

  // 4. learn_set_topic
  server.tool(
    'learn_set_topic',
    'Set the active topic for the session and mark it in_progress',
    {
      topic: z.string().describe('Topic name or numeric ID'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ topic, session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.subjectId === null) {
        return err('No active subject. Use learn_switch_subject first.');
      }

      const numId = Number(topic);
      let resolved = isNaN(numId)
        ? svc.findTopic(session.subjectId, topic)
        : svc.getTopic(numId) ?? svc.findTopic(session.subjectId, topic);

      if (!resolved) {
        return err(`Topic not found: "${topic}"`);
      }

      svc.setTopicStatus(resolved.id, 'in_progress');
      session.topicId = resolved.id;
      notify();

      return ok(`Active topic: "${resolved.name}" (id=${resolved.id}, status=in_progress)`);
    },
  );

  // 5. learn_mark_done
  server.tool(
    'learn_mark_done',
    'Mark a topic as done (defaults to the active session topic)',
    {
      topic: z.string().optional().describe('Topic name or numeric ID (uses session topic if omitted)'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ topic, session_id }) => {
      const session = getSession(sessions, session_id);

      let topicId: number | null = null;

      if (topic !== undefined) {
        const numId = Number(topic);
        const resolved = isNaN(numId)
          ? (session.subjectId !== null ? svc.findTopic(session.subjectId, topic) : undefined)
          : svc.getTopic(numId);
        if (!resolved) {
          return err(`Topic not found: "${topic}"`);
        }
        topicId = resolved.id;
      } else {
        topicId = session.topicId;
      }

      if (topicId === null) {
        return err('No topic specified and no active topic in session.');
      }

      const resolved = svc.getTopic(topicId);
      if (!resolved) {
        return err(`Topic id=${topicId} not found.`);
      }

      svc.setTopicStatus(topicId, 'done');
      notify();

      return ok(`Topic "${resolved.name}" marked as done.`);
    },
  );

  // 6. learn_get_progress
  server.tool(
    'learn_get_progress',
    'Get progress statistics for the active subject',
    {
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.subjectId === null) {
        return err('No active subject. Use learn_switch_subject first.');
      }
      const progress = svc.getProgress(session.subjectId);
      return ok(JSON.stringify(progress, null, 2));
    },
  );

  // 7. learn_get_curriculum
  server.tool(
    'learn_get_curriculum',
    'Get the full curriculum (phases + topics) for the active subject',
    {
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.subjectId === null) {
        return err('No active subject. Use learn_switch_subject first.');
      }
      const curriculum = svc.getCurriculum(session.subjectId);
      return ok(JSON.stringify(curriculum, null, 2));
    },
  );

  // 8. learn_list_subjects
  server.tool(
    'learn_list_subjects',
    'List all available subjects',
    {},
    async () => {
      const subjects = svc.listSubjects();
      if (subjects.length === 0) {
        return ok('No subjects found. Create one with learn_create_subject.');
      }
      return ok(JSON.stringify(subjects, null, 2));
    },
  );
}
