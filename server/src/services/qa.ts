import { Database } from '../storage/db.js';
import type { Entry } from '../types.js';

export class QAService {
  constructor(private db: Database) {}

  logEntry(
    topicId: number,
    kind: Entry['kind'],
    content: string,
    sessionId?: string,
    questionId?: number,
  ): Entry {
    const result = this.db.raw
      .prepare<
        [number, string, string, string, number | null],
        { id: number }
      >(
        'INSERT INTO entries (topic_id, kind, content, session_id, question_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
      )
      .get(topicId, kind, content, sessionId ?? '', questionId ?? null);

    return this.db.raw
      .prepare<[number], Entry>('SELECT * FROM entries WHERE id = ?')
      .get(result!.id)!;
  }

  listEntries(topicId: number): Entry[] {
    return this.db.raw
      .prepare<[number], Entry>(
        'SELECT * FROM entries WHERE topic_id = ? ORDER BY created_at ASC',
      )
      .all(topicId);
  }

  search(query: string): { id: number; topic_id: number; kind: string; content: string; created_at: string }[] {
    return this.db.raw
      .prepare<
        [string],
        { id: number; topic_id: number; kind: string; content: string; created_at: string }
      >(
        `SELECT e.id, e.topic_id, e.kind, e.content, e.created_at
         FROM entries e
         JOIN entries_fts ON entries_fts.rowid = e.id
         WHERE entries_fts MATCH ?
         ORDER BY e.created_at ASC
         LIMIT 50`,
      )
      .all(query);
  }
}
