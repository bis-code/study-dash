#!/usr/bin/env node

// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/storage/db.ts
import BetterSqlite3 from "better-sqlite3";

// src/storage/schema.ts
var schema = `
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

CREATE TABLE IF NOT EXISTS resources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '',
  url        TEXT    NOT NULL DEFAULT '',
  source     TEXT    NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','auto','import')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_topic ON resources(topic_id);

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
var migrations = [];

// src/storage/db.ts
var Database = class {
  db;
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("foreign_keys=ON");
    this.db.exec(schema);
    const currentVersion = this.getSetting("schema_version");
    if (!currentVersion) {
      this.setSetting("schema_version", "1");
      this.setSetting("auto_viz", "true");
      this.setSetting("dashboard_port", "19282");
    }
    const versionNum = parseInt(this.getSetting("schema_version") ?? "1", 10);
    for (let i = versionNum - 1; i < migrations.length; i++) {
      this.db.exec(migrations[i]);
      this.setSetting("schema_version", String(i + 2));
    }
  }
  getSetting(key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value;
  }
  setSetting(key, value) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  listTables() {
    const allRows = this.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all();
    return allRows.map((r) => r.name);
  }
  /** Expose the raw better-sqlite3 handle for advanced operations. */
  get raw() {
    return this.db;
  }
  close() {
    this.db.close();
  }
};

// src/storage/files.ts
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var FileStore = class {
  baseDir;
  constructor(baseDir) {
    this.baseDir = baseDir ?? join(homedir(), ".claude", "learn");
    mkdirSync(join(this.baseDir, "exercises"), { recursive: true });
  }
  get exercisesDir() {
    return join(this.baseDir, "exercises");
  }
  get dataDir() {
    return this.baseDir;
  }
  get dbPath() {
    return join(this.baseDir, "data.db");
  }
  writeExerciseFiles(subjectSlug, exerciseSlug, files) {
    const dir = join(this.exercisesDir, subjectSlug, exerciseSlug);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf-8");
    }
    return dir;
  }
  exerciseExists(subjectSlug, exerciseSlug) {
    return existsSync(join(this.exercisesDir, subjectSlug, exerciseSlug));
  }
  readFile(path) {
    return readFileSync(path, "utf-8");
  }
};

// src/services/curriculum.ts
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
var CurriculumService = class {
  constructor(db2) {
    this.db = db2;
  }
  // ── Subjects ───────────────────────────────────────────────────────────────
  createSubject(name, language = "", source = "manual") {
    const slug = language && !language.includes(" ") && name.toLowerCase() === language.toLowerCase() ? language.toLowerCase() : slugify(name);
    const result = this.db.raw.prepare(
      "INSERT INTO subjects (name, slug, language, source) VALUES (?, ?, ?, ?) RETURNING id"
    ).get(name, slug, language, source);
    return this.getSubject(result.id);
  }
  listSubjects() {
    return this.db.raw.prepare("SELECT * FROM subjects ORDER BY created_at DESC").all();
  }
  getSubject(id) {
    return this.db.raw.prepare("SELECT * FROM subjects WHERE id = ?").get(id);
  }
  findSubjectByName(name) {
    return this.db.raw.prepare("SELECT * FROM subjects WHERE lower(name) = lower(?)").get(name);
  }
  // ── Curriculum import ──────────────────────────────────────────────────────
  importCurriculum(subjectId, phases) {
    const insertPhase = this.db.raw.prepare(
      "INSERT INTO phases (subject_id, name, description, sort_order) VALUES (?, ?, ?, ?) RETURNING id"
    );
    const insertTopic = this.db.raw.prepare(
      "INSERT INTO topics (phase_id, name, description, sort_order) VALUES (?, ?, ?, ?)"
    );
    const run2 = this.db.raw.transaction(() => {
      phases.forEach((phase, phaseIdx) => {
        const phaseRow = insertPhase.get(subjectId, phase.name, phase.description, phaseIdx);
        phase.topics.forEach((topic, topicIdx) => {
          insertTopic.run(phaseRow.id, topic.name, topic.description, topicIdx);
        });
      });
    });
    run2();
  }
  getCurriculum(subjectId) {
    const phases = this.db.raw.prepare(
      "SELECT * FROM phases WHERE subject_id = ? ORDER BY sort_order"
    ).all(subjectId);
    const getTopics = this.db.raw.prepare(
      "SELECT * FROM topics WHERE phase_id = ? ORDER BY sort_order"
    );
    return phases.map((phase) => ({
      ...phase,
      topics: getTopics.all(phase.id)
    }));
  }
  // ── Progress ───────────────────────────────────────────────────────────────
  getProgress(subjectId) {
    const row = this.db.raw.prepare(
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
         FROM subject_topics`
    ).get({ sid: subjectId });
    return {
      total_topics: row?.total_topics ?? 0,
      done: row?.done ?? 0,
      in_progress: row?.in_progress ?? 0,
      todo: row?.todo ?? 0,
      total_entries: row?.total_entries ?? 0,
      total_exercises: row?.total_exercises ?? 0,
      total_viz: row?.total_viz ?? 0
    };
  }
  // ── Topics ─────────────────────────────────────────────────────────────────
  setTopicStatus(topicId, status) {
    this.db.raw.prepare(
      "UPDATE topics SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, topicId);
  }
  getTopic(id) {
    return this.db.raw.prepare("SELECT * FROM topics WHERE id = ?").get(id);
  }
  findTopic(subjectId, name) {
    return this.db.raw.prepare(
      `SELECT t.* FROM topics t
         JOIN phases p ON p.id = t.phase_id
         WHERE p.subject_id = ? AND lower(t.name) = lower(?)
         LIMIT 1`
    ).get(subjectId, name);
  }
};

