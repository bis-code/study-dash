import { Database } from '../storage/db.js';
import type { Subject, Phase, Topic, PhaseWithTopics, ProgressStats } from '../types.js';

interface PhaseInput {
  name: string;
  description: string;
  topics: Array<{ name: string; description: string }>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CurriculumService {
  constructor(private db: Database) {}

  // ── Subjects ───────────────────────────────────────────────────────────────

  createSubject(
    name: string,
    language: string = '',
    source: Subject['source'] = 'manual',
  ): Subject {
    const slug = language && !language.includes(' ') && name.toLowerCase() === language.toLowerCase()
      ? language.toLowerCase()
      : slugify(name);

    const result = this.db.raw
      .prepare<[string, string, string, string], { id: number }>(
        'INSERT INTO subjects (name, slug, language, source) VALUES (?, ?, ?, ?) RETURNING id',
      )
      .get(name, slug, language, source);

    return this.getSubject(result!.id)!;
  }

  listSubjects(): Subject[] {
    return this.db.raw
      .prepare<[], Subject>('SELECT * FROM subjects ORDER BY created_at DESC')
      .all();
  }

  getSubject(id: number): Subject | undefined {
    return this.db.raw
      .prepare<[number], Subject>('SELECT * FROM subjects WHERE id = ?')
      .get(id);
  }

  findSubjectByName(name: string): Subject | undefined {
    return this.db.raw
      .prepare<[string], Subject>('SELECT * FROM subjects WHERE lower(name) = lower(?)')
      .get(name);
  }

  // ── Curriculum import ──────────────────────────────────────────────────────

  importCurriculum(subjectId: number, phases: PhaseInput[]): void {
    const insertPhase = this.db.raw.prepare<[number, string, string, number], { id: number }>(
      'INSERT INTO phases (subject_id, name, description, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    );
    const insertTopic = this.db.raw.prepare(
      'INSERT INTO topics (phase_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
    );

    const run = this.db.raw.transaction(() => {
      phases.forEach((phase, phaseIdx) => {
        const phaseRow = insertPhase.get(subjectId, phase.name, phase.description, phaseIdx);
        phase.topics.forEach((topic, topicIdx) => {
          insertTopic.run(phaseRow!.id, topic.name, topic.description, topicIdx);
        });
      });
    });

    run();
  }

  getCurriculum(subjectId: number): PhaseWithTopics[] {
    const phases = this.db.raw
      .prepare<[number], Phase>(
        'SELECT * FROM phases WHERE subject_id = ? ORDER BY sort_order',
      )
      .all(subjectId);

    const getTopics = this.db.raw.prepare<[number], Topic>(
      'SELECT * FROM topics WHERE phase_id = ? ORDER BY sort_order',
    );

    return phases.map((phase) => ({
      ...phase,
      topics: getTopics.all(phase.id),
    }));
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  getProgress(subjectId: number): ProgressStats {
    const row = this.db.raw
      .prepare<
        { sid: number },
        {
          total_topics: number;
          done: number;
          in_progress: number;
          todo: number;
          total_entries: number;
          total_exercises: number;
          total_viz: number;
        }
      >(
        `WITH subject_topics AS (
           SELECT t.id, t.status
           FROM topics t
           JOIN phases p ON p.id = t.phase_id
           WHERE p.subject_id = :sid
         )
         SELECT
           COUNT(*)                                                       AS total_topics,
           SUM(CASE WHEN status = 'done'        THEN 1 ELSE 0 END)       AS done,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)       AS in_progress,
           SUM(CASE WHEN status = 'todo'        THEN 1 ELSE 0 END)       AS todo,
           (SELECT COUNT(*) FROM entries        WHERE topic_id IN (SELECT id FROM subject_topics)) AS total_entries,
           (SELECT COUNT(*) FROM exercises      WHERE topic_id IN (SELECT id FROM subject_topics)) AS total_exercises,
           (SELECT COUNT(*) FROM visualizations WHERE topic_id IN (SELECT id FROM subject_topics)) AS total_viz
         FROM subject_topics`,
      )
      .get({ sid: subjectId });

    return {
      total_topics: row?.total_topics ?? 0,
      done: row?.done ?? 0,
      in_progress: row?.in_progress ?? 0,
      todo: row?.todo ?? 0,
      total_entries: row?.total_entries ?? 0,
      total_exercises: row?.total_exercises ?? 0,
      total_viz: row?.total_viz ?? 0,
    };
  }

  // ── Topics ─────────────────────────────────────────────────────────────────

  setTopicStatus(topicId: number, status: Topic['status']): void {
    this.db.raw
      .prepare<[string, string, number]>(
        "UPDATE topics SET status = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(status, topicId);
  }

  getTopic(id: number): Topic | undefined {
    return this.db.raw
      .prepare<[number], Topic>('SELECT * FROM topics WHERE id = ?')
      .get(id);
  }

  findTopic(subjectId: number, name: string): Topic | undefined {
    return this.db.raw
      .prepare<[number, string], Topic>(
        `SELECT t.* FROM topics t
         JOIN phases p ON p.id = t.phase_id
         WHERE p.subject_id = ? AND lower(t.name) = lower(?)
         LIMIT 1`,
      )
      .get(subjectId, name);
  }
}
