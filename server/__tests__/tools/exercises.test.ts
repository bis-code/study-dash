import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../../src/storage/db.js';
import { FileStore } from '../../src/storage/files.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ExerciseService } from '../../src/services/exercises.js';
import type { QuizPayload } from '../../src/types.js';

describe('Exercise MCP tool backing methods', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let svc: ExerciseService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    const tmpDir = mkdtempSync(join(tmpdir(), 'tool-test-'));
    fileStore = new FileStore(tmpDir);
    curriculum = new CurriculumService(db);
    svc = new ExerciseService(db, fileStore);

    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      { name: 'P1', description: '', topics: [{ name: 'T1', description: '' }] },
    ]);
    topicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;
  });

  afterEach(() => { db.close(); });

  it('submitQuiz — correct answers return passed=true', () => {
    const quiz: QuizPayload = {
      questions: [
        { id: 1, text: 'Q1', type: 'multiple_choice', options: ['A', 'B'], correct: 0, explanation: 'A' },
      ],
    };
    const ex = svc.createExercise(topicId, {
      title: 'Quiz',
      type: 'quiz',
      description: 'Test',
      quiz_json: JSON.stringify(quiz),
    });

    const result = svc.submitQuiz(ex.id, [0]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('getExerciseFiles + saveExerciseFiles round-trip', () => {
    const ex = svc.createExercise(topicId, {
      title: 'Round Trip',
      type: 'coding',
      description: 'Test',
      starter_code: 'package main',
      test_content: 'package main',
    });

    svc.saveExerciseFiles(ex.id, 'package main\n\nfunc Updated() {}', 'package main\n\nfunc TestUpdated(t *testing.T) {}');

    const files = svc.getExerciseFiles(ex.id);
    expect(files).toBeDefined();
    expect(files!.main).toContain('Updated');
    expect(files!.test).toContain('TestUpdated');
  });
});
