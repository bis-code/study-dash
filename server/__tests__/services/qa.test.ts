import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/db.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { QAService } from '../../src/services/qa.js';

describe('QAService', () => {
  let db: Database;
  let curriculum: CurriculumService;
  let svc: QAService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    curriculum = new CurriculumService(db);
    svc = new QAService(db);

    // Seed: one subject, one phase, one topic
    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      {
        name: 'Basics',
        description: 'Getting started',
        topics: [{ name: 'Variables', description: 'var, const, let' }],
      },
    ]);
    const phaseTopics = curriculum.getCurriculum(subject.id);
    topicId = phaseTopics[0].topics[0].id;
  });

  afterEach(() => {
    db.close();
  });

  // ── logEntry ───────────────────────────────────────────────────────────────

  it('logs a question and returns Entry with correct kind and content', () => {
    const entry = svc.logEntry(topicId, 'question', 'What is a goroutine?');
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.topic_id).toBe(topicId);
    expect(entry.kind).toBe('question');
    expect(entry.content).toBe('What is a goroutine?');
    expect(entry.question_id).toBeNull();
    expect(entry.created_at).toBeTruthy();
  });

  it('logs an answer paired to a question via question_id', () => {
    const question = svc.logEntry(topicId, 'question', 'What is a channel?');
    const answer = svc.logEntry(topicId, 'answer', 'A typed conduit', undefined, question.id);

    expect(answer.kind).toBe('answer');
    expect(answer.content).toBe('A typed conduit');
    expect(answer.question_id).toBe(question.id);
  });

  it('logs a note without a question_id', () => {
    const note = svc.logEntry(topicId, 'note', 'Remember to use := for short declarations', 'session-1');
    expect(note.kind).toBe('note');
    expect(note.session_id).toBe('session-1');
    expect(note.question_id).toBeNull();
  });

  // ── listEntries ────────────────────────────────────────────────────────────

  it('listEntries returns entries for a topic in chronological order', () => {
    svc.logEntry(topicId, 'question', 'First question');
    svc.logEntry(topicId, 'note', 'A note');
    svc.logEntry(topicId, 'answer', 'An answer');

    const entries = svc.listEntries(topicId);
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe('First question');
    expect(entries[1].content).toBe('A note');
    expect(entries[2].content).toBe('An answer');
  });

  it('listEntries returns empty array when topic has no entries', () => {
    expect(svc.listEntries(topicId)).toEqual([]);
  });

  it('listEntries only returns entries for the given topic', () => {
    // Create a second topic
    const subject2 = curriculum.createSubject('Rust', 'rust', 'manual');
    curriculum.importCurriculum(subject2.id, [
      { name: 'Phase', description: '', topics: [{ name: 'Ownership', description: '' }] },
    ]);
    const topic2Id = curriculum.getCurriculum(subject2.id)[0].topics[0].id;

    svc.logEntry(topicId, 'note', 'Go note');
    svc.logEntry(topic2Id, 'note', 'Rust note');

    const entries = svc.listEntries(topicId);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Go note');
  });

  // ── search ─────────────────────────────────────────────────────────────────

  it('full-text search returns entries matching query', () => {
    svc.logEntry(topicId, 'question', 'What is a goroutine in Go?');
    svc.logEntry(topicId, 'note', 'Channels enable goroutine communication');
    svc.logEntry(topicId, 'answer', 'A goroutine is a lightweight thread');

    const results = svc.search('goroutine');
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const r of results) {
      expect(r.content.toLowerCase()).toContain('goroutine');
    }
  });

  it('search returns empty array when no entries match', () => {
    svc.logEntry(topicId, 'note', 'Some unrelated content');
    const results = svc.search('goroutine');
    expect(results).toEqual([]);
  });

  it('search result entries have required fields', () => {
    svc.logEntry(topicId, 'question', 'What is a pointer?');
    const results = svc.search('pointer');
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.id).toBeGreaterThan(0);
    expect(r.topic_id).toBe(topicId);
    expect(r.kind).toBe('question');
    expect(r.content).toBe('What is a pointer?');
    expect(r.created_at).toBeTruthy();
  });
});
