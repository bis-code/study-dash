import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CurriculumService } from '../services/curriculum.js';
import type { QAService } from '../services/qa.js';
import type { VizService } from '../services/viz.js';
import type { ExerciseService } from '../services/exercises.js';
import type { ResourceService } from '../services/resources.js';

// ── Helpers ────────────────────────────────────────────────────────────────

export function writeJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function writeError(res: ServerResponse, status: number, message: string): void {
  writeJSON(res, { error: message }, status);
}

export function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function extractId(url: string, prefix: string): number | null {
  // e.g. prefix = "/api/topics/" -> extract "42" from "/api/topics/42" or "/api/topics/42/viz"
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const segment = rest.split('/')[0];
  const num = Number(segment);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// ── Route handlers ─────────────────────────────────────────────────────────

export function handleSubjects(curriculumSvc: CurriculumService) {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    const subjects = curriculumSvc.listSubjects();
    const result = subjects.map((s) => ({
      ...s,
      progress: curriculumSvc.getProgress(s.id),
    }));
    writeJSON(res, result);
  };
}

export function handlePhases(curriculumSvc: CurriculumService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = extractId(req.url ?? '', '/api/subjects/');
    if (id === null) {
      writeError(res, 400, 'Invalid subject ID');
      return;
    }
    const phases = curriculumSvc.getCurriculum(id);
    writeJSON(res, phases);
  };
}

export function handleTopic(curriculumSvc: CurriculumService, qaSvc: QAService, resourceSvc: ResourceService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = extractId(req.url ?? '', '/api/topics/');
    if (id === null) {
      writeError(res, 400, 'Invalid topic ID');
      return;
    }
    const topic = curriculumSvc.getTopic(id);
    if (!topic) {
      writeError(res, 404, 'Topic not found');
      return;
    }
    const entries = qaSvc.listEntries(id);
    const resources = resourceSvc.listForTopic(id);
    writeJSON(res, { ...topic, entries, resources });
  };
}

export function handleTopicResources(resourceSvc: ResourceService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = extractId(req.url ?? '', '/api/topics/');
    if (id === null) {
      writeError(res, 400, 'Invalid topic ID');
      return;
    }
    const resources = resourceSvc.listForTopic(id);
    writeJSON(res, resources);
  };
}

export function handleTopicViz(vizSvc: VizService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = extractId(req.url ?? '', '/api/topics/');
    if (id === null) {
      writeError(res, 400, 'Invalid topic ID');
      return;
    }
    const vizList = vizSvc.listForTopic(id);
    writeJSON(res, vizList);
  };
}

export function handleTopicExercises(exerciseSvc: ExerciseService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = extractId(req.url ?? '', '/api/topics/');
    if (id === null) {
      writeError(res, 400, 'Invalid topic ID');
      return;
    }
    const exercises = exerciseSvc.listForTopic(id);
    writeJSON(res, exercises);
  };
}

export function handleRunTests(exerciseSvc: ExerciseService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const id = extractId(req.url ?? '', '/api/exercises/');
    if (id === null) {
      writeError(res, 400, 'Invalid exercise ID');
      return;
    }
    try {
      const results = await exerciseSvc.runTests(id);
      writeJSON(res, results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeError(res, 500, msg);
    }
  };
}

export function handleSubmitQuiz(exerciseSvc: ExerciseService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const id = extractId(req.url ?? '', '/api/exercises/');
    if (id === null) {
      writeError(res, 400, 'Invalid exercise ID');
      return;
    }
    try {
      const body = (await parseBody(req)) as { answers: (number | boolean | string)[] };
      if (!Array.isArray(body?.answers)) {
        writeError(res, 400, 'Request body must have an "answers" array');
        return;
      }
      const result = exerciseSvc.submitQuiz(id, body.answers);
      writeJSON(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeError(res, 500, msg);
    }
  };
}

export function handleSearch(qaSvc: QAService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const query = url.searchParams.get('q') ?? '';
    if (!query) {
      writeJSON(res, []);
      return;
    }
    try {
      const results = qaSvc.search(query);
      writeJSON(res, results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeError(res, 500, msg);
    }
  };
}
