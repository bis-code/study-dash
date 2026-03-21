import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Database } from '../storage/db.js';
import { FileStore } from '../storage/files.js';
import type { Exercise, ExerciseResult, QuizPayload, Subject } from '../types.js';

const execFileAsync = promisify(execFile);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extensionForLanguage(language: string): string {
  switch (language) {
    case 'go':
      return '.go';
    case 'python':
      return '.py';
    case 'rust':
      return '.rs';
    case 'javascript':
    case 'typescript':
      return '.ts';
    default:
      return '.txt';
  }
}

interface CreateExerciseData {
  title: string;
  type: Exercise['type'];
  description: string;
  difficulty?: Exercise['difficulty'];
  est_minutes?: number;
  source?: Exercise['source'];
  starter_code?: string;
  test_content?: string;
  quiz_json?: string;
}

interface QuizSubmitResult {
  score: number;
  total: number;
  passed: boolean;
  results: Array<{ test_name: string; passed: boolean; output: string }>;
}

export class ExerciseService {
  constructor(
    private db: Database,
    private fileStore: FileStore,
  ) {}

  createExercise(topicId: number, data: CreateExerciseData): Exercise {
    const {
      title,
      type,
      description,
      difficulty = 'medium',
      est_minutes = 0,
      source = 'ai',
      starter_code = '',
      test_content = '',
      quiz_json = '{}',
    } = data;

    const result = this.db.raw
      .prepare<
        [number, string, string, string, string, number, string, string, string, string],
        { id: number }
      >(
        `INSERT INTO exercises
         (topic_id, title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(topicId, title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json);

    const exerciseId = result!.id;

    // Write files for coding/project exercises with starter code
    if ((type === 'coding' || type === 'project') && (starter_code || test_content)) {
      const subject = this.getSubjectForTopic(topicId);
      if (subject) {
        const exerciseSlug = slugify(title);
        const ext = extensionForLanguage(subject.language);

        const files: Record<string, string> = {};
        if (starter_code) {
          files[`main${ext}`] = starter_code;
        }
        if (test_content) {
          files[`main_test${ext}`] = test_content;
        }
        files['README.md'] = `# ${title}\n\n${description}`;

        const filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, files);

        this.db.raw
          .prepare('UPDATE exercises SET file_path = ? WHERE id = ?')
          .run(filePath, exerciseId);
      }
    }

    return this.db.raw
      .prepare<[number], Exercise>('SELECT * FROM exercises WHERE id = ?')
      .get(exerciseId)!;
  }

  async runTests(exerciseId: number): Promise<ExerciseResult[]> {
    const exercise = this.db.raw
      .prepare<[number], Exercise>('SELECT * FROM exercises WHERE id = ?')
      .get(exerciseId);

    if (!exercise) throw new Error(`Exercise ${exerciseId} not found`);
    if (!exercise.file_path) throw new Error(`Exercise ${exerciseId} has no file_path`);

    const subject = this.getSubjectForTopic(exercise.topic_id);
    if (!subject) throw new Error(`No subject found for exercise ${exerciseId}`);

    const commandMap: Record<string, { command: string; args: string[] }> = {
      go: { command: 'go', args: ['test', '-json', '-count=1', './...'] },
      python: { command: 'python3', args: ['-m', 'pytest', '--tb=short', '-q', '.'] },
      rust: { command: 'cargo', args: ['test'] },
      javascript: { command: 'npx', args: ['vitest', 'run'] },
      typescript: { command: 'npx', args: ['vitest', 'run'] },
    };

    const config = commandMap[subject.language];
    if (!config) throw new Error(`Unsupported language: ${subject.language}`);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      const result = await execFileAsync(config.command, config.args, {
        cwd: exercise.file_path,
        timeout: 60_000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      stdout = execErr.stdout ?? '';
      stderr = execErr.stderr ?? '';
      exitCode = execErr.code ?? 1;
    }

    // Parse results
    const results: Array<{ test_name: string; passed: boolean; output: string }> = [];

    if (subject.language === 'go') {
      // Parse Go JSON test output
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.Action === 'pass' && event.Test) {
            results.push({ test_name: event.Test, passed: true, output: '' });
          } else if (event.Action === 'fail' && event.Test) {
            results.push({ test_name: event.Test, passed: false, output: event.Output ?? '' });
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    // Fallback: if no per-test results parsed, use overall result
    if (results.length === 0) {
      results.push({
        test_name: 'all',
        passed: exitCode === 0,
        output: stdout + stderr,
      });
    }

    // Clear old results
    this.db.raw
      .prepare('DELETE FROM exercise_results WHERE exercise_id = ?')
      .run(exerciseId);

    // Insert new results
    const insertResult = this.db.raw.prepare(
      'INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)',
    );

    for (const r of results) {
      insertResult.run(exerciseId, r.test_name, r.passed ? 1 : 0, r.output);
    }

    // Update exercise status
    const allPassed = results.every((r) => r.passed);
    this.db.raw
      .prepare('UPDATE exercises SET status = ? WHERE id = ?')
      .run(allPassed ? 'passed' : 'failed', exerciseId);

    return this.db.raw
      .prepare<[number], ExerciseResult>('SELECT * FROM exercise_results WHERE exercise_id = ?')
      .all(exerciseId);
  }

  submitQuiz(exerciseId: number, answers: (number | boolean | string)[]): QuizSubmitResult {
    const exercise = this.db.raw
      .prepare<[number], Exercise>('SELECT * FROM exercises WHERE id = ?')
      .get(exerciseId);

    if (!exercise) throw new Error(`Exercise ${exerciseId} not found`);

    const payload: QuizPayload = JSON.parse(exercise.quiz_json);
    const questions = payload.questions;

    let correct = 0;
    const results: Array<{ test_name: string; passed: boolean; output: string }> = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const answer = answers[i];
      let isCorrect = false;

      switch (q.type) {
        case 'multiple_choice':
          isCorrect = answer === q.correct;
          break;
        case 'true_false':
          isCorrect = answer === q.correct;
          break;
        case 'fill_in':
          isCorrect =
            String(answer).toLowerCase().trim() === String(q.correct).toLowerCase().trim();
          break;
      }

      if (isCorrect) correct++;

      results.push({
        test_name: `Q${i + 1}: ${q.text}`,
        passed: isCorrect,
        output: isCorrect ? 'Correct' : `Wrong. Expected: ${q.correct}, Got: ${answer}`,
      });
    }

    const score = questions.length > 0 ? correct / questions.length : 0;
    const passed = score >= 0.7;

    // Clear old results
    this.db.raw
      .prepare('DELETE FROM exercise_results WHERE exercise_id = ?')
      .run(exerciseId);

    // Insert per-question results
    const insertResult = this.db.raw.prepare(
      'INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)',
    );

    for (const r of results) {
      insertResult.run(exerciseId, r.test_name, r.passed ? 1 : 0, r.output);
    }

    // Update exercise status
    this.db.raw
      .prepare('UPDATE exercises SET status = ? WHERE id = ?')
      .run(passed ? 'passed' : 'failed', exerciseId);

    return { score, total: questions.length, passed, results };
  }

  listForTopic(topicId: number): Exercise[] {
    return this.db.raw
      .prepare<[number], Exercise>(
        'SELECT * FROM exercises WHERE topic_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(topicId);
  }

  private getSubjectForTopic(topicId: number): Subject | undefined {
    return this.db.raw
      .prepare<[number], Subject>(
        `SELECT s.* FROM subjects s
         JOIN phases p ON p.subject_id = s.id
         JOIN topics t ON t.phase_id = p.id
         WHERE t.id = ?`,
      )
      .get(topicId);
  }
}
