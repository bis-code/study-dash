import { Database } from '../storage/db.js';
import type { Resource } from '../types.js';

interface ImportResourceInput {
  topic_id: number;
  title: string;
  url: string;
}

export class ResourceService {
  constructor(private db: Database) {}

  getById(id: number): Resource | undefined {
    return this.db.raw.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Resource | undefined;
  }

  addResource(topicId: number, title: string, url: string, source: string = 'manual'): Resource {
    const result = this.db.raw.prepare(
      'INSERT INTO resources (topic_id, title, url, source) VALUES (?, ?, ?, ?)'
    ).run(topicId, title, url, source);
    return this.db.raw.prepare('SELECT * FROM resources WHERE id = ?').get(result.lastInsertRowid) as Resource;
  }

  listForTopic(topicId: number): Resource[] {
    return this.db.raw.prepare(
      'SELECT * FROM resources WHERE topic_id = ? ORDER BY created_at ASC, id ASC'
    ).all(topicId) as Resource[];
  }

  importResources(resources: ImportResourceInput[]): number {
    const insert = this.db.raw.prepare(
      'INSERT INTO resources (topic_id, title, url, source) VALUES (?, ?, ?, ?)'
    );
    const tx = this.db.raw.transaction((items: ImportResourceInput[]) => {
      for (const r of items) {
        insert.run(r.topic_id, r.title, r.url, 'import');
      }
      return items.length;
    });
    return tx(resources);
  }

  deleteResource(id: number): void {
    this.db.raw.prepare('DELETE FROM resources WHERE id = ?').run(id);
  }
}
