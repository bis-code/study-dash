import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/storage/db.js';
import { FileStore } from '../../src/storage/files.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ExerciseService } from '../../src/services/exercises.js';
import type { QuizPayload } from '../../src/types.js';

describe('ExerciseService', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let svc: ExerciseService;
  let topicId: number;
  let tmpDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'exercise-test-'));
    fileStore = new FileStore(tmpDir);
    curriculum = new CurriculumService(db);
    svc = new ExerciseService(db, fileStore);

    // Set up subject + topic
    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      {
        name: 'Phase 1',
        description: 'Basics',
        topics: [{ name: 'Variables', description: 'Go variables' }],
      },
    ]);
    const phase = curriculum.getCurriculum(subject.id)[0];
    topicId = phase.topics[0].id;
  });

  afterEach(() => {
    db.close();
  });

  it('createExercise — coding type: stores metadata in DB, returns Exercise with correct fields', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Hello World',
      type: 'coding',
      description: 'Write a hello world program',
      difficulty: 'easy',
      est_minutes: 10,
      source: 'ai',
    });

    expect(exercise.id).toBeGreaterThan(0);
    expect(exercise.topic_id).toBe(topicId);
    expect(exercise.title).toBe('Hello World');
    expect(exercise.type).toBe('coding');
    expect(exercise.description).toBe('Write a hello world program');
    expect(exercise.difficulty).toBe('easy');
    expect(exercise.est_minutes).toBe(10);
    expect(exercise.status).toBe('pending');
    expect(exercise.created_at).toBeTruthy();
  });

  it('createExercise — quiz type: stores quiz_json, returns Exercise', () => {
    const quizPayload: QuizPayload = {
      questions: [
        {
          id: 1,
          text: 'What is 2+2?',
          type: 'multiple_choice',
          options: ['3', '4', '5'],
          correct: 1,
          explanation: '2+2=4',
        },
        {
          id: 2,
          text: 'Go is statically typed',
          type: 'true_false',
          correct: true,
          explanation: 'Go is a statically typed language',
        },
      ],
    };

    const exercise = svc.createExercise(topicId, {
      title: 'Go Basics Quiz',
      type: 'quiz',
      description: 'Test your Go knowledge',
      quiz_json: JSON.stringify(quizPayload),
    });

    expect(exercise.id).toBeGreaterThan(0);
    expect(exercise.type).toBe('quiz');
    expect(exercise.quiz_json).toBeTruthy();
    const parsed: QuizPayload = JSON.parse(exercise.quiz_json);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[0].text).toBe('What is 2+2?');
  });

  it('submitQuiz — submits correct answers, gets score=1.0, exercise status=passed', () => {
    const quizPayload: QuizPayload = {
      questions: [
        {
          id: 1,
          text: 'What is 2+2?',
          type: 'multiple_choice',
          options: ['3', '4', '5'],
          correct: 1,
          explanation: '2+2=4',
        },
        {
          id: 2,
          text: 'Go is statically typed',
          type: 'true_false',
          correct: true,
          explanation: 'Yes',
        },
        {
          id: 3,
          text: 'What keyword declares a variable in Go?',
          type: 'fill_in',
          correct: 'var',
          explanation: 'var declares variables',
        },
      ],
    };

    const exercise = svc.createExercise(topicId, {
      title: 'Quiz All Correct',
      type: 'quiz',
      description: 'A quiz',
      quiz_json: JSON.stringify(quizPayload),
    });

    const result = svc.submitQuiz(exercise.id, [1, true, 'var']);

    expect(result.score).toBe(1.0);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.passed)).toBe(true);

    // Verify exercise status updated
    const updated = svc.listForTopic(topicId).find((e) => e.id === exercise.id);
    expect(updated?.status).toBe('passed');
  });

  it('submitQuiz — submits wrong answers, gets score<0.7, exercise status=failed', () => {
    const quizPayload: QuizPayload = {
      questions: [
        {
          id: 1,
          text: 'What is 2+2?',
          type: 'multiple_choice',
          options: ['3', '4', '5'],
          correct: 1,
          explanation: '2+2=4',
        },
        {
          id: 2,
          text: 'Go is dynamically typed',
          type: 'true_false',
          correct: false,
          explanation: 'Go is statically typed',
        },
        {
          id: 3,
          text: 'What keyword declares a variable?',
          type: 'fill_in',
          correct: 'var',
          explanation: 'var',
        },
      ],
    };

    const exercise = svc.createExercise(topicId, {
      title: 'Quiz Wrong',
      type: 'quiz',
      description: 'A quiz',
      quiz_json: JSON.stringify(quizPayload),
    });

    // All wrong answers
    const result = svc.submitQuiz(exercise.id, [0, true, 'let']);

    expect(result.score).toBeLessThan(0.7);
    expect(result.passed).toBe(false);

    const updated = svc.listForTopic(topicId).find((e) => e.id === exercise.id);
    expect(updated?.status).toBe('failed');
  });

  it('listForTopic — returns exercises for a topic', () => {
    svc.createExercise(topicId, {
      title: 'Exercise A',
      type: 'coding',
      description: 'First',
    });
    svc.createExercise(topicId, {
      title: 'Exercise B',
      type: 'quiz',
      description: 'Second',
    });

    const list = svc.listForTopic(topicId);

    expect(list).toHaveLength(2);
    expect(list.map((e) => e.title)).toContain('Exercise A');
    expect(list.map((e) => e.title)).toContain('Exercise B');
  });

  it('createExercise — coding type with starter_code and test_content: writes files to FileStore temp dir', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Hello Files',
      type: 'coding',
      description: 'Write hello world',
      starter_code: 'package main\n\nfunc main() {}',
      test_content: 'package main\n\nimport "testing"\n\nfunc TestMain(t *testing.T) {}',
    });

    expect(exercise.file_path).toBeTruthy();
    expect(existsSync(exercise.file_path)).toBe(true);
    expect(existsSync(join(exercise.file_path, 'main.go'))).toBe(true);
    expect(existsSync(join(exercise.file_path, 'main_test.go'))).toBe(true);
    expect(existsSync(join(exercise.file_path, 'README.md'))).toBe(true);

    const starterContent = readFileSync(join(exercise.file_path, 'main.go'), 'utf-8');
    expect(starterContent).toBe('package main\n\nfunc main() {}');

    const testContent = readFileSync(join(exercise.file_path, 'main_test.go'), 'utf-8');
    expect(testContent).toBe('package main\n\nimport "testing"\n\nfunc TestMain(t *testing.T) {}');

    const readme = readFileSync(join(exercise.file_path, 'README.md'), 'utf-8');
    expect(readme).toContain('Write hello world');
  });

  it('getExerciseFiles — returns file contents and metadata for a coding exercise', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'File Reader Test',
      type: 'coding',
      description: 'Test reading files',
      starter_code: 'package main\n\nfunc Hello() string { return "hello" }',
      test_content: 'package main\n\nimport "testing"\n\nfunc TestHello(t *testing.T) {}',
    });

    const files = svc.getExerciseFiles(exercise.id);
    expect(files).toBeDefined();
    expect(files!.main).toContain('func Hello()');
    expect(files!.test).toContain('TestHello');
    expect(files!.language).toBe('go');
    expect(files!.mainFile).toBe('main.go');
    expect(files!.testFile).toBe('main_test.go');
  });

  it('getExerciseFiles — returns empty strings when files do not exist on disk', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'No Files',
      type: 'coding',
      description: 'No starter code',
    });
    const files = svc.getExerciseFiles(exercise.id);
    expect(files).toBeDefined();
    expect(files!.main).toBe('');
    expect(files!.test).toBe('');
  });

  it('getExerciseFiles — returns undefined for non-existent exercise', () => {
    expect(svc.getExerciseFiles(99999)).toBeUndefined();
  });

  it('saveExerciseFiles — writes content to disk files', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Save Test',
      type: 'coding',
      description: 'Test saving files',
      starter_code: 'package main',
      test_content: 'package main',
    });

    svc.saveExerciseFiles(exercise.id, 'package main\n\nfunc Updated() {}', 'package main\n\nfunc TestUpdated(t *testing.T) {}');

    const files = svc.getExerciseFiles(exercise.id);
    expect(files!.main).toContain('func Updated()');
    expect(files!.test).toContain('TestUpdated');
  });

  it('saveExerciseFiles — creates directory for exercise without file_path', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'No Path Exercise',
      type: 'coding',
      description: 'Has no file_path initially',
    });
    expect(exercise.file_path).toBe('');

    svc.saveExerciseFiles(exercise.id, 'package main\n\nfunc New() {}', 'package main\n\nfunc TestNew(t *testing.T) {}');

    const files = svc.getExerciseFiles(exercise.id);
    expect(files!.main).toContain('func New()');

    const updated = svc.listForTopic(topicId).find(e => e.id === exercise.id);
    expect(updated!.file_path).toBeTruthy();
  });

  it('migrateFileExtensions — renames .txt files to correct language extension', () => {
    const exerciseSlug = 'migrate-test';
    const dir = fileStore.writeExerciseFiles('go', exerciseSlug, {
      'main.txt': 'package main\n\nfunc Migrate() {}',
      'main_test.txt': 'package main\n\nimport "testing"\n\nfunc TestMigrate(t *testing.T) {}',
      'README.md': '# Migrate Test',
    });

    db.raw.prepare(
      'INSERT INTO exercises (topic_id, title, type, description, file_path) VALUES (?, ?, ?, ?, ?)'
    ).run(topicId, 'Migrate Test', 'coding', 'Test migration', dir);

    const count = svc.migrateFileExtensions();
    expect(count).toBe(2);
    expect(existsSync(join(dir, 'main.go'))).toBe(true);
    expect(existsSync(join(dir, 'main_test.go'))).toBe(true);
    expect(existsSync(join(dir, 'main.txt'))).toBe(false);
    expect(existsSync(join(dir, 'main_test.txt'))).toBe(false);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
  });

  it('createExercise — Go coding type: creates go.mod in exercise directory', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Go Mod Test',
      type: 'coding',
      description: 'Test go.mod creation',
      starter_code: 'package main\n\nfunc Hello() string { return "hello" }',
      test_content: 'package main\n\nimport "testing"\n\nfunc TestHello(t *testing.T) {\n\tif Hello() != "hello" { t.Fatal("wrong") }\n}',
    });

    expect(exercise.file_path).toBeTruthy();
    expect(existsSync(join(exercise.file_path, 'go.mod'))).toBe(true);
    const goMod = readFileSync(join(exercise.file_path, 'go.mod'), 'utf-8');
    expect(goMod).toContain('module');
    expect(goMod).toContain('go 1.21');
  });

  it('createExercise — Python coding type: uses test_main.py naming convention', () => {
    const subject = curriculum.createSubject('Python Basics', 'python', 'manual');
    curriculum.importCurriculum(subject.id, [
      { name: 'P1', description: '', topics: [{ name: 'Functions', description: '' }] },
    ]);
    const pyTopicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;

    const exercise = svc.createExercise(pyTopicId, {
      title: 'Add Numbers',
      type: 'coding',
      description: 'Add two numbers',
      starter_code: 'def add(a, b):\n    pass',
      test_content: 'from main import add\n\ndef test_add():\n    assert add(1, 2) == 3',
    });

    expect(exercise.file_path).toBeTruthy();
    expect(existsSync(join(exercise.file_path, 'main.py'))).toBe(true);
    expect(existsSync(join(exercise.file_path, 'test_main.py'))).toBe(true);
    expect(existsSync(join(exercise.file_path, 'main_test.py'))).toBe(false);
  });

  it('createExercise — language with mixed case: writes files with correct extension', () => {
    // Regression: subjects created with "Go" (capitalized) caused .txt extensions
    const subject = curriculum.createSubject('Python Prep', 'Python', 'manual');
    curriculum.importCurriculum(subject.id, [
      {
        name: 'Phase 1',
        description: 'Basics',
        topics: [{ name: 'Lists', description: 'Python lists' }],
      },
    ]);
    const phase = curriculum.getCurriculum(subject.id)[0];
    const pyTopicId = phase.topics[0].id;

    const exercise = svc.createExercise(pyTopicId, {
      title: 'List Reversal',
      type: 'coding',
      description: 'Reverse a list',
      starter_code: 'def reverse_list(lst):\n    pass',
      test_content: 'from main import reverse_list\n\ndef test_reverse():\n    assert reverse_list([1,2,3]) == [3,2,1]',
    });

    expect(exercise.file_path).toBeTruthy();
    expect(existsSync(join(exercise.file_path, 'main.py'))).toBe(true);
    expect(existsSync(join(exercise.file_path, 'test_main.py'))).toBe(true);
    // Should NOT create .txt files
    expect(existsSync(join(exercise.file_path, 'main.txt'))).toBe(false);
  });
});
