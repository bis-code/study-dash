import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../src/storage/db.js';
import { FileStore } from '../src/storage/files.js';
import { CurriculumService } from '../src/services/curriculum.js';
import { QAService } from '../src/services/qa.js';
import { VizService } from '../src/services/viz.js';
import { ExerciseService } from '../src/services/exercises.js';

describe('Integration: full learning flow', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let qa: QAService;
  let viz: VizService;
  let exercises: ExerciseService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'studydash-test-'));
    db = new Database(':memory:');
    fileStore = new FileStore(tmpDir);
    curriculum = new CurriculumService(db);
    qa = new QAService(db);
    viz = new VizService(db);
    exercises = new ExerciseService(db, fileStore);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('complete learning lifecycle', () => {
    // 1. Create subject
    const subject = curriculum.createSubject('Go', 'go', 'roadmap');
    expect(subject.slug).toBe('go');

    // 2. Import curriculum
    curriculum.importCurriculum(subject.id, [
      { name: 'Phase 1: Fundamentals', description: 'Core Go', topics: [
        { name: 'Error Handling', description: 'errors.Is, errors.As' },
        { name: 'Generics', description: 'type params' },
      ]},
      { name: 'Phase 2: Patterns', description: 'Design patterns', topics: [
        { name: 'Strategy Pattern', description: 'interfaces' },
        { name: 'Factory Pattern', description: 'constructors' },
      ]},
    ]);

    // 3. Verify progress
    let progress = curriculum.getProgress(subject.id);
    expect(progress.total_topics).toBe(4);
    expect(progress.done).toBe(0);
    expect(progress.todo).toBe(4);

    // 4. Start a topic
    const tree = curriculum.getCurriculum(subject.id);
    const errorHandlingTopic = tree[0].topics[0];
    curriculum.setTopicStatus(errorHandlingTopic.id, 'in_progress');

    // 5. Log Q&A
    const question = qa.logEntry(errorHandlingTopic.id, 'question', 'What is errors.Is?');
    const answer = qa.logEntry(errorHandlingTopic.id, 'answer', 'errors.Is unwraps the error chain and compares.', '', question.id);
    expect(answer.question_id).toBe(question.id);

    // 6. Search
    const results = qa.search('unwraps');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('unwraps');

    // 7. Create visualization
    const v = viz.create(errorHandlingTopic.id, 'Error Chain', [
      { html: '<div class="viz-box box-blue">err</div>', description: 'Start with error' },
      { html: '<div class="viz-box box-green">unwrap</div>', description: 'Unwrap chain' },
    ]);
    expect(v.title).toBe('Error Chain');

    // 8. List viz
    const vizList = viz.listForTopic(errorHandlingTopic.id);
    expect(vizList).toHaveLength(1);

    // 9. Create coding exercise
    const codingEx = exercises.createExercise(errorHandlingTopic.id, {
      title: 'Custom Error Type',
      type: 'coding',
      description: 'Implement a custom error type',
      difficulty: 'medium',
      starter_code: 'package main\n\n// TODO: implement',
      test_content: 'package main\n\nimport "testing"\n\nfunc TestCustomError(t *testing.T) {}',
    });
    expect(codingEx.type).toBe('coding');
    expect(codingEx.file_path).toBeTruthy();

    // 10. Create quiz exercise
    const quizEx = exercises.createExercise(errorHandlingTopic.id, {
      title: 'Error Handling Quiz',
      type: 'quiz',
      description: '3 questions',
      quiz_json: JSON.stringify({
        questions: [
          { id: 1, text: 'What does errors.Is do?', type: 'multiple_choice', options: ['Compares', 'Creates', 'Wraps'], correct: 0, explanation: 'It compares' },
          { id: 2, text: 'errors.As returns bool', type: 'true_false', correct: true, explanation: 'Yes it does' },
          { id: 3, text: 'Name the wrapping verb', type: 'fill_in', correct: 'fmt.Errorf', explanation: 'fmt.Errorf with %w' },
        ],
      }),
    });
    expect(quizEx.type).toBe('quiz');

    // 11. Submit quiz — all correct
    const quizResult = exercises.submitQuiz(quizEx.id, [0, true, 'fmt.Errorf']);
    expect(quizResult.score).toBeCloseTo(1.0);
    expect(quizResult.passed).toBe(true);

    // 12. Mark topic done
    curriculum.setTopicStatus(errorHandlingTopic.id, 'done');

    // 13. Verify final progress
    progress = curriculum.getProgress(subject.id);
    expect(progress.done).toBe(1);
    expect(progress.in_progress).toBe(0);
    expect(progress.total_entries).toBe(2);
    expect(progress.total_exercises).toBe(2);
    expect(progress.total_viz).toBe(1);
  });
});
