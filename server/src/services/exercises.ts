import { execFile } from 'node:child_process';
import { readFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Database } from '../storage/db.js';
import { FileStore } from '../storage/files.js';
import type { Exercise, ExerciseResult, QuizPayload, Subject } from '../types.js';
import { getExtension, getTestCommand, getScaffoldFiles, getFileNames } from '../languages.js';

const execFileAsync = promisify(execFile);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

export interface ExerciseFiles {
  main: string;
  test: string;
  language: string;
  mainFile: string;
  testFile: string;
  filePath: string;
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
        const lang = subject.language.toLowerCase();
        const exerciseSlug = slugify(title);
        const { mainFile, testFile } = getFileNames(lang);

        const files: Record<string, string> = {};
        if (starter_code) files[mainFile] = starter_code;
        if (test_content) files[testFile] = test_content;
        files['README.md'] = `# ${title}\n\n${description}`;

        // Add scaffold files (go.mod, Cargo.toml, etc.)
        const scaffold = getScaffoldFiles(lang, subject.slug, exerciseSlug);
        Object.assign(files, scaffold);

        const filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, files);
        this.db.raw.prepare('UPDATE exercises SET file_path = ? WHERE id = ?').run(filePath, exerciseId);
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

    const lang = subject.language.toLowerCase();
    const config = getTestCommand(lang);
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

  listForTopicWithResults(topicId: number): (Exercise & { results: ExerciseResult[] })[] {
    const exercises = this.listForTopic(topicId);
    const getResults = this.db.raw.prepare<[number], ExerciseResult>(
      'SELECT * FROM exercise_results WHERE exercise_id = ? ORDER BY id ASC'
    );
    return exercises.map(ex => ({
      ...ex,
      results: getResults.all(ex.id),
    }));
  }

  getExerciseFiles(exerciseId: number): ExerciseFiles | undefined {
    const exercise = this.db.raw
      .prepare<[number], Exercise>('SELECT * FROM exercises WHERE id = ?')
      .get(exerciseId);
    if (!exercise) return undefined;

    const subject = this.getSubjectForTopic(exercise.topic_id);
    const lang = subject?.language.toLowerCase() ?? '';
    const { mainFile, testFile } = getFileNames(lang);

    let main = '';
    let test = '';
    if (exercise.file_path) {
      try { main = readFileSync(join(exercise.file_path, mainFile), 'utf-8'); } catch {}
      try { test = readFileSync(join(exercise.file_path, testFile), 'utf-8'); } catch {}
    }

    return { main, test, language: lang, mainFile, testFile, filePath: exercise.file_path || '' };
  }

  saveExerciseFiles(exerciseId: number, main: string, test: string): void {
    const exercise = this.db.raw
      .prepare<[number], Exercise>('SELECT * FROM exercises WHERE id = ?')
      .get(exerciseId);
    if (!exercise) throw new Error(`Exercise ${exerciseId} not found`);

    const subject = this.getSubjectForTopic(exercise.topic_id);
    if (!subject) throw new Error(`No subject found for exercise ${exerciseId}`);

    const lang = subject.language.toLowerCase();
    const { mainFile, testFile } = getFileNames(lang);

    let filePath = exercise.file_path;
    if (!filePath) {
      const exerciseSlug = slugify(exercise.title);
      filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, {});
      this.db.raw.prepare('UPDATE exercises SET file_path = ? WHERE id = ?').run(filePath, exerciseId);
    }

    // Add scaffold files if missing
    const scaffold = getScaffoldFiles(lang, subject.slug, slugify(exercise.title));
    for (const [name, content] of Object.entries(scaffold)) {
      const p = join(filePath, name);
      if (!existsSync(p)) writeFileSync(p, content, 'utf-8');
    }

    writeFileSync(join(filePath, mainFile), main, 'utf-8');
    writeFileSync(join(filePath, testFile), test, 'utf-8');
  }

  migrateFileExtensions(): number {
    const exercises = this.db.raw
      .prepare<[], Exercise>("SELECT * FROM exercises WHERE file_path != '' AND type IN ('coding', 'project')")
      .all();

    let migrated = 0;
    for (const exercise of exercises) {
      const subject = this.getSubjectForTopic(exercise.topic_id);
      if (!subject) continue;

      const ext = getExtension(subject.language.toLowerCase());
      if (ext === '.txt') continue;

      const dir = exercise.file_path;
      const mainTxt = join(dir, 'main.txt');
      const testTxt = join(dir, 'main_test.txt');
      const mainTarget = join(dir, `main${ext}`);
      const testTarget = join(dir, `main_test${ext}`);

      if (existsSync(mainTxt) && !existsSync(mainTarget)) {
        renameSync(mainTxt, mainTarget);
        migrated++;
      }
      if (existsSync(testTxt) && !existsSync(testTarget)) {
        renameSync(testTxt, testTarget);
        migrated++;
      }
    }
    return migrated;
  }

  getSubjectLanguage(topicId: number): string {
    const subject = this.getSubjectForTopic(topicId);
    return subject?.language ?? '';
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
