import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExerciseService } from '../services/exercises.js';
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

export function registerExerciseTools(
  server: McpServer,
  svc: ExerciseService,
  sessions: Map<string, SessionState>,
  notify: () => void,
): void {
  // 1. learn_create_exercise
  server.tool(
    'learn_create_exercise',
    'Create an exercise (coding, quiz, project, assignment) for the active topic',
    {
      title: z.string().describe('Exercise title'),
      type: z.enum(['coding', 'quiz', 'project', 'assignment']).describe('Exercise type'),
      description: z.string().describe('Exercise description / instructions'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional().describe('Difficulty level'),
      est_minutes: z.number().optional().describe('Estimated time in minutes'),
      source: z.enum(['ai', 'pdf_import']).optional().describe('Source of the exercise'),
      starter_code: z.string().optional().describe('Starter code for coding/project exercises'),
      test_content: z.string().optional().describe('Test code for coding/project exercises'),
      quiz_json: z
        .string()
        .optional()
        .describe('JSON string of QuizPayload for quiz exercises'),
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json, session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      const exercise = svc.createExercise(session.topicId, {
        title,
        type,
        description,
        difficulty,
        est_minutes,
        source,
        starter_code,
        test_content,
        quiz_json,
      });

      notify();
      return ok(`Created exercise "${exercise.title}" (id=${exercise.id}, type=${exercise.type})`);
    },
  );

  // 2. learn_run_tests
  server.tool(
    'learn_run_tests',
    'Run tests for a coding/project exercise and return results',
    {
      exercise_id: z.number().describe('ID of the exercise to run tests for'),
    },
    async ({ exercise_id }) => {
      try {
        const results = await svc.runTests(exercise_id);
        notify();
        return ok(JSON.stringify(results, null, 2));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return err(`Failed to run tests: ${msg}`);
      }
    },
  );

  // 3. learn_get_exercises
  server.tool(
    'learn_get_exercises',
    'List all exercises for the active topic',
    {
      session_id: z.string().optional().describe('Session identifier (defaults to _default)'),
    },
    async ({ session_id }) => {
      const session = getSession(sessions, session_id);
      if (session.topicId === null) {
        return err('No active topic. Use learn_set_topic first.');
      }

      const exercises = svc.listForTopic(session.topicId);
      return ok(JSON.stringify(exercises, null, 2));
    },
  );
}