// src/services/qa.ts
var QAService = class {
  constructor(db2) {
    this.db = db2;
  }
  logEntry(topicId, kind, content, sessionId, questionId) {
    const result = this.db.raw.prepare(
      "INSERT INTO entries (topic_id, kind, content, session_id, question_id) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).get(topicId, kind, content, sessionId ?? "", questionId ?? null);
    return this.db.raw.prepare("SELECT * FROM entries WHERE id = ?").get(result.id);
  }
  listEntries(topicId) {
    return this.db.raw.prepare(
      "SELECT * FROM entries WHERE topic_id = ? ORDER BY created_at ASC"
    ).all(topicId);
  }
  search(query) {
    return this.db.raw.prepare(
      `SELECT e.id, e.topic_id, e.kind, e.content, e.created_at
         FROM entries e
         JOIN entries_fts ON entries_fts.rowid = e.id
         WHERE entries_fts MATCH ?
         ORDER BY e.created_at ASC
         LIMIT 50`
    ).all(query);
  }
};

// src/services/viz.ts
var VizService = class {
  constructor(db2) {
    this.db = db2;
  }
  create(topicId, title, steps) {
    const stepsJson = JSON.stringify(steps);
    const result = this.db.raw.prepare(
      "INSERT INTO visualizations (topic_id, title, steps_json) VALUES (?, ?, ?) RETURNING id"
    ).get(topicId, title, stepsJson);
    return this.db.raw.prepare("SELECT * FROM visualizations WHERE id = ?").get(result.id);
  }
  listForTopic(topicId) {
    return this.db.raw.prepare(
      "SELECT * FROM visualizations WHERE topic_id = ? ORDER BY created_at DESC, id DESC"
    ).all(topicId);
  }
};

// src/services/exercises.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function slugify2(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function extensionForLanguage(language) {
  switch (language) {
    case "go":
      return ".go";
    case "python":
      return ".py";
    case "rust":
      return ".rs";
    case "javascript":
    case "typescript":
      return ".ts";
    default:
      return ".txt";
  }
}
var ExerciseService = class {
  constructor(db2, fileStore2) {
    this.db = db2;
    this.fileStore = fileStore2;
  }
  createExercise(topicId, data) {
    const {
      title,
      type,
      description,
      difficulty = "medium",
      est_minutes = 0,
      source = "ai",
      starter_code = "",
      test_content = "",
      quiz_json = "{}"
    } = data;
    const result = this.db.raw.prepare(
      `INSERT INTO exercises
         (topic_id, title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
    ).get(topicId, title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json);
    const exerciseId = result.id;
    if ((type === "coding" || type === "project") && (starter_code || test_content)) {
      const subject = this.getSubjectForTopic(topicId);
      if (subject) {
        const exerciseSlug = slugify2(title);
        const ext = extensionForLanguage(subject.language);
        const files = {};
        if (starter_code) {
          files[`main${ext}`] = starter_code;
        }
        if (test_content) {
          files[`main_test${ext}`] = test_content;
        }
        files["README.md"] = `# ${title}

${description}`;
        const filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, files);
        this.db.raw.prepare("UPDATE exercises SET file_path = ? WHERE id = ?").run(filePath, exerciseId);
      }
    }
    return this.db.raw.prepare("SELECT * FROM exercises WHERE id = ?").get(exerciseId);
  }
  async runTests(exerciseId) {
    const exercise = this.db.raw.prepare("SELECT * FROM exercises WHERE id = ?").get(exerciseId);
    if (!exercise) throw new Error(`Exercise ${exerciseId} not found`);
    if (!exercise.file_path) throw new Error(`Exercise ${exerciseId} has no file_path`);
    const subject = this.getSubjectForTopic(exercise.topic_id);
    if (!subject) throw new Error(`No subject found for exercise ${exerciseId}`);
    const commandMap = {
      go: { command: "go", args: ["test", "-json", "-count=1", "./..."] },
      python: { command: "python3", args: ["-m", "pytest", "--tb=short", "-q", "."] },
      rust: { command: "cargo", args: ["test"] },
      javascript: { command: "npx", args: ["vitest", "run"] },
      typescript: { command: "npx", args: ["vitest", "run"] }
    };
    const config = commandMap[subject.language];
    if (!config) throw new Error(`Unsupported language: ${subject.language}`);
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const result = await execFileAsync(config.command, config.args, {
        cwd: exercise.file_path,
        timeout: 6e4
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err6) {
      const execErr = err6;
      stdout = execErr.stdout ?? "";
      stderr = execErr.stderr ?? "";
      exitCode = execErr.code ?? 1;
    }
    const results = [];
    if (subject.language === "go") {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.Action === "pass" && event.Test) {
            results.push({ test_name: event.Test, passed: true, output: "" });
          } else if (event.Action === "fail" && event.Test) {
            results.push({ test_name: event.Test, passed: false, output: event.Output ?? "" });
          }
        } catch {
        }
      }
    }
    if (results.length === 0) {
      results.push({
        test_name: "all",
        passed: exitCode === 0,
        output: stdout + stderr
      });
    }
    this.db.raw.prepare("DELETE FROM exercise_results WHERE exercise_id = ?").run(exerciseId);
    const insertResult = this.db.raw.prepare(
      "INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)"
    );
    for (const r of results) {
      insertResult.run(exerciseId, r.test_name, r.passed ? 1 : 0, r.output);
    }
    const allPassed = results.every((r) => r.passed);
    this.db.raw.prepare("UPDATE exercises SET status = ? WHERE id = ?").run(allPassed ? "passed" : "failed", exerciseId);
    return this.db.raw.prepare("SELECT * FROM exercise_results WHERE exercise_id = ?").all(exerciseId);
  }
  submitQuiz(exerciseId, answers) {
    const exercise = this.db.raw.prepare("SELECT * FROM exercises WHERE id = ?").get(exerciseId);
    if (!exercise) throw new Error(`Exercise ${exerciseId} not found`);
    const payload = JSON.parse(exercise.quiz_json);
    const questions = payload.questions;
    let correct = 0;
    const results = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const answer = answers[i];
      let isCorrect = false;
      switch (q.type) {
        case "multiple_choice":
          isCorrect = answer === q.correct;
          break;
        case "true_false":
          isCorrect = answer === q.correct;
          break;
        case "fill_in":
          isCorrect = String(answer).toLowerCase().trim() === String(q.correct).toLowerCase().trim();
          break;
      }
      if (isCorrect) correct++;
      results.push({
        test_name: `Q${i + 1}: ${q.text}`,
        passed: isCorrect,
        output: isCorrect ? "Correct" : `Wrong. Expected: ${q.correct}, Got: ${answer}`
      });
    }
    const score = questions.length > 0 ? correct / questions.length : 0;
    const passed = score >= 0.7;
    this.db.raw.prepare("DELETE FROM exercise_results WHERE exercise_id = ?").run(exerciseId);
    const insertResult = this.db.raw.prepare(
      "INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)"
    );
    for (const r of results) {
      insertResult.run(exerciseId, r.test_name, r.passed ? 1 : 0, r.output);
    }
    this.db.raw.prepare("UPDATE exercises SET status = ? WHERE id = ?").run(passed ? "passed" : "failed", exerciseId);
    return { score, total: questions.length, passed, results };
  }
  listForTopic(topicId) {
    return this.db.raw.prepare(
      "SELECT * FROM exercises WHERE topic_id = ? ORDER BY created_at ASC, id ASC"
    ).all(topicId);
  }
  getSubjectForTopic(topicId) {
    return this.db.raw.prepare(
      `SELECT s.* FROM subjects s
         JOIN phases p ON p.subject_id = s.id
         JOIN topics t ON t.phase_id = p.id
         WHERE t.id = ?`
    ).get(topicId);
  }
};

// src/services/resources.ts
var ResourceService = class {
  constructor(db2) {
    this.db = db2;
  }
  addResource(topicId, title, url, source = "manual") {
    const result = this.db.raw.prepare(
      "INSERT INTO resources (topic_id, title, url, source) VALUES (?, ?, ?, ?)"
    ).run(topicId, title, url, source);
    return this.db.raw.prepare("SELECT * FROM resources WHERE id = ?").get(result.lastInsertRowid);
  }
  listForTopic(topicId) {
    return this.db.raw.prepare(
      "SELECT * FROM resources WHERE topic_id = ? ORDER BY created_at ASC, id ASC"
    ).all(topicId);
  }
  importResources(resources) {
    const insert = this.db.raw.prepare(
      "INSERT INTO resources (topic_id, title, url, source) VALUES (?, ?, ?, ?)"
    );
    const tx = this.db.raw.transaction((items) => {
      for (const r of items) {
        insert.run(r.topic_id, r.title, r.url, "import");
      }
      return items.length;
    });
    return tx(resources);
  }
  deleteResource(id) {
    this.db.raw.prepare("DELETE FROM resources WHERE id = ?").run(id);
  }
};

// src/tools/curriculum.ts
import { z } from "zod";
function getSession(sessions2, sessionId) {
  const key = sessionId || "_default";
  if (!sessions2.has(key)) {
    sessions2.set(key, { subjectId: null, topicId: null });
  }
  return sessions2.get(key);
}
function err(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function ok(text) {
  return { content: [{ type: "text", text }] };
}
function registerCurriculumTools(server2, svc, sessions2, notify2) {
  server2.tool(
    "learn_create_subject",
    "Create a new subject to study",
    {
      name: z.string().describe("Subject name"),
      language: z.string().optional().describe("Programming language (optional)"),
      source: z.enum(["manual", "roadmap", "pdf"]).optional().describe("Curriculum source")
    },
    async ({ name, language, source }) => {
      const subject = svc.createSubject(name, language, source);
      notify2();
      return ok(`Created subject "${subject.name}" (id=${subject.id}, slug=${subject.slug})`);
    }
  );
  server2.tool(
    "learn_import_curriculum",
    "Import a curriculum (phases + topics) for a subject from JSON",
    {
      subject_id: z.number().describe("Subject ID to import curriculum into"),
      phases_json: z.string().describe("JSON array of phases, each with name, description, and topics array")
    },
    async ({ subject_id, phases_json }) => {
      let phases;
      try {
        phases = JSON.parse(phases_json);
      } catch {
        return err("Invalid JSON in phases_json");
      }
      if (!Array.isArray(phases)) {
        return err("phases_json must be a JSON array");
      }
      svc.importCurriculum(subject_id, phases);
      notify2();
      return ok(`Imported ${phases.length} phase(s) into subject id=${subject_id}`);
    }
  );
  server2.tool(
    "learn_switch_subject",
    "Switch the active subject for the session (by name or numeric ID)",
    {
      subject: z.string().describe("Subject name or numeric ID"),
      session_id: z.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ subject, session_id }) => {
      const numId = Number(subject);
      let resolved = isNaN(numId) ? svc.findSubjectByName(subject) : svc.getSubject(numId) ?? svc.findSubjectByName(subject);
      if (!resolved) {
        return err(`Subject not found: "${subject}"`);
      }
      const session = getSession(sessions2, session_id);
      session.subjectId = resolved.id;
      session.topicId = null;
      return ok(`Active subject: "${resolved.name}" (id=${resolved.id})`);
    }
  );
  server2.tool(
    "learn_set_topic",
    "Set the active topic for the session and mark it in_progress",
    {
      topic: z.string().describe("Topic name or numeric ID"),
      session_id: z.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ topic, session_id }) => {
      const session = getSession(sessions2, session_id);
      if (session.subjectId === null) {
        return err("No active subject. Use learn_switch_subject first.");
      }
      const numId = Number(topic);
      let resolved = isNaN(numId) ? svc.findTopic(session.subjectId, topic) : svc.getTopic(numId) ?? svc.findTopic(session.subjectId, topic);
      if (!resolved) {
        return err(`Topic not found: "${topic}"`);
      }
      svc.setTopicStatus(resolved.id, "in_progress");
      session.topicId = resolved.id;
      notify2();
      return ok(`Active topic: "${resolved.name}" (id=${resolved.id}, status=in_progress)`);
    }
  );
  server2.tool(
    "learn_mark_done",
    "Mark a topic as done (defaults to the active session topic)",
    {
      topic: z.string().optional().describe("Topic name or numeric ID (uses session topic if omitted)"),
      session_id: z.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ topic, session_id }) => {
      const session = getSession(sessions2, session_id);
      let topicId = null;
      if (topic !== void 0) {
        const numId = Number(topic);
        const resolved2 = isNaN(numId) ? session.subjectId !== null ? svc.findTopic(session.subjectId, topic) : void 0 : svc.getTopic(numId);
        if (!resolved2) {
          return err(`Topic not found: "${topic}"`);
        }
        topicId = resolved2.id;
      } else {
        topicId = session.topicId;
      }
      if (topicId === null) {
        return err("No topic specified and no active topic in session.");
      }
      const resolved = svc.getTopic(topicId);
      if (!resolved) {
        return err(`Topic id=${topicId} not found.`);
      }
      svc.setTopicStatus(topicId, "done");
      notify2();
      return ok(`Topic "${resolved.name}" marked as done.`);
    }
  );
  server2.tool(
    "learn_get_progress",
    "Get progress statistics for the active subject",
    {
      session_id: z.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ session_id }) => {
      const session = getSession(sessions2, session_id);
      if (session.subjectId === null) {
        return err("No active subject. Use learn_switch_subject first.");
      }
      const progress = svc.getProgress(session.subjectId);
      return ok(JSON.stringify(progress, null, 2));
    }
  );
  server2.tool(
    "learn_get_curriculum",
    "Get the full curriculum (phases + topics) for the active subject",
    {
      session_id: z.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ session_id }) => {
      const session = getSession(sessions2, session_id);
      if (session.subjectId === null) {
        return err("No active subject. Use learn_switch_subject first.");
      }
      const curriculum = svc.getCurriculum(session.subjectId);
      return ok(JSON.stringify(curriculum, null, 2));
    }
  );
}

// src/tools/qa.ts
import { z as z2 } from "zod";
function getSession2(sessions2, sessionId) {
  const key = sessionId || "_default";
  if (!sessions2.has(key)) {
    sessions2.set(key, { subjectId: null, topicId: null });
  }
  return sessions2.get(key);
}
function err2(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function ok2(text) {
  return { content: [{ type: "text", text }] };
}
function registerQATools(server2, svc, sessions2, notify2) {
  server2.tool(
    "learn_log_question",
    "Log a question for the active topic",
    {
      content: z2.string().describe("The question text"),
      session_id: z2.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ content, session_id }) => {
      const session = getSession2(sessions2, session_id);
      if (session.topicId === null) {
        return err2("No active topic. Use learn_set_topic first.");
      }
      const entry = svc.logEntry(session.topicId, "question", content, session_id);
      notify2();
      return ok2(`Logged question (id=${entry.id})`);
    }
  );
  server2.tool(
    "learn_log_answer",
    "Log an answer or note for the active topic",
    {
      content: z2.string().describe("The answer or note text"),
      question_id: z2.number().optional().describe("ID of the question this answers (optional)"),
      kind: z2.enum(["answer", "note"]).optional().describe("Entry kind: answer or note (defaults to answer)"),
      session_id: z2.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ content, question_id, kind, session_id }) => {
      const session = getSession2(sessions2, session_id);
      if (session.topicId === null) {
        return err2("No active topic. Use learn_set_topic first.");
      }
      const entryKind = kind ?? "answer";
      const entry = svc.logEntry(session.topicId, entryKind, content, session_id, question_id);
      notify2();
      return ok2(`Logged ${entryKind} (id=${entry.id})`);
    }
  );
  server2.tool(
    "learn_search",
    "Full-text search across all entries",
    {
      query: z2.string().describe("Search query")
    },
    async ({ query }) => {
      const results = svc.search(query);
      if (results.length === 0) {
        return ok2("No results found.");
      }
      return ok2(JSON.stringify(results, null, 2));
    }
  );
}

// src/tools/viz.ts
import { z as z3 } from "zod";
function getSession3(sessions2, sessionId) {
  const key = sessionId || "_default";
  if (!sessions2.has(key)) {
    sessions2.set(key, { subjectId: null, topicId: null });
  }
  return sessions2.get(key);
}
function err3(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function ok3(text) {
  return { content: [{ type: "text", text }] };
}
function registerVizTools(server2, svc, sessions2, notify2) {
  server2.tool(
    "learn_create_viz",
    "Create a step-by-step HTML visualization for the active topic",
    {
      title: z3.string().describe("Title for the visualization"),
      steps: z3.string().describe("JSON array of steps, each with { html: string, description: string }"),
      session_id: z3.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ title, steps, session_id }) => {
      const session = getSession3(sessions2, session_id);
      if (session.topicId === null) {
        return err3("No active topic. Use learn_set_topic first.");
      }
      let parsedSteps;
      try {
        parsedSteps = JSON.parse(steps);
      } catch {
        return err3("Invalid JSON in steps parameter");
      }
      if (!Array.isArray(parsedSteps)) {
        return err3("steps must be a JSON array");
      }
      const viz = svc.create(session.topicId, title, parsedSteps);
      notify2();
      return ok3(`Created visualization "${viz.title}" (id=${viz.id})`);
    }
  );
  server2.tool(
    "learn_get_viz",
    "Get all visualizations for the active topic",
    {
      session_id: z3.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ session_id }) => {
      const session = getSession3(sessions2, session_id);
      if (session.topicId === null) {
        return err3("No active topic. Use learn_set_topic first.");
      }
      const vizList = svc.listForTopic(session.topicId);
      return ok3(JSON.stringify(vizList, null, 2));
    }
  );
}

// src/tools/exercises.ts
import { z as z4 } from "zod";
function getSession4(sessions2, sessionId) {
  const key = sessionId || "_default";
  if (!sessions2.has(key)) {
    sessions2.set(key, { subjectId: null, topicId: null });
  }
  return sessions2.get(key);
}
function err4(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function ok4(text) {
  return { content: [{ type: "text", text }] };
}
function registerExerciseTools(server2, svc, sessions2, notify2) {
  server2.tool(
    "learn_create_exercise",
    "Create an exercise (coding, quiz, project, assignment) for the active topic",
    {
      title: z4.string().describe("Exercise title"),
      type: z4.enum(["coding", "quiz", "project", "assignment"]).describe("Exercise type"),
      description: z4.string().describe("Exercise description / instructions"),
      difficulty: z4.enum(["easy", "medium", "hard"]).optional().describe("Difficulty level"),
      est_minutes: z4.number().optional().describe("Estimated time in minutes"),
      source: z4.enum(["ai", "pdf_import"]).optional().describe("Source of the exercise"),
      starter_code: z4.string().optional().describe("Starter code for coding/project exercises"),
      test_content: z4.string().optional().describe("Test code for coding/project exercises"),
      quiz_json: z4.string().optional().describe("JSON string of QuizPayload for quiz exercises"),
      session_id: z4.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json, session_id }) => {
      const session = getSession4(sessions2, session_id);
      if (session.topicId === null) {
        return err4("No active topic. Use learn_set_topic first.");
      }
      const exercise = svc.createExercise(session.topicId, {
        title,
        type,
        description,
        difficulty,
        est_minutes,
        source,
        starter_code,
        test_content,
        quiz_json
      });
      notify2();
      return ok4(`Created exercise "${exercise.title}" (id=${exercise.id}, type=${exercise.type})`);
    }
  );
  server2.tool(
    "learn_run_tests",
    "Run tests for a coding/project exercise and return results",
    {
      exercise_id: z4.number().describe("ID of the exercise to run tests for")
    },
    async ({ exercise_id }) => {
      try {
        const results = await svc.runTests(exercise_id);
        notify2();
        return ok4(JSON.stringify(results, null, 2));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return err4(`Failed to run tests: ${msg}`);
      }
    }
  );
  server2.tool(
    "learn_get_exercises",
    "List all exercises for the active topic",
    {
      session_id: z4.string().optional().describe("Session identifier (defaults to _default)")
    },
    async ({ session_id }) => {
      const session = getSession4(sessions2, session_id);
      if (session.topicId === null) {
        return err4("No active topic. Use learn_set_topic first.");
      }
      const exercises = svc.listForTopic(session.topicId);
      return ok4(JSON.stringify(exercises, null, 2));
    }
  );
}

// src/tools/resources.ts
import { z as z5 } from "zod";
function getSession5(sessions2, sessionId) {
  const key = sessionId || "_default";
  if (!sessions2.has(key)) {
    sessions2.set(key, { subjectId: null, topicId: null });
  }
  return sessions2.get(key);
}
function err5(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function ok5(text) {
  return { content: [{ type: "text", text }] };
}
function registerResourceTools(server2, svc, sessions2, notify2) {
  server2.tool(
    "learn_add_resource",
    "Add a reference link to the active topic (or a specific topic by ID)",
    {
      title: z5.string().describe("Resource title"),
      url: z5.string().describe("Resource URL"),
      topic_id: z5.number().optional().describe("Topic ID (defaults to active topic)"),
      session_id: z5.string().optional()
    },
    async ({ title, url, topic_id, session_id }) => {
      const tid = topic_id ?? getSession5(sessions2, session_id).topicId;
      if (tid === null) {
        return err5("No active topic. Use learn_set_topic first or provide topic_id.");
      }
      const resource = svc.addResource(tid, title, url, "manual");
      notify2();
      return ok5(`Added resource "${resource.title}" (id=${resource.id}) to topic ${tid}`);
    }
  );
  server2.tool(
    "learn_import_resources",
    "Bulk import resource links from a JSON array of {topic_id, title, url} objects",
    {
      resources_json: z5.string().describe("JSON array of {topic_id: number, title: string, url: string}")
    },
    async ({ resources_json }) => {
      let resources;
      try {
        resources = JSON.parse(resources_json);
      } catch {
        return err5("Invalid JSON");
      }
      if (!Array.isArray(resources)) {
        return err5("Expected a JSON array");
      }
      const count = svc.importResources(resources);
      notify2();
      return ok5(`Imported ${count} resources`);
    }
  );
}

// src/dashboard/server.ts
import http from "node:http";

// src/dashboard/api.ts
function writeJSON(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function writeError(res, status, message) {
  writeJSON(res, { error: message }, status);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err6) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
function extractId(url, prefix) {
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const segment = rest.split("/")[0];
  const num = Number(segment);
  return Number.isFinite(num) && num > 0 ? num : null;
}
function handleSubjects(curriculumSvc2) {
  return (_req, res) => {
    const subjects = curriculumSvc2.listSubjects();
    const result = subjects.map((s) => ({
      ...s,
      progress: curriculumSvc2.getProgress(s.id)
    }));
    writeJSON(res, result);
  };
}
function handlePhases(curriculumSvc2) {
  return (req, res) => {
    const id = extractId(req.url ?? "", "/api/subjects/");
    if (id === null) {
      writeError(res, 400, "Invalid subject ID");
      return;
    }
    const phases = curriculumSvc2.getCurriculum(id);
    writeJSON(res, phases);
  };
}
function handleTopic(curriculumSvc2, qaSvc2, resourceSvc2) {
  return (req, res) => {
    const id = extractId(req.url ?? "", "/api/topics/");
    if (id === null) {
      writeError(res, 400, "Invalid topic ID");
      return;
    }
    const topic = curriculumSvc2.getTopic(id);
    if (!topic) {
      writeError(res, 404, "Topic not found");
      return;
    }
    const entries = qaSvc2.listEntries(id);
    const resources = resourceSvc2.listForTopic(id);
    writeJSON(res, { ...topic, entries, resources });
  };
}
function handleTopicResources(resourceSvc2) {
  return (req, res) => {
    const id = extractId(req.url ?? "", "/api/topics/");
    if (id === null) {
      writeError(res, 400, "Invalid topic ID");
      return;
    }
    const resources = resourceSvc2.listForTopic(id);
    writeJSON(res, resources);
  };
}
function handleTopicViz(vizSvc2) {
  return (req, res) => {
    const id = extractId(req.url ?? "", "/api/topics/");
    if (id === null) {
      writeError(res, 400, "Invalid topic ID");
      return;
    }
    const vizList = vizSvc2.listForTopic(id);
    writeJSON(res, vizList);
  };
}
function handleTopicExercises(exerciseSvc2) {
  return (req, res) => {
    const id = extractId(req.url ?? "", "/api/topics/");
    if (id === null) {
      writeError(res, 400, "Invalid topic ID");
      return;
    }
    const exercises = exerciseSvc2.listForTopic(id);
    writeJSON(res, exercises);
  };
}
function handleRunTests(exerciseSvc2) {
  return async (req, res) => {
    const id = extractId(req.url ?? "", "/api/exercises/");
    if (id === null) {
      writeError(res, 400, "Invalid exercise ID");
      return;
    }
    try {
      const results = await exerciseSvc2.runTests(id);
      writeJSON(res, results);
    } catch (err6) {
      const msg = err6 instanceof Error ? err6.message : String(err6);
      writeError(res, 500, msg);
    }
  };
}
function handleSubmitQuiz(exerciseSvc2) {
  return async (req, res) => {
    const id = extractId(req.url ?? "", "/api/exercises/");
    if (id === null) {
      writeError(res, 400, "Invalid exercise ID");
      return;
    }
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body?.answers)) {
        writeError(res, 400, 'Request body must have an "answers" array');
        return;
      }
      const result = exerciseSvc2.submitQuiz(id, body.answers);
      writeJSON(res, result);
    } catch (err6) {
      const msg = err6 instanceof Error ? err6.message : String(err6);
      writeError(res, 500, msg);
    }
  };
}
function handleSearch(qaSvc2) {
  return (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const query = url.searchParams.get("q") ?? "";
    if (!query) {
      writeJSON(res, []);
      return;
    }
    try {
      const results = qaSvc2.search(query);
      writeJSON(res, results);
    } catch (err6) {
      const msg = err6 instanceof Error ? err6.message : String(err6);
      writeError(res, 500, msg);
    }
  };
}

// src/dashboard/static/index.html
var static_default = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StudyDash</title>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/sql.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/rust.min.js"></script>
</head>
<body>

  <!-- Desktop sidebar (hidden on mobile) -->
  <div id="desktop-sidebar">
    <div class="sidebar-inner">
      <h1 style="font-size:18px;font-weight:700;color:var(--accent);margin-bottom:12px;">StudyDash</h1>
      <div id="sidebar-subjects" class="subject-switcher"></div>
      <div class="progress-bar" style="margin-bottom:14px;">
        <div id="sidebar-progress-fill" class="progress-fill" style="width:0%"></div>
        <span id="sidebar-progress-text" class="progress-text">0 / 0 topics</span>
      </div>
      <div id="sidebar-phases"></div>
    </div>
    <div class="sidebar-footer">
      <span class="sse-dot disconnected" id="sse-dot"></span>
      <kbd>Ctrl+K</kbd> Search
    </div>
  </div>

  <div class="page-container">

    <!-- ==================== PAGE: HOME ==================== -->
    <div id="page-home" class="page active">
      <div class="page-header">
        <h1>StudyDash</h1>
      </div>
      <div id="home-subjects" class="subject-switcher"></div>
      <div class="progress-bar">
        <div id="home-progress-fill" class="progress-fill" style="width:0%"></div>
        <span id="home-progress-text" class="progress-text">0 / 0 topics</span>
      </div>
      <div id="home-stats" class="stats-grid"></div>
      <div class="section-divider">Recently Active</div>
      <div id="home-recent"></div>
    </div>

    <!-- ==================== PAGE: TOPICS ==================== -->
    <div id="page-topics" class="page">
      <div class="page-header">
        <h1>Topics</h1>
      </div>
      <div id="topics-subjects" class="subject-switcher"></div>
      <div id="topics-phases"></div>
    </div>

    <!-- ==================== PAGE: TOPIC DETAIL ==================== -->
    <div id="page-topic" class="page">
      <button class="back-btn" onclick="showPage('topics')">&larr; Back to Topics</button>
      <div class="topic-title-row">
        <h2 id="topic-name"></h2>
        <span id="topic-status" class="badge"></span>
      </div>
      <p id="topic-desc" class="topic-desc"></p>
      <div class="tabs">
        <button class="tab-btn active" data-tab="qa" onclick="switchTab('qa')">Q&amp;A</button>
        <button class="tab-btn" data-tab="viz" onclick="switchTab('viz')">Visualize</button>
        <button class="tab-btn" data-tab="exercises" onclick="switchTab('exercises')">Exercises</button>
        <button class="tab-btn" data-tab="resources" onclick="switchTab('resources')">Resources</button>
      </div>
      <div id="tab-qa" class="tab-panel active"></div>
      <div id="tab-viz" class="tab-panel"></div>
      <div id="tab-exercises" class="tab-panel"></div>
      <div id="tab-resources" class="tab-panel"></div>
    </div>

    <!-- ==================== PAGE: SEARCH ==================== -->
    <div id="page-search" class="page">
      <div class="page-header">
        <h1>Search</h1>
      </div>
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search questions, answers, notes..." autocomplete="off">
      </div>
      <div id="search-results"></div>
    </div>

  </div>

  <!-- Mobile bottom nav -->
  <nav class="mobile-nav">
    <button class="nav-btn active" data-page="home" onclick="showPage('home')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Home
    </button>
    <button class="nav-btn" data-page="topics" onclick="showPage('topics')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      Topics
    </button>
    <button class="nav-btn" data-page="search" onclick="showPage('search')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Search
    </button>
  </nav>

  <!-- Search modal (desktop Ctrl+K) -->
  <div id="search-modal" class="modal hidden">
    <div class="modal-backdrop" onclick="closeSearchModal()"></div>
    <div class="modal-content">
      <input id="modal-search-input" type="text" placeholder="Search questions, answers, notes..." autocomplete="off">
      <div id="modal-search-results" class="modal-results"></div>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
`;

// src/dashboard/static/app.js
var app_default = `// StudyDash \u2014 Dashboard Application
// Connects to the learn-cc API and renders a responsive learning dashboard.

// --- Markdown config ---
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// --- State ---
const state = {
  subjects: [],
  activeSubject: null,
  phases: [],
  activeTopic: null,
  activeTab: 'qa',
  topicData: null,
  topicViz: [],
  topicExercises: [],
  topicResources: [],
  searchTimeout: null,
  vizIndex: 0,
  vizStep: 0,
};

// --- API Helper ---
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(\`API error: \${res.status}\`);
  return res.json();
}

// --- Sanitize viz HTML ---
function sanitizeVizHtml(html) {
  const allowed = ['div', 'span', 'small', 'br', 'code', 'strong', 'em'];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove all script tags
  tmp.querySelectorAll('script').forEach(el => el.remove());
  // Walk all elements, remove disallowed tags, strip non-class/style attributes
  const walk = (node) => {
    const children = [...node.children];
    for (const child of children) {
      if (!allowed.includes(child.tagName.toLowerCase())) {
        child.replaceWith(...child.childNodes);
      } else {
        [...child.attributes].forEach(attr => {
          if (attr.name !== 'class' && attr.name !== 'style') child.removeAttribute(attr.name);
        });
        walk(child);
      }
    }
  };
  walk(tmp);
  return tmp.innerHTML;
}

// --- Escape HTML for text content in templates ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Format time ---
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return escapeHtml(text);
  return escapeHtml(text.substring(0, max)) + '...';
}

// --- On load ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    state.subjects = await api('/api/subjects');
  } catch {
    state.subjects = [];
  }

  if (state.subjects.length > 0) {
    state.activeSubject = state.subjects[0];
    await loadSubject();
  }

  renderAllSubjectSwitchers();
  renderHome();
  connectSSE();
});

// --- SSE ---
function connectSSE() {
  const dot = document.getElementById('sse-dot');
  let evtSource;

  function connect() {
    evtSource = new EventSource('/api/events');

    evtSource.onopen = () => {
      if (dot) { dot.classList.remove('disconnected'); dot.classList.add('connected'); }
    };

    evtSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          await refresh();
        }
      } catch { /* ignore parse errors */ }
    };

    evtSource.onerror = () => {
      if (dot) { dot.classList.remove('connected'); dot.classList.add('disconnected'); }
      evtSource.close();
      setTimeout(connect, 3000);
    };
  }

  connect();
}

async function refresh() {
  // Re-fetch subjects
  try {
    state.subjects = await api('/api/subjects');
  } catch { /* keep existing */ }

  if (state.activeSubject) {
    // Refresh the active subject from the new list
    const updated = state.subjects.find(s => s.id === state.activeSubject.id);
    if (updated) state.activeSubject = updated;
    await loadSubject();
  }

  renderAllSubjectSwitchers();

  // Re-render current view
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id.replace('page-', '');
    if (pageId === 'home') renderHome();
    else if (pageId === 'topics') renderTopicsPage();
    else if (pageId === 'topic' && state.activeTopic) await selectTopic(state.activeTopic);
  }
}

// --- Subject management ---
async function loadSubject() {
  if (!state.activeSubject) return;
  try {
    state.phases = await api(\`/api/subjects/\${state.activeSubject.id}/phases\`);
  } catch {
    state.phases = [];
  }
  renderSidebar();
}

async function switchSubject(id) {
  const subject = state.subjects.find(s => s.id === id);
  if (!subject) return;
  state.activeSubject = subject;
  state.activeTopic = null;
  state.topicData = null;
  await loadSubject();
  renderAllSubjectSwitchers();
  renderHome();
  renderTopicsPage();
  // If on topic detail page, go back to topics
  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id === 'page-topic') {
    showPage('topics');
  }
}

function renderAllSubjectSwitchers() {
  const containers = ['home-subjects', 'topics-subjects', 'sidebar-subjects'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (state.subjects.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = state.subjects.map(s =>
      \`<button class="subject-btn \${state.activeSubject && state.activeSubject.id === s.id ? 'active' : ''}"
              onclick="switchSubject(\${s.id})">\${escapeHtml(s.name)}</button>\`
    ).join('');
  });
}

// --- Progress ---
function renderProgress() {
  if (!state.activeSubject) return;
  const p = state.activeSubject.progress || {};
  const total = p.total_topics || 0;
  const done = p.done || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const text = \`\${done} / \${total} topics\`;

  // Home progress
  const hFill = document.getElementById('home-progress-fill');
  const hText = document.getElementById('home-progress-text');
  if (hFill) hFill.style.width = pct + '%';
  if (hText) hText.textContent = text;

  // Sidebar progress
  const sFill = document.getElementById('sidebar-progress-fill');
  const sText = document.getElementById('sidebar-progress-text');
  if (sFill) sFill.style.width = pct + '%';
  if (sText) sText.textContent = text;
}

// --- Sidebar ---
function renderSidebar() {
  renderProgress();
  const container = document.getElementById('sidebar-phases');
  if (!container) return;

  if (state.phases.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No phases yet</p></div>';
    return;
  }

  container.innerHTML = state.phases.map(phase => {
    const topics = phase.topics || [];
    const doneCount = topics.filter(t => t.status === 'done').length;
    return \`
      <div class="phase-group">
        <div class="phase-header" onclick="togglePhase(this)">
          \${escapeHtml(phase.name)}
          <span style="font-size:10px;color:var(--text-muted)">\${doneCount}/\${topics.length}</span>
          <span class="chevron">&#9660;</span>
        </div>
        <div class="phase-topics">
          \${topics.map(t => \`
            <div class="topic-item \${state.activeTopic === t.id ? 'active' : ''}"
                 onclick="selectTopic(\${t.id})"
                 data-topic-id="\${t.id}">
              <span class="status-dot \${escapeHtml(t.status)}"></span>
              <span>\${escapeHtml(t.name)}</span>
            </div>
          \`).join('')}
        </div>
      </div>\`;
  }).join('');
}

function togglePhase(el) {
  el.classList.toggle('collapsed');
  el.nextElementSibling.classList.toggle('collapsed');
}

// --- Home page ---
function renderHome() {
  renderProgress();

  const statsEl = document.getElementById('home-stats');
  const recentEl = document.getElementById('home-recent');

  if (state.subjects.length === 0) {
    if (statsEl) statsEl.innerHTML = '';
    if (recentEl) recentEl.innerHTML = \`
      <div class="empty-state">
        <p>Welcome to StudyDash!</p>
        <p>Start by creating a subject with <code>/learn</code></p>
      </div>\`;
    return;
  }

  const p = state.activeSubject ? (state.activeSubject.progress || {}) : {};

  if (statsEl) {
    statsEl.innerHTML = \`
      <div class="stat-card">
        <div class="stat-value">\${p.done || 0}</div>
        <div class="stat-label">Topics Done</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">\${p.total_entries || 0}</div>
        <div class="stat-label">Q&amp;A Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value yellow">\${p.total_exercises || 0}</div>
        <div class="stat-label">Exercises</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">\${p.total_viz || 0}</div>
        <div class="stat-label">Visualizations</div>
      </div>\`;
  }

  // Show recently active topics (in_progress first, then by updated_at)
  if (recentEl) {
    const allTopics = state.phases.flatMap(ph => (ph.topics || []).map(t => ({ ...t, phaseName: ph.name })));
    const active = allTopics
      .filter(t => t.status !== 'todo')
      .sort((a, b) => {
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
        return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
      })
      .slice(0, 5);

    if (active.length === 0) {
      recentEl.innerHTML = \`<div class="empty-state"><p>No active topics yet. Import a curriculum with <code>/learn import</code></p></div>\`;
    } else {
      recentEl.innerHTML = active.map(t => \`
        <div class="exercise-card" style="cursor:pointer" onclick="selectTopic(\${t.id})">
          <div class="exercise-header">
            <span class="exercise-title">\${escapeHtml(t.name)}</span>
            <span class="badge \${escapeHtml(t.status)}">\${escapeHtml(t.status.replace('_', ' '))}</span>
          </div>
          <div class="exercise-desc">\${escapeHtml(t.phaseName)}</div>
        </div>
      \`).join('');
    }
  }
}

// --- Topics page ---
function renderTopicsPage() {
  const container = document.getElementById('topics-phases');
  if (!container) return;

  if (state.phases.length === 0) {
    container.innerHTML = \`<div class="empty-state"><p>No topics yet.</p><p>Import a curriculum with <code>/learn import</code></p></div>\`;
    return;
  }

  container.innerHTML = state.phases.map(phase => {
    const topics = phase.topics || [];
    return \`
      <div class="phase-group">
        <div class="phase-header" onclick="togglePhase(this)">
          \${escapeHtml(phase.name)}
          <span class="chevron">&#9660;</span>
        </div>
        <div class="phase-topics">
          \${topics.map(t => \`
            <div class="topic-item \${state.activeTopic === t.id ? 'active' : ''}"
                 onclick="selectTopic(\${t.id})">
              <span class="status-dot \${escapeHtml(t.status)}"></span>
              \${escapeHtml(t.name)}
              <span class="topic-count"></span>
            </div>
          \`).join('')}
        </div>
      </div>\`;
  }).join('');
}

// --- Topic selection ---
async function selectTopic(id) {
  state.activeTopic = id;
  state.activeTab = 'qa';

  // Fetch topic detail, viz, exercises, and resources in parallel
  try {
    const [topicData, viz, exercises, resources] = await Promise.all([
      api(\`/api/topics/\${id}\`),
      api(\`/api/topics/\${id}/viz\`).catch(() => []),
      api(\`/api/topics/\${id}/exercises\`).catch(() => []),
      api(\`/api/topics/\${id}/resources\`).catch(() => []),
    ]);

    state.topicData = topicData;
    state.topicViz = viz || [];
    state.topicExercises = exercises || [];
    state.topicResources = resources || [];
  } catch {
    state.topicData = null;
    state.topicViz = [];
    state.topicExercises = [];
    state.topicResources = [];
  }

  // Update sidebar active state
  document.querySelectorAll('.topic-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset?.topicId) === id);
  });

  showPage('topic');
  renderTopicDetail();
  switchTab('qa');
}

function renderTopicDetail() {
  const data = state.topicData;
  if (!data) return;

  document.getElementById('topic-name').textContent = data.name || '';
  const statusEl = document.getElementById('topic-status');
  statusEl.textContent = (data.status || '').replace('_', ' ');
  statusEl.className = \`badge \${data.status || ''}\`;
  document.getElementById('topic-desc').textContent = data.description || '';
}

// --- Tab switching ---
function switchTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll('#page-topic .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('#page-topic .tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === \`tab-\${tab}\`);
  });

  // Render tab content
  if (tab === 'qa') renderQATab();
  else if (tab === 'viz') renderVizTab();
  else if (tab === 'exercises') renderExercisesTab();
  else if (tab === 'resources') renderResourcesTab();
}

// --- Q&A Tab ---
function renderQATab() {
  const container = document.getElementById('tab-qa');
  if (!container) return;

  const entries = state.topicData?.entries || [];

  if (entries.length === 0) {
    container.innerHTML = \`<div class="empty-state"><p>No Q&amp;A entries yet</p><p>Ask questions in Claude to see them here</p></div>\`;
    return;
  }

  // Group entries into Q&A cards by question_id
  const questionMap = new Map();
  const groups = [];

  entries.forEach(e => {
    if (e.kind === 'question') {
      const group = { question: e, answers: [] };
      questionMap.set(e.id, group);
      groups.push(group);
    } else if (e.question_id && questionMap.has(e.question_id)) {
      questionMap.get(e.question_id).answers.push(e);
    } else {
      groups.push({ standalone: e });
    }
  });

  // marked.parse is used intentionally for markdown rendering (same as go-learn)
  container.innerHTML = groups.map(g => {
    if (g.standalone) {
      const e = g.standalone;
      return \`
        <div class="entry-card">
          <div class="entry-header">
            <span class="entry-kind \${escapeHtml(e.kind)}">\${escapeHtml(e.kind)}</span>
            <span>\${formatTime(e.created_at)}</span>
          </div>
          <div class="entry-body">\${marked.parse(e.content || '')}</div>
        </div>\`;
    }

    const q = g.question;
    let html = \`<div class="qa-card">\`;
    html += \`
      <div class="qa-question">
        <div class="entry-header">
          <span class="entry-kind question">question</span>
          <span>\${formatTime(q.created_at)}</span>
        </div>
        <div class="entry-body">\${marked.parse(q.content || '')}</div>
      </div>\`;

    g.answers.forEach(a => {
      html += \`
        <div class="qa-answer">
          <div class="entry-header">
            <span class="entry-kind \${escapeHtml(a.kind)}">\${escapeHtml(a.kind)}</span>
            <span>\${formatTime(a.created_at)}</span>
          </div>
          <div class="entry-body">\${marked.parse(a.content || '')}</div>
        </div>\`;
    });

    html += \`</div>\`;
    return html;
  }).join('');
}

// --- Visualize Tab ---
function renderVizTab() {
  const container = document.getElementById('tab-viz');
  if (!container) return;

  const vizList = state.topicViz;

  if (!vizList || vizList.length === 0) {
    container.innerHTML = \`<div class="empty-state"><p>No visualizations yet</p><p>Visualizations will appear here as you learn</p></div>\`;
    return;
  }

  // Reset viz state
  state.vizIndex = 0;
  state.vizStep = 0;

  renderVizSelector(container);
}

function renderVizSelector(container) {
  if (!container) container = document.getElementById('tab-viz');
  if (!container) return;

  const vizList = state.topicViz;
  if (!vizList || vizList.length === 0) return;

  let html = \`<div class="viz-selector">\`;
  vizList.forEach((v, i) => {
    html += \`<button class="viz-select-btn \${i === state.vizIndex ? 'active' : ''}" onclick="selectViz(\${i})">\${escapeHtml(v.title)}</button>\`;
  });
  html += \`</div>\`;
  html += \`<div id="viz-stage-container"></div>\`;

  container.innerHTML = html;
  renderVizStage();
}

function selectViz(index) {
  state.vizIndex = index;
  state.vizStep = 0;

  // Update selector buttons
  document.querySelectorAll('.viz-select-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  renderVizStage();
}

function renderVizStage() {
  const stageContainer = document.getElementById('viz-stage-container');
  if (!stageContainer) return;

  const viz = state.topicViz[state.vizIndex];
  if (!viz) return;

  let steps;
  try {
    steps = typeof viz.steps_json === 'string' ? JSON.parse(viz.steps_json) : viz.steps_json;
  } catch {
    stageContainer.innerHTML = \`<div class="empty-state"><p>Invalid visualization data</p></div>\`;
    return;
  }

  if (!steps || steps.length === 0) {
    stageContainer.innerHTML = \`<div class="empty-state"><p>No steps in this visualization</p></div>\`;
    return;
  }

  const step = steps[state.vizStep] || steps[0];
  const totalSteps = steps.length;

  // sanitizeVizHtml strips dangerous content, allowing only safe tags with class/style
  stageContainer.innerHTML = \`
    <div class="viz-stage">
      <div class="viz-canvas">\${sanitizeVizHtml(step.html || step.canvas || '')}</div>
      \${step.description || step.desc ? \`<div class="viz-description">\${sanitizeVizHtml(step.description || step.desc || '')}</div>\` : ''}
      <div class="viz-controls">
        <button onclick="vizPrev()" \${state.vizStep === 0 ? 'disabled' : ''}>Prev</button>
        <span class="viz-step-label">Step \${state.vizStep + 1} / \${totalSteps}</span>
        <button onclick="vizNext()" \${state.vizStep >= totalSteps - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </div>\`;
}

function vizPrev() {
  if (state.vizStep > 0) {
    state.vizStep--;
    renderVizStage();
  }
}

function vizNext() {
  const viz = state.topicViz[state.vizIndex];
  if (!viz) return;
  let steps;
  try {
    steps = typeof viz.steps_json === 'string' ? JSON.parse(viz.steps_json) : viz.steps_json;
  } catch { return; }
  if (state.vizStep < (steps?.length || 1) - 1) {
    state.vizStep++;
    renderVizStage();
  }
}

// --- Exercises Tab ---
function renderExercisesTab() {
  const container = document.getElementById('tab-exercises');
  if (!container) return;

  const exercises = state.topicExercises;

  if (!exercises || exercises.length === 0) {
    container.innerHTML = \`<div class="empty-state"><p>No exercises yet</p><p>Exercises are generated when you complete topics</p></div>\`;
    return;
  }

  container.innerHTML = exercises.map((ex, i) => {
    const results = ex.results || [];
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const hasPassed = total > 0 && passed === total;

    let detailHtml = '';

    // Quiz type
    if (ex.type === 'quiz' && ex.quiz_json) {
      let quiz;
      try {
        quiz = typeof ex.quiz_json === 'string' ? JSON.parse(ex.quiz_json) : ex.quiz_json;
      } catch { quiz = null; }

      if (quiz && Array.isArray(quiz)) {
        detailHtml += \`<h4>Questions</h4>\`;
        detailHtml += quiz.map((q, qi) => \`
          <div class="quiz-question" data-exercise="\${i}" data-question="\${qi}">
            <p>\${marked.parse(q.question || q.text || '')}</p>
            \${(q.options || q.choices || []).map((opt, oi) => \`
              <div class="quiz-option" data-exercise="\${i}" data-question="\${qi}" data-option="\${oi}" onclick="selectQuizOption(this)">
                \${escapeHtml(opt)}
              </div>
            \`).join('')}
          </div>
        \`).join('');
        detailHtml += \`
          <div class="exercise-actions">
            <button class="exercise-action-btn btn-primary" onclick="submitQuiz(\${ex.id}, \${i})">Submit Answers</button>
          </div>\`;
      }
    }

    // Coding type \u2014 test cases
    if (ex.type === 'coding' || ex.type === 'project' || ex.type === 'assignment') {
      if (results.length > 0) {
        detailHtml += \`<h4>Test Results</h4>\`;
        detailHtml += results.map(r => \`
          <div class="test-case">
            <div class="test-case-header">
              <span class="test-status \${r.passed ? 'pass' : 'fail'}"></span>
              \${escapeHtml(r.test_name)}
            </div>
            \${r.output ? \`<div class="test-case-body">\${truncate(r.output, 300)}</div>\` : ''}
          </div>
        \`).join('');

        detailHtml += \`
          <div class="exercise-progress">
            <span>\${passed}/\${total} tests</span>
            <div class="exercise-progress-bar">
              <div class="exercise-progress-fill \${hasPassed ? 'green' : 'yellow'}" style="width:\${total > 0 ? Math.round(passed / total * 100) : 0}%"></div>
            </div>
          </div>\`;
      }

      detailHtml += \`
        <div class="exercise-actions">
          <button class="exercise-action-btn btn-primary" onclick="runExercise(\${ex.id}, \${i})">Run Tests</button>
        </div>\`;
    }

    return \`
      <div class="exercise-card expandable" id="exercise-\${i}">
        <div class="exercise-header" onclick="toggleExercise(\${i})">
          <span class="exercise-title">\${escapeHtml(ex.title)}</span>
          <span class="exercise-type \${escapeHtml(ex.type)}">\${escapeHtml(ex.type)}</span>
          <span class="exercise-expand-icon">&#9660;</span>
        </div>
        <div class="exercise-desc">\${escapeHtml(ex.description || '')}</div>
        <div class="exercise-meta">
          \${ex.difficulty ? \`<span>Difficulty: \${escapeHtml(ex.difficulty)}</span>\` : ''}
          \${ex.est_minutes ? \`<span>\${ex.est_minutes} min</span>\` : ''}
          \${ex.source ? \`<span>Source: \${escapeHtml(ex.source)}</span>\` : ''}
          \${ex.status ? \`<span>Status: \${escapeHtml(ex.status)}</span>\` : ''}
        </div>
        <div class="exercise-detail" id="exercise-detail-\${i}">
          \${detailHtml}
        </div>
      </div>\`;
  }).join('');
}

function toggleExercise(index) {
  const detail = document.getElementById('exercise-detail-' + index);
  const card = detail ? detail.closest('.exercise-card') : null;
  if (detail) detail.classList.toggle('open');
  if (card) card.classList.toggle('open');
}

function selectQuizOption(el) {
  const questionEl = el.closest('.quiz-question');
  if (questionEl) {
    questionEl.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
  }
  el.classList.add('selected');
}

async function submitQuiz(exerciseId, cardIndex) {
  const card = document.getElementById(\`exercise-\${cardIndex}\`);
  if (!card) return;

  const answers = [];
  card.querySelectorAll('.quiz-question').forEach(q => {
    const selected = q.querySelector('.quiz-option.selected');
    if (selected) {
      answers.push(parseInt(selected.dataset.option));
    } else {
      answers.push(-1);
    }
  });

  try {
    const result = await fetch(\`/api/exercises/\${exerciseId}/submit\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const data = await result.json();

    if (data.results) {
      data.results.forEach((r, i) => {
        const questionEl = card.querySelectorAll('.quiz-question')[i];
        if (!questionEl) return;
        questionEl.querySelectorAll('.quiz-option').forEach((opt, oi) => {
          opt.classList.remove('selected');
          if (oi === r.correct_index) opt.classList.add('correct');
          else if (oi === answers[i] && !r.passed) opt.classList.add('incorrect');
        });
      });
    }

    if (data.score !== undefined) {
      const actionsEl = card.querySelector('.exercise-actions');
      if (actionsEl) {
        const scoreDiv = document.createElement('div');
        scoreDiv.style.cssText = \`margin-top:8px;font-size:14px;font-weight:600;color:\${data.passed ? 'var(--green)' : 'var(--yellow)'}\`;
        scoreDiv.textContent = \`Score: \${data.score}/\${data.total}\${data.passed ? ' - Passed!' : ''}\`;
        actionsEl.appendChild(scoreDiv);
      }
    }
  } catch (err) {
    console.error('Submit quiz error:', err);
  }
}

async function runExercise(exerciseId, cardIndex) {
  const btn = document.querySelector(\`#exercise-\${cardIndex} .btn-primary\`);
  if (btn) { btn.textContent = 'Running...'; btn.disabled = true; }

  try {
    const res = await fetch(\`/api/exercises/\${exerciseId}/run\`, { method: 'POST' });
    const data = await res.json();

    if (data.results && state.topicExercises[cardIndex]) {
      state.topicExercises[cardIndex].results = data.results;
    }

    renderExercisesTab();

    // Re-open the card
    const detail = document.getElementById(\`exercise-detail-\${cardIndex}\`);
    if (detail) detail.classList.add('open');
  } catch (err) {
    console.error('Run exercise error:', err);
    if (btn) { btn.textContent = 'Run Tests'; btn.disabled = false; }
  }
}

// --- Resources Tab ---
function renderResourcesTab() {
  const container = document.getElementById('tab-resources');
  if (!container) return;

  const resources = state.topicResources || [];

  if (resources.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No resources yet</p><p class="text-muted">Ask Claude to add reference links for this topic</p></div>';
    return;
  }

  let html = '<div class="resources-list">';
  for (const r of resources) {
    html += '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener" class="resource-card">' +
      '<span class="resource-title">' + escapeHtml(r.title) + '</span>' +
      '<span class="resource-url">' + escapeHtml(r.url) + '</span>' +
      '</a>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// --- Navigation ---
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const target = document.getElementById(\`page-\${page}\`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'home') renderHome();
  else if (page === 'topics') renderTopicsPage();
  else if (page === 'search') document.getElementById('search-input')?.focus();
}

// --- Search ---
const searchInput = document.getElementById('search-input');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => doSearch(e.target.value, 'search-results'), 200);
  });
}

const modalSearchInput = document.getElementById('modal-search-input');
if (modalSearchInput) {
  modalSearchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => doSearch(e.target.value, 'modal-search-results'), 200);
  });
}

async function doSearch(query, resultsContainerId) {
  const container = document.getElementById(resultsContainerId);
  if (!container) return;

  if (!query || !query.trim()) {
    container.innerHTML = '';
    return;
  }

  try {
    const results = await api(\`/api/search?q=\${encodeURIComponent(query)}\`);

    if (!results || results.length === 0) {
      container.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    container.innerHTML = results.map(r => \`
      <div class="search-result-item" onclick="closeSearchModal(); selectTopic(\${r.topic_id})">
        <div class="search-result-meta">
          <span class="entry-kind \${escapeHtml(r.kind)}">\${escapeHtml(r.kind)}</span>
        </div>
        <div class="search-result-content">\${truncate(r.content, 150)}</div>
      </div>
    \`).join('');
  } catch {
    container.innerHTML = '<div class="search-no-results">Search failed</div>';
  }
}

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const input = document.getElementById('modal-search-input');
    if (input) { input.value = ''; input.focus(); }
    const results = document.getElementById('modal-search-results');
    if (results) results.innerHTML = '';
  }
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) modal.classList.add('hidden');
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openSearchModal();
  }
  if (e.key === 'Escape') {
    closeSearchModal();
  }
});
`;

// src/dashboard/static/styles.css
var styles_default = "/* ===== CSS VARIABLES (Dark Theme) ===== */\n:root {\n  --bg: #0d1117;\n  --bg-secondary: #161b22;\n  --bg-tertiary: #21262d;\n  --border: #30363d;\n  --text: #e6edf3;\n  --text-muted: #8b949e;\n  --accent: #58a6ff;\n  --green: #3fb950;\n  --yellow: #d29922;\n  --red: #f85149;\n  --purple: #bc8cff;\n  --radius: 8px;\n}\n\n* { margin: 0; padding: 0; box-sizing: border-box; }\n\nbody {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;\n  background: var(--bg);\n  color: var(--text);\n  min-height: 100vh;\n  overflow-x: hidden;\n}\n\n.hidden { display: none !important; }\n\n/* ===== MOBILE NAV ===== */\n.mobile-nav {\n  position: fixed;\n  bottom: 0;\n  left: 0;\n  right: 0;\n  background: var(--bg-secondary);\n  border-top: 1px solid var(--border);\n  display: flex;\n  z-index: 100;\n  padding-bottom: env(safe-area-inset-bottom);\n}\n\n.nav-btn {\n  flex: 1;\n  padding: 10px 4px;\n  background: none;\n  border: none;\n  color: var(--text-muted);\n  font-size: 10px;\n  font-family: inherit;\n  cursor: pointer;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 3px;\n  transition: color 0.15s;\n}\n\n.nav-btn.active { color: var(--accent); }\n.nav-btn svg { width: 22px; height: 22px; }\n\n/* ===== PAGES ===== */\n.page { display: none; padding: 16px 16px 80px; }\n.page.active { display: block; }\n\n/* ===== HEADER ===== */\n.page-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 16px;\n}\n\n.page-header h1 {\n  font-size: 20px;\n  font-weight: 700;\n  color: var(--accent);\n}\n\n/* ===== SUBJECT SWITCHER ===== */\n.subject-switcher {\n  display: flex;\n  gap: 6px;\n  margin-bottom: 14px;\n  overflow-x: auto;\n  padding-bottom: 4px;\n  -webkit-overflow-scrolling: touch;\n}\n\n.subject-btn {\n  padding: 6px 14px;\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  border-radius: 16px;\n  color: var(--text-muted);\n  font-size: 13px;\n  cursor: pointer;\n  font-family: inherit;\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n.subject-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,0.1); }\n\n/* ===== PROGRESS BAR ===== */\n.progress-bar {\n  position: relative;\n  height: 26px;\n  background: var(--bg-tertiary);\n  border-radius: 13px;\n  overflow: hidden;\n  margin-bottom: 16px;\n}\n\n.progress-fill {\n  height: 100%;\n  background: linear-gradient(90deg, var(--green), var(--accent));\n  border-radius: 13px;\n  transition: width 0.5s ease;\n}\n\n.progress-text {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n/* ===== STATS GRID ===== */\n.stats-grid {\n  display: grid;\n  grid-template-columns: repeat(2, 1fr);\n  gap: 10px;\n  margin-bottom: 20px;\n}\n\n.stat-card {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  padding: 14px;\n  text-align: center;\n}\n\n.stat-value {\n  font-size: 24px;\n  font-weight: 700;\n  color: var(--accent);\n}\n\n.stat-value.green { color: var(--green); }\n.stat-value.yellow { color: var(--yellow); }\n.stat-value.purple { color: var(--purple); }\n\n.stat-label {\n  font-size: 11px;\n  color: var(--text-muted);\n  margin-top: 2px;\n}\n\n/* ===== SECTION DIVIDER ===== */\n.section-divider {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--text-muted);\n  margin: 16px 0 10px;\n}\n\n/* ===== PHASE TREE (Topics page) ===== */\n.phase-group { margin-bottom: 8px; }\n\n.phase-header {\n  padding: 10px 14px;\n  font-size: 12px;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--text-muted);\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  user-select: none;\n}\n\n.phase-header:hover { color: var(--text); }\n\n.phase-header .chevron {\n  transition: transform 0.2s;\n  font-size: 14px;\n}\n\n.phase-header.collapsed .chevron { transform: rotate(-90deg); }\n\n.phase-topics { padding: 4px 0; }\n.phase-topics.collapsed { display: none; }\n\n.topic-item {\n  padding: 10px 14px 10px 20px;\n  font-size: 14px;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  color: var(--text-muted);\n  border-left: 3px solid transparent;\n  transition: all 0.15s;\n}\n\n.topic-item:active { background: var(--bg-tertiary); }\n.topic-item.active { background: var(--bg-tertiary); color: var(--text); border-left-color: var(--accent); }\n\n.status-dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  flex-shrink: 0;\n}\n\n.status-dot.done { background: var(--green); }\n.status-dot.in_progress { background: var(--yellow); }\n.status-dot.todo { background: var(--bg-tertiary); border: 1.5px solid var(--text-muted); }\n\n.topic-count {\n  margin-left: auto;\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n/* ===== BACK BUTTON ===== */\n.back-btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  background: none;\n  border: none;\n  color: var(--accent);\n  font-size: 14px;\n  font-family: inherit;\n  cursor: pointer;\n  margin-bottom: 12px;\n  padding: 4px 0;\n}\n\n/* ===== TOPIC DETAIL ===== */\n.topic-title-row {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 6px;\n  flex-wrap: wrap;\n}\n\n.topic-title-row h2 { font-size: 18px; font-weight: 600; }\n\n.badge {\n  font-size: 10px;\n  font-weight: 600;\n  padding: 3px 10px;\n  border-radius: 12px;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n\n.badge.todo { background: var(--bg-tertiary); color: var(--text-muted); }\n.badge.in_progress { background: rgba(210,153,34,0.15); color: var(--yellow); }\n.badge.done { background: rgba(63,185,80,0.15); color: var(--green); }\n\n.topic-desc {\n  color: var(--text-muted);\n  font-size: 13px;\n  margin-bottom: 14px;\n  line-height: 1.4;\n}\n\n/* ===== TABS ===== */\n.tabs {\n  display: flex;\n  gap: 4px;\n  margin-bottom: 16px;\n  overflow-x: auto;\n  padding-bottom: 4px;\n  -webkit-overflow-scrolling: touch;\n}\n\n.tab-btn {\n  padding: 7px 14px;\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  color: var(--text-muted);\n  cursor: pointer;\n  font-size: 13px;\n  font-family: inherit;\n  white-space: nowrap;\n  flex-shrink: 0;\n  transition: all 0.15s;\n}\n\n.tab-btn:hover { color: var(--text); background: var(--bg-tertiary); }\n.tab-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,0.1); }\n\n.tab-panel { display: none; }\n.tab-panel.active { display: block; }\n\n/* ===== Q&A CARDS ===== */\n.qa-card {\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  overflow: hidden;\n  margin-bottom: 14px;\n}\n\n.qa-question { background: var(--bg-secondary); border-bottom: 1px solid var(--border); }\n.qa-answer { background: var(--bg-secondary); }\n.qa-answer + .qa-answer { border-top: 1px solid var(--border); }\n\n.entry-card {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  overflow: hidden;\n  margin-bottom: 14px;\n}\n\n.entry-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 14px;\n  background: var(--bg-tertiary);\n  font-size: 11px;\n  color: var(--text-muted);\n  border-bottom: 1px solid var(--border);\n}\n\n.entry-kind {\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n\n.entry-kind.question { color: var(--accent); }\n.entry-kind.answer { color: var(--green); }\n.entry-kind.note { color: var(--purple); }\n\n.entry-body {\n  padding: 14px;\n  font-size: 14px;\n  line-height: 1.6;\n  background: var(--bg-secondary);\n}\n\n.entry-body p { margin-bottom: 10px; }\n.entry-body p:last-child { margin-bottom: 0; }\n\n.entry-body h1, .entry-body h2, .entry-body h3 {\n  margin-top: 16px;\n  margin-bottom: 8px;\n}\n\n.entry-body h1:first-child, .entry-body h2:first-child, .entry-body h3:first-child {\n  margin-top: 0;\n}\n\n.entry-body code {\n  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;\n  font-size: 13px;\n}\n\n.entry-body :not(pre) > code {\n  background: var(--bg-tertiary);\n  padding: 2px 5px;\n  border-radius: 4px;\n  font-size: 12px;\n}\n\n.entry-body pre {\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  padding: 12px;\n  overflow-x: auto;\n  margin: 8px 0;\n  -webkit-overflow-scrolling: touch;\n}\n\n.entry-body pre code {\n  background: none;\n  padding: 0;\n  font-size: 12px;\n  color: var(--text);\n}\n\n.entry-body ul, .entry-body ol {\n  padding-left: 24px;\n  margin-bottom: 12px;\n}\n\n.entry-body li { margin-bottom: 4px; }\n\n.entry-body blockquote {\n  border-left: 3px solid var(--accent);\n  padding-left: 16px;\n  color: var(--text-muted);\n  margin: 12px 0;\n}\n\n.entry-body table {\n  width: 100%;\n  border-collapse: collapse;\n  margin: 12px 0;\n}\n\n.entry-body th, .entry-body td {\n  border: 1px solid var(--border);\n  padding: 8px 12px;\n  text-align: left;\n}\n\n.entry-body th {\n  background: var(--bg-tertiary);\n  font-weight: 600;\n}\n\n/* ===== VIZ PANEL ===== */\n.viz-selector {\n  display: flex;\n  gap: 6px;\n  margin-bottom: 14px;\n  overflow-x: auto;\n  -webkit-overflow-scrolling: touch;\n  padding-bottom: 4px;\n}\n\n.viz-select-btn {\n  padding: 7px 12px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  color: var(--text-muted);\n  cursor: pointer;\n  font-size: 12px;\n  font-family: inherit;\n  white-space: nowrap;\n  flex-shrink: 0;\n  transition: all 0.15s;\n}\n\n.viz-select-btn:hover { color: var(--text); border-color: var(--text-muted); }\n.viz-select-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,0.1); }\n\n.viz-stage {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  overflow: hidden;\n}\n\n.viz-canvas {\n  padding: 20px 12px;\n  min-height: 140px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.viz-description {\n  padding: 14px;\n  border-top: 1px solid var(--border);\n  font-size: 13px;\n  line-height: 1.6;\n}\n\n.viz-description code {\n  background: var(--bg-tertiary);\n  padding: 2px 5px;\n  border-radius: 4px;\n  font-size: 11px;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  color: var(--accent);\n}\n\n.viz-controls {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 14px;\n  padding: 10px;\n  border-top: 1px solid var(--border);\n  background: var(--bg-tertiary);\n}\n\n.viz-controls button {\n  padding: 8px 18px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  color: var(--text);\n  cursor: pointer;\n  font-size: 13px;\n  font-family: inherit;\n  transition: all 0.15s;\n}\n\n.viz-controls button:hover:not(:disabled) {\n  border-color: var(--accent);\n  color: var(--accent);\n}\n\n.viz-controls button:disabled { opacity: 0.3; cursor: default; }\n\n.viz-step-label { font-size: 12px; color: var(--text-muted); min-width: 80px; text-align: center; }\n\n/* Viz primitives */\n.viz-box {\n  padding: 10px 14px;\n  border-radius: 8px;\n  font-size: 12px;\n  font-weight: 600;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  text-align: center;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 4px;\n}\n\n.viz-box-label {\n  font-size: 10px;\n  color: var(--text-muted);\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n  font-weight: 400;\n}\n\n.viz-arrow { font-size: 20px; color: var(--accent); }\n\n.box-blue { background: rgba(88,166,255,0.15); border: 1px solid var(--accent); color: var(--accent); }\n.box-green { background: rgba(63,185,80,0.15); border: 1px solid var(--green); color: var(--green); }\n.box-yellow { background: rgba(210,153,34,0.15); border: 1px solid var(--yellow); color: var(--yellow); }\n.box-purple { background: rgba(188,140,255,0.15); border: 1px solid var(--purple); color: var(--purple); }\n\n.viz-slot {\n  width: 28px;\n  height: 28px;\n  border: 1px solid var(--border);\n  border-radius: 4px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  transition: all 0.3s ease;\n}\n\n.viz-slot.filled {\n  background: rgba(88,166,255,0.2);\n  border-color: var(--accent);\n  color: var(--accent);\n}\n\n.viz-slot.empty { color: var(--text-muted); }\n\n.viz-select-case {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 14px;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  font-size: 12px;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  transition: all 0.3s ease;\n  min-width: 200px;\n}\n\n.viz-select-case.selected {\n  border-color: var(--green);\n  background: rgba(63,185,80,0.1);\n  color: var(--green);\n}\n\n.viz-select-case.waiting { color: var(--text-muted); }\n\n.viz-flow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n  justify-content: center;\n}\n\n/* ===== EXERCISE CARDS ===== */\n.exercise-card {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  padding: 14px;\n  margin-bottom: 10px;\n}\n\n.exercise-card.expandable { cursor: pointer; }\n.exercise-card.expandable:active { background: var(--bg-tertiary); }\n\n.exercise-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 6px;\n  gap: 8px;\n}\n\n.exercise-title { font-weight: 600; font-size: 14px; }\n\n.exercise-type {\n  font-size: 10px;\n  padding: 3px 8px;\n  border-radius: 10px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n.exercise-type.coding { background: rgba(88,166,255,0.15); color: var(--accent); }\n.exercise-type.quiz { background: rgba(188,140,255,0.15); color: var(--purple); }\n.exercise-type.project { background: rgba(210,153,34,0.15); color: var(--yellow); }\n.exercise-type.assignment { background: rgba(248,81,73,0.15); color: var(--red); }\n\n.exercise-desc {\n  color: var(--text-muted);\n  font-size: 13px;\n  line-height: 1.5;\n  margin-bottom: 10px;\n}\n\n.exercise-meta {\n  display: flex;\n  gap: 12px;\n  font-size: 11px;\n  color: var(--text-muted);\n  flex-wrap: wrap;\n}\n\n.exercise-expand-icon {\n  font-size: 12px;\n  color: var(--text-muted);\n  transition: transform 0.2s;\n  flex-shrink: 0;\n}\n\n.exercise-detail {\n  display: none;\n  margin-top: 12px;\n  padding-top: 12px;\n  border-top: 1px solid var(--border);\n}\n\n.exercise-detail.open { display: block; }\n\n.exercise-detail h4 {\n  font-size: 12px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--text-muted);\n  margin-bottom: 8px;\n  margin-top: 14px;\n}\n\n.exercise-detail h4:first-child { margin-top: 0; }\n\n.exercise-detail p, .exercise-detail li {\n  font-size: 13px;\n  line-height: 1.6;\n  color: var(--text);\n}\n\n.exercise-detail ul { padding-left: 18px; margin-bottom: 8px; }\n.exercise-detail li { margin-bottom: 4px; }\n\n.exercise-detail pre {\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  padding: 12px;\n  overflow-x: auto;\n  margin: 8px 0;\n  -webkit-overflow-scrolling: touch;\n}\n\n.exercise-detail code {\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  font-size: 12px;\n}\n\n.exercise-detail :not(pre) > code {\n  background: var(--bg-tertiary);\n  padding: 1px 5px;\n  border-radius: 3px;\n  color: var(--accent);\n}\n\n.exercise-detail pre code {\n  background: none;\n  padding: 0;\n  color: var(--text);\n}\n\n/* Test cases */\n.test-case {\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  margin-bottom: 8px;\n  overflow: hidden;\n}\n\n.test-case-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 12px;\n  font-size: 12px;\n  font-weight: 600;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  background: var(--bg-tertiary);\n  border-bottom: 1px solid var(--border);\n}\n\n.test-status {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  flex-shrink: 0;\n}\n\n.test-status.pass { background: var(--green); }\n.test-status.fail { background: var(--red); }\n.test-status.pending { background: var(--bg-tertiary); border: 1.5px solid var(--text-muted); }\n\n.test-case-body {\n  padding: 10px 12px;\n  font-size: 12px;\n  font-family: 'SF Mono', 'Fira Code', monospace;\n  color: var(--text-muted);\n  line-height: 1.5;\n}\n\n/* Quiz questions */\n.quiz-question {\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  padding: 14px;\n  margin-bottom: 10px;\n}\n\n.quiz-question p { font-size: 14px; margin-bottom: 10px; }\n\n.quiz-option {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 12px;\n  margin-bottom: 4px;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  cursor: pointer;\n  font-size: 13px;\n  transition: all 0.15s;\n}\n\n.quiz-option:hover { border-color: var(--accent); background: rgba(88,166,255,0.05); }\n.quiz-option.selected { border-color: var(--accent); background: rgba(88,166,255,0.1); color: var(--accent); }\n.quiz-option.correct { border-color: var(--green); background: rgba(63,185,80,0.1); color: var(--green); }\n.quiz-option.incorrect { border-color: var(--red); background: rgba(248,81,73,0.1); color: var(--red); }\n\n/* Action buttons */\n.exercise-actions {\n  display: flex;\n  gap: 8px;\n  margin-top: 14px;\n  flex-wrap: wrap;\n}\n\n.exercise-action-btn {\n  padding: 10px 16px;\n  border-radius: 6px;\n  font-size: 13px;\n  font-weight: 600;\n  font-family: inherit;\n  cursor: pointer;\n  border: none;\n  flex: 1;\n  min-width: 120px;\n  text-align: center;\n}\n\n.btn-primary { background: var(--accent); color: #0d1117; }\n.btn-secondary { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text); }\n.btn-success { background: rgba(63,185,80,0.15); border: 1px solid var(--green); color: var(--green); }\n\n/* Exercise progress bar */\n.exercise-progress {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 12px;\n  padding: 10px 12px;\n  background: var(--bg);\n  border-radius: 6px;\n  font-size: 12px;\n}\n\n.exercise-progress-bar {\n  flex: 1;\n  height: 6px;\n  background: var(--bg-tertiary);\n  border-radius: 3px;\n  overflow: hidden;\n}\n\n.exercise-progress-fill { height: 100%; border-radius: 3px; }\n.exercise-progress-fill.green { background: var(--green); }\n.exercise-progress-fill.yellow { background: var(--yellow); }\n\n/* ===== SEARCH ===== */\n.search-bar {\n  position: relative;\n  margin-bottom: 16px;\n}\n\n.search-bar input {\n  width: 100%;\n  padding: 12px 16px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  color: var(--text);\n  font-size: 14px;\n  font-family: inherit;\n  outline: none;\n}\n\n.search-bar input:focus { border-color: var(--accent); }\n.search-bar input::placeholder { color: var(--text-muted); }\n\n.search-result-item {\n  padding: 12px 14px;\n  cursor: pointer;\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  margin-bottom: 8px;\n  background: var(--bg-secondary);\n  transition: background 0.1s;\n}\n\n.search-result-item:hover { background: var(--bg-tertiary); }\n\n.search-result-meta {\n  font-size: 11px;\n  color: var(--text-muted);\n  margin-bottom: 4px;\n  display: flex;\n  gap: 8px;\n}\n\n.search-result-content {\n  font-size: 13px;\n  color: var(--text);\n  line-height: 1.5;\n  max-height: 60px;\n  overflow: hidden;\n}\n\n.search-no-results {\n  padding: 32px 20px;\n  text-align: center;\n  color: var(--text-muted);\n}\n\n/* Search modal (desktop) */\n.modal {\n  position: fixed;\n  inset: 0;\n  z-index: 200;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n  padding-top: 15vh;\n}\n\n.modal-backdrop {\n  position: absolute;\n  inset: 0;\n  background: rgba(0,0,0,0.6);\n  backdrop-filter: blur(4px);\n}\n\n.modal-content {\n  position: relative;\n  width: 600px;\n  max-width: 90vw;\n  max-height: 500px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  box-shadow: 0 16px 48px rgba(0,0,0,0.4);\n}\n\n.modal-content input {\n  width: 100%;\n  padding: 16px 20px;\n  background: transparent;\n  border: none;\n  border-bottom: 1px solid var(--border);\n  color: var(--text);\n  font-size: 16px;\n  outline: none;\n  font-family: inherit;\n}\n\n.modal-content input::placeholder { color: var(--text-muted); }\n\n.modal-results {\n  overflow-y: auto;\n  max-height: 400px;\n}\n\n/* ===== EMPTY STATES ===== */\n.empty-state {\n  text-align: center;\n  padding: 48px 16px;\n  color: var(--text-muted);\n}\n\n.empty-state p { margin-bottom: 8px; }\n\n.empty-state code {\n  background: var(--bg-tertiary);\n  padding: 2px 6px;\n  border-radius: 4px;\n  font-size: 12px;\n}\n\n/* ===== KEYBOARD SHORTCUTS ===== */\nkbd {\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  border-radius: 4px;\n  padding: 2px 6px;\n  font-size: 11px;\n  font-family: inherit;\n  color: var(--text-muted);\n}\n\n/* ===== SCROLLBAR ===== */\n::-webkit-scrollbar { width: 8px; }\n::-webkit-scrollbar-track { background: transparent; }\n::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }\n::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }\n\n/* ===== SSE STATUS ===== */\n.sse-dot {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  display: inline-block;\n}\n\n.sse-dot.connected { background: var(--green); }\n.sse-dot.disconnected { background: var(--red); }\n\n/* ===== DESKTOP LAYOUT ===== */\n@media (min-width: 769px) {\n  .mobile-nav { display: none; }\n  body { display: flex; height: 100vh; overflow: hidden; }\n\n  #desktop-sidebar {\n    display: flex !important;\n    width: 300px;\n    min-width: 300px;\n    background: var(--bg-secondary);\n    border-right: 1px solid var(--border);\n    flex-direction: column;\n    overflow: hidden;\n  }\n\n  #desktop-sidebar .sidebar-inner {\n    flex: 1;\n    overflow-y: auto;\n    padding: 16px;\n  }\n\n  #desktop-sidebar .sidebar-footer {\n    padding: 12px 16px;\n    border-top: 1px solid var(--border);\n    font-size: 12px;\n    color: var(--text-muted);\n    display: flex;\n    align-items: center;\n    gap: 6px;\n  }\n\n  .page-container {\n    flex: 1;\n    overflow-y: auto;\n    padding: 32px 48px;\n  }\n\n  .page { padding: 0 0 32px; }\n}\n\n@media (max-width: 768px) {\n  #desktop-sidebar { display: none !important; }\n  .page-container { display: contents; }\n}\n\n/* ===== RESOURCES ===== */\n.resources-list {\n  display: flex;\n  flex-direction: column;\n  gap: 0.5rem;\n}\n\n.resource-card {\n  display: flex;\n  flex-direction: column;\n  padding: 0.75rem 1rem;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  text-decoration: none;\n  color: var(--text);\n  transition: border-color 0.15s, background 0.15s;\n}\n\n.resource-card:hover {\n  border-color: var(--accent);\n  background: var(--bg-tertiary);\n}\n\n.resource-title {\n  font-weight: 500;\n}\n\n.resource-url {\n  font-size: 0.8rem;\n  color: var(--text-muted);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* ===== EXERCISE EXPAND UX ===== */\n.exercise-header {\n  cursor: pointer;\n}\n\n.exercise-header:hover {\n  background: var(--bg-tertiary);\n  border-radius: var(--radius);\n}\n\n.exercise-card.open .exercise-expand-icon {\n  transform: rotate(180deg);\n}\n";

// src/dashboard/server.ts
var STATIC_FILES = {
  "/": { content: static_default, contentType: "text/html; charset=utf-8" },
  "/index.html": { content: static_default, contentType: "text/html; charset=utf-8" },
  "/app.js": { content: app_default, contentType: "application/javascript; charset=utf-8" },
  "/styles.css": { content: styles_default, contentType: "text/css; charset=utf-8" }
};
var DashboardServer = class {
  constructor(curriculumSvc2, qaSvc2, vizSvc2, exerciseSvc2, resourceSvc2, port2) {
    this.curriculumSvc = curriculumSvc2;
    this.qaSvc = qaSvc2;
    this.vizSvc = vizSvc2;
    this.exerciseSvc = exerciseSvc2;
    this.resourceSvc = resourceSvc2;
    this.port = port2;
  }
  sseClients = /* @__PURE__ */ new Set();
  httpServer = null;
  start() {
    this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
    this.httpServer.listen(this.port, "127.0.0.1", () => {
      console.error(`Dashboard running at http://127.0.0.1:${this.port}`);
    });
  }
  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
  notify() {
    const data = JSON.stringify({ type: "update", ts: (/* @__PURE__ */ new Date()).toISOString() });
    const message = `data: ${data}

`;
    for (const client of this.sseClients) {
      client.write(message);
    }
  }
  // ── Request routing ────────────────────────────────────────────────────
  handleRequest(req, res) {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    if (method === "POST") {
      const origin = req.headers.origin ?? "";
      if (origin && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.0.0.1")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: invalid origin" }));
        return;
      }
    }
    if (url === "/api/events" && method === "GET") {
      this.handleSSE(req, res);
      return;
    }
    if (url.startsWith("/api/")) {
      this.routeAPI(method, url, req, res);
      return;
    }
    this.serveStatic(url, res);
  }
  // ── SSE ────────────────────────────────────────────────────────────────
  handleSSE(_req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    const connected = JSON.stringify({ type: "connected", ts: (/* @__PURE__ */ new Date()).toISOString() });
    res.write(`data: ${connected}

`);
    this.sseClients.add(res);
    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }
  // ── API router ─────────────────────────────────────────────────────────
  routeAPI(method, url, req, res) {
    const path = url.split("?")[0];
    if (method === "GET" && path === "/api/subjects") {
      handleSubjects(this.curriculumSvc)(req, res);
      return;
    }
    if (method === "GET" && /^\/api\/subjects\/\d+\/phases$/.test(path)) {
      handlePhases(this.curriculumSvc)(req, res);
      return;
    }
    if (method === "GET" && /^\/api\/topics\/\d+\/viz$/.test(path)) {
      handleTopicViz(this.vizSvc)(req, res);
      return;
    }
    if (method === "GET" && /^\/api\/topics\/\d+\/exercises$/.test(path)) {
      handleTopicExercises(this.exerciseSvc)(req, res);
      return;
    }
    if (method === "GET" && /^\/api\/topics\/\d+\/resources$/.test(path)) {
      handleTopicResources(this.resourceSvc)(req, res);
      return;
    }
    if (method === "GET" && /^\/api\/topics\/\d+$/.test(path)) {
      handleTopic(this.curriculumSvc, this.qaSvc, this.resourceSvc)(req, res);
      return;
    }
    if (method === "POST" && /^\/api\/exercises\/\d+\/run$/.test(path)) {
      handleRunTests(this.exerciseSvc)(req, res);
      return;
    }
    if (method === "POST" && /^\/api\/exercises\/\d+\/submit$/.test(path)) {
      handleSubmitQuiz(this.exerciseSvc)(req, res);
      return;
    }
    if (method === "GET" && path === "/api/search") {
      handleSearch(this.qaSvc)(req, res);
      return;
    }
    writeJSON(res, { error: "Not found" }, 404);
  }
  // ── Static file serving ────────────────────────────────────────────────
  serveStatic(url, res) {
    const file = STATIC_FILES[url];
    if (file) {
      res.writeHead(200, { "Content-Type": file.contentType });
      res.end(file.content);
      return;
    }
    const index = STATIC_FILES["/"];
    if (index) {
      res.writeHead(200, { "Content-Type": index.contentType });
      res.end(index.content);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
};

// src/index.ts
var fileStore = new FileStore();
var db = new Database(fileStore.dbPath);
var sessions = /* @__PURE__ */ new Map();
var curriculumSvc = new CurriculumService(db);
var qaSvc = new QAService(db);
var vizSvc = new VizService(db);
var exerciseSvc = new ExerciseService(db, fileStore);
var resourceSvc = new ResourceService(db);
var port = Number(db.getSetting("dashboard_port") ?? "19282");
var dashboard = new DashboardServer(curriculumSvc, qaSvc, vizSvc, exerciseSvc, resourceSvc, port);
var notify = () => dashboard.notify();
var server = new McpServer({ name: "study-dash", version: "0.1.0" });
registerCurriculumTools(server, curriculumSvc, sessions, notify);
registerQATools(server, qaSvc, sessions, notify);
registerVizTools(server, vizSvc, sessions, notify);
registerExerciseTools(server, exerciseSvc, sessions, notify);
registerResourceTools(server, resourceSvc, sessions, notify);
dashboard.start();
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`study-dash MCP server running, dashboard at http://127.0.0.1:${port}`);
}
run().catch((err6) => {
  console.error("Fatal:", err6);
  process.exit(1);
});
