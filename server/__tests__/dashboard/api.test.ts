import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../../src/storage/db.js';
import { FileStore } from '../../src/storage/files.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ExerciseService } from '../../src/services/exercises.js';

describe('Exercise results join', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let svc: ExerciseService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    const tmpDir = mkdtempSync(join(tmpdir(), 'api-test-'));
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

  it('listForTopicWithResults includes exercise_results', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Test Results Join',
      type: 'coding',
      description: 'Test',
    });

    // Insert a fake result
    db.raw.prepare(
      'INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)'
    ).run(exercise.id, 'TestFoo', 1, 'ok');

    const list = svc.listForTopicWithResults(topicId);
    expect(list).toHaveLength(1);
    expect(list[0].results).toHaveLength(1);
    expect(list[0].results[0].test_name).toBe('TestFoo');
    expect(list[0].results[0].passed).toBe(1);
  });

  it('listForTopicWithResults returns empty results array when no results', () => {
    svc.createExercise(topicId, {
      title: 'No Results',
      type: 'coding',
      description: 'Test',
    });

    const list = svc.listForTopicWithResults(topicId);
    expect(list).toHaveLength(1);
    expect(list[0].results).toEqual([]);
  });
});
