import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/db.js';
import { CurriculumService } from '../../src/services/curriculum.js';

describe('CurriculumService', () => {
  let db: Database;
  let svc: CurriculumService;

  beforeEach(() => {
    db = new Database(':memory:');
    svc = new CurriculumService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── createSubject ──────────────────────────────────────────────────────────

  it('createSubject with explicit slug source returns Subject with correct fields', () => {
    const subject = svc.createSubject('Go', 'go', 'roadmap');
    expect(subject.id).toBeGreaterThan(0);
    expect(subject.name).toBe('Go');
    expect(subject.slug).toBe('go');
    expect(subject.language).toBe('go');
    expect(subject.source).toBe('roadmap');
    expect(subject.created_at).toBeTruthy();
  });

  it('createSubject auto-generates slug from name', () => {
    const subject = svc.createSubject('Database Design');
    expect(subject.slug).toBe('database-design');
    expect(subject.language).toBe('');
    expect(subject.source).toBe('manual');
  });

  it('createSubject slug lowercases and strips non-alphanumeric', () => {
    const subject = svc.createSubject('  Node.js & TypeScript! ');
    expect(subject.slug).toBe('node-js-typescript');
  });

  // ── listSubjects ───────────────────────────────────────────────────────────

  it('listSubjects returns all subjects', () => {
    svc.createSubject('Alpha');
    svc.createSubject('Beta');
    const subjects = svc.listSubjects();
    expect(subjects).toHaveLength(2);
    const names = subjects.map((s) => s.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
  });

  it('listSubjects returns empty array when none exist', () => {
    expect(svc.listSubjects()).toEqual([]);
  });

  // ── importCurriculum + getCurriculum ───────────────────────────────────────

  it('importCurriculum inserts phases with nested topics, getCurriculum returns them', () => {
    const subject = svc.createSubject('Go', 'go', 'roadmap');

    svc.importCurriculum(subject.id, [
      {
        name: 'Phase 1: Basics',
        description: 'Getting started',
        topics: [
          { name: 'Variables', description: 'var, const, let' },
          { name: 'Functions', description: 'func keyword' },
        ],
      },
      {
        name: 'Phase 2: Advanced',
        description: 'Go deeper',
        topics: [{ name: 'Goroutines', description: 'concurrency' }],
      },
    ]);

    const curriculum = svc.getCurriculum(subject.id);
    expect(curriculum).toHaveLength(2);

    const phase1 = curriculum[0];
    expect(phase1.name).toBe('Phase 1: Basics');
    expect(phase1.description).toBe('Getting started');
    expect(phase1.sort_order).toBe(0);
    expect(phase1.topics).toHaveLength(2);
    expect(phase1.topics[0].name).toBe('Variables');
    expect(phase1.topics[0].sort_order).toBe(0);
    expect(phase1.topics[1].name).toBe('Functions');
    expect(phase1.topics[1].sort_order).toBe(1);

    const phase2 = curriculum[1];
    expect(phase2.name).toBe('Phase 2: Advanced');
    expect(phase2.sort_order).toBe(1);
    expect(phase2.topics).toHaveLength(1);
    expect(phase2.topics[0].name).toBe('Goroutines');
  });

  it('getCurriculum returns empty array for unknown subject', () => {
    expect(svc.getCurriculum(9999)).toEqual([]);
  });

  // ── getProgress ────────────────────────────────────────────────────────────

  it('getProgress returns correct counts', () => {
    const subject = svc.createSubject('Go', 'go', 'roadmap');
    svc.importCurriculum(subject.id, [
      {
        name: 'Phase 1',
        description: '',
        topics: [
          { name: 'Topic A', description: '' },
          { name: 'Topic B', description: '' },
          { name: 'Topic C', description: '' },
        ],
      },
    ]);

    const curriculum = svc.getCurriculum(subject.id);
    const topicA = curriculum[0].topics[0];
    const topicB = curriculum[0].topics[1];

    // Mark Topic A as done, Topic B as in_progress; Topic C remains todo
    svc.setTopicStatus(topicA.id, 'done');
    svc.setTopicStatus(topicB.id, 'in_progress');

    // Add an entry and exercise to Topic A
    db.raw.prepare('INSERT INTO entries (topic_id, kind, content) VALUES (?, ?, ?)').run(topicA.id, 'note', 'some note');
    db.raw.prepare('INSERT INTO exercises (topic_id, title) VALUES (?, ?)').run(topicA.id, 'Exercise 1');
    db.raw.prepare('INSERT INTO visualizations (topic_id, title) VALUES (?, ?)').run(topicA.id, 'Viz 1');

    const stats = svc.getProgress(subject.id);
    expect(stats.total_topics).toBe(3);
    expect(stats.done).toBe(1);
    expect(stats.in_progress).toBe(1);
    expect(stats.todo).toBe(1);
    expect(stats.total_entries).toBe(1);
    expect(stats.total_exercises).toBe(1);
    expect(stats.total_viz).toBe(1);
  });

  // ── setTopicStatus ─────────────────────────────────────────────────────────

  it('setTopicStatus changes topic status, reflected in getProgress', () => {
    const subject = svc.createSubject('Python', 'python', 'manual');
    svc.importCurriculum(subject.id, [
      {
        name: 'Basics',
        description: '',
        topics: [{ name: 'Loops', description: '' }],
      },
    ]);

    const curriculum = svc.getCurriculum(subject.id);
    const topic = curriculum[0].topics[0];

    expect(topic.status).toBe('todo');

    svc.setTopicStatus(topic.id, 'done');

    const stats = svc.getProgress(subject.id);
    expect(stats.done).toBe(1);
    expect(stats.todo).toBe(0);

    const updated = svc.getTopic(topic.id);
    expect(updated?.status).toBe('done');
    expect(updated?.updated_at).toBeTruthy();
  });

  // ── findTopic ──────────────────────────────────────────────────────────────

  it('findTopic finds by name case-insensitively', () => {
    const subject = svc.createSubject('Rust', 'rust', 'manual');
    svc.importCurriculum(subject.id, [
      {
        name: 'Ownership',
        description: '',
        topics: [{ name: 'Borrowing', description: 'borrow checker' }],
      },
    ]);

    const found = svc.findTopic(subject.id, 'borrowing');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Borrowing');

    const foundUpper = svc.findTopic(subject.id, 'BORROWING');
    expect(foundUpper?.id).toBe(found?.id);
  });

  it('findTopic returns undefined when not found', () => {
    const subject = svc.createSubject('Rust', 'rust', 'manual');
    expect(svc.findTopic(subject.id, 'nonexistent')).toBeUndefined();
  });

  it('findTopic does not find topics from a different subject', () => {
    const subjectA = svc.createSubject('Go', 'go', 'manual');
    const subjectB = svc.createSubject('Rust', 'rust', 'manual');

    svc.importCurriculum(subjectA.id, [
      { name: 'Phase', description: '', topics: [{ name: 'Channels', description: '' }] },
    ]);

    const notFound = svc.findTopic(subjectB.id, 'Channels');
    expect(notFound).toBeUndefined();
  });
});
