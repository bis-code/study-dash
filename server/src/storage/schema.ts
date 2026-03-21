export const schema = `
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS subjects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  slug       TEXT    NOT NULL UNIQUE,
  language   TEXT    NOT NULL DEFAULT '',
  source     TEXT    NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','roadmap','pdf')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_phases_subject ON phases(subject_id);

CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id    INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo','in_progress','done')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topics_phase  ON topics(phase_id);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('question','answer','note')),
  content     TEXT    NOT NULL DEFAULT '',
  session_id  TEXT    NOT NULL DEFAULT '',
  question_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_topic   ON entries(topic_id);
CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);

CREATE TABLE IF NOT EXISTS visualizations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '',
  steps_json TEXT    NOT NULL DEFAULT '[]',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_viz_topic ON visualizations(topic_id);

CREATE TABLE IF NOT EXISTS exercises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id     INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL DEFAULT '',
  type         TEXT    NOT NULL DEFAULT 'coding'
                 CHECK (type IN ('coding','quiz','project','assignment')),
  description  TEXT    NOT NULL DEFAULT '',
  difficulty   TEXT    NOT NULL DEFAULT 'medium'
                 CHECK (difficulty IN ('easy','medium','hard')),
  est_minutes  INTEGER NOT NULL DEFAULT 0,
  source       TEXT    NOT NULL DEFAULT 'ai'
                 CHECK (source IN ('ai','pdf_import')),
  starter_code TEXT    NOT NULL DEFAULT '',
  test_content TEXT    NOT NULL DEFAULT '',
  quiz_json    TEXT    NOT NULL DEFAULT '{}',
  file_path    TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','passed','failed')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exercises_topic  ON exercises(topic_id);
CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);

CREATE TABLE IF NOT EXISTS exercise_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  test_name   TEXT    NOT NULL DEFAULT '',
  passed      INTEGER NOT NULL DEFAULT 0,
  output      TEXT    NOT NULL DEFAULT '',
  ran_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_results_exercise ON exercise_results(exercise_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- FTS5 virtual table for full-text search over entries
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts
  USING fts5(content, content='entries', content_rowid='id');

-- Sync triggers: keep entries_fts up to date with entries
CREATE TRIGGER IF NOT EXISTS entries_ai
  AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
  END;

CREATE TRIGGER IF NOT EXISTS entries_ad
  AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, content)
      VALUES ('delete', old.id, old.content);
  END;

CREATE TRIGGER IF NOT EXISTS entries_au
  AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, content)
      VALUES ('delete', old.id, old.content);
    INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
  END;
`;

/** Future migrations appended here in order (v1 is baseline — empty). */
export const migrations: string[] = [];
