import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/db.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { VizService } from '../../src/services/viz.js';
import type { VizStep } from '../../src/types.js';

describe('VizService', () => {
  let db: Database;
  let curriculum: CurriculumService;
  let svc: VizService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    curriculum = new CurriculumService(db);
    svc = new VizService(db);

    // Set up subject + topic for tests
    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      {
        name: 'Phase 1',
        description: '',
        topics: [{ name: 'Goroutines', description: 'concurrency' }],
      },
    ]);
    const phase = curriculum.getCurriculum(subject.id)[0];
    topicId = phase.topics[0].id;
  });

  afterEach(() => {
    db.close();
  });

  it('creates a visualization with title and steps — returns Visualization with correct title and valid id', () => {
    const steps: VizStep[] = [
      { html: '<div>step1</div>', description: 'First step' },
      { html: '<div>step2</div>', description: 'Second step' },
    ];

    const viz = svc.create(topicId, 'Goroutine Flow', steps);

    expect(viz.id).toBeGreaterThan(0);
    expect(viz.topic_id).toBe(topicId);
    expect(viz.title).toBe('Goroutine Flow');
    expect(viz.steps_json).toBeTruthy();
    expect(viz.created_at).toBeTruthy();
  });

  it('listForTopic returns visualizations in reverse chronological order', () => {
    svc.create(topicId, 'Viz A', [{ html: '<p>A</p>', description: 'A' }]);
    svc.create(topicId, 'Viz B', [{ html: '<p>B</p>', description: 'B' }]);
    svc.create(topicId, 'Viz C', [{ html: '<p>C</p>', description: 'C' }]);

    const list = svc.listForTopic(topicId);

    expect(list).toHaveLength(3);
    // Reverse chronological: most recent first
    expect(list[0].title).toBe('Viz C');
    expect(list[1].title).toBe('Viz B');
    expect(list[2].title).toBe('Viz A');
  });

  it('parsed steps_json contains correct VizStep objects', () => {
    const steps: VizStep[] = [
      { html: '<h1>Hello</h1>', description: 'Heading' },
      { html: '<p>World</p>', description: 'Paragraph' },
    ];

    const viz = svc.create(topicId, 'HTML Steps', steps);
    const parsed: VizStep[] = JSON.parse(viz.steps_json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].html).toBe('<h1>Hello</h1>');
    expect(parsed[0].description).toBe('Heading');
    expect(parsed[1].html).toBe('<p>World</p>');
    expect(parsed[1].description).toBe('Paragraph');
  });

  it('listForTopic returns empty array when no visualizations exist for topic', () => {
    const list = svc.listForTopic(topicId);
    expect(list).toEqual([]);
  });
});
