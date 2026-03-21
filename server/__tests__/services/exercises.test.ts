import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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
});
