import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/db.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ResourceService } from '../../src/services/resources.js';

describe('ResourceService', () => {
  let db: Database;
  let curriculum: CurriculumService;
  let svc: ResourceService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    curriculum = new CurriculumService(db);
    svc = new ResourceService(db);
    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      { name: 'Phase 1', description: 'Fundamentals', topics: [{ name: 'Error Handling', description: 'errors' }] },
    ]);
    topicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;
  });

  afterEach(() => { db.close(); });

  it('addResource creates and returns a resource', () => {
    const r = svc.addResource(topicId, 'Go Blog', 'https://go.dev/blog', 'manual');
    expect(r.id).toBeGreaterThan(0);
    expect(r.title).toBe('Go Blog');
    expect(r.url).toBe('https://go.dev/blog');
    expect(r.topic_id).toBe(topicId);
    expect(r.source).toBe('manual');
  });

  it('listForTopic returns resources ordered by created_at', () => {
    svc.addResource(topicId, 'First', 'https://first.com', 'manual');
    svc.addResource(topicId, 'Second', 'https://second.com', 'auto');
    const list = svc.listForTopic(topicId);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('First');
    expect(list[1].title).toBe('Second');
  });

  it('listForTopic returns empty array for topic with no resources', () => {
    expect(svc.listForTopic(topicId)).toEqual([]);
  });

  it('importResources bulk-inserts and returns count', () => {
    const count = svc.importResources([
      { topic_id: topicId, title: 'A', url: 'https://a.com' },
      { topic_id: topicId, title: 'B', url: 'https://b.com' },
      { topic_id: topicId, title: 'C', url: 'https://c.com' },
    ]);
    expect(count).toBe(3);
    expect(svc.listForTopic(topicId)).toHaveLength(3);
  });

  it('deleteResource removes a resource', () => {
    const r = svc.addResource(topicId, 'Delete me', 'https://gone.com', 'manual');
    svc.deleteResource(r.id);
    expect(svc.listForTopic(topicId)).toHaveLength(0);
  });
});
