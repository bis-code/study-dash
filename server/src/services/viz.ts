import { Database } from '../storage/db.js';
import type { Visualization, VizStep } from '../types.js';

export class VizService {
  constructor(private db: Database) {}

  create(topicId: number, title: string, steps: VizStep[]): Visualization {
    const stepsJson = JSON.stringify(steps);

    const result = this.db.raw
      .prepare<[number, string, string], { id: number }>(
        'INSERT INTO visualizations (topic_id, title, steps_json) VALUES (?, ?, ?) RETURNING id',
      )
      .get(topicId, title, stepsJson);

    return this.db.raw
      .prepare<[number], Visualization>('SELECT * FROM visualizations WHERE id = ?')
      .get(result!.id)!;
  }

  listForTopic(topicId: number): Visualization[] {
    return this.db.raw
      .prepare<[number], Visualization>(
        'SELECT * FROM visualizations WHERE topic_id = ? ORDER BY created_at DESC, id DESC',
      )
      .all(topicId);
  }
}
