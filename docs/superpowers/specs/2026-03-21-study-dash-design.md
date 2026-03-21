# StudyDash — Design Specification

**Date**: 2026-03-21
**Status**: Reviewed
**Author**: Claude (brainstormed with Sorin)

## 1. Overview

StudyDash is a Claude Code plugin for structured learning on any subject. It provides curriculum management, Q&A logging, AI-generated visualizations, exercise generation with real test execution, and a live web dashboard — all through a single installable plugin.

### Problem

go-learn proved the concept (MCP server + dashboard + Q&A logging for learning Go), but it's hardcoded to one subject and one user. The visualization and exercise systems are manually crafted. There's no way to import curricula from external sources.

### Solution

A generic, reusable Claude Code plugin that:
- Works with **any subject** (programming languages, school courses, anything)
- Imports curricula from **PDFs** (school platforms like itslearning) and **manual definition** (roadmap.sh-style)
- Supplements topics with **context7** documentation on demand
- **Auto-generates** step-through visualizations using CSS primitives
- **Generates exercises** with real test execution (coding) and dashboard-based quizzes (non-coding)
- Serves a **responsive web dashboard** with live SSE updates

### Users

- **Sorin**: Learning programming (Go, Rust, etc.) via roadmap.sh curricula
- **Sorin's girlfriend**: Learning coding + school subjects via itslearning PDF imports
- **General users**: Anyone using Claude Code who wants structured learning tracking

## 2. Architecture

### Approach: Layered MCP Server (Approach B)

Single Node.js process with clean internal layers. Same operational simplicity as a monolith, but with testable, extensible boundaries.

```
Claude Code ──stdio──> MCP Server Process
Browser     ──HTTP───> MCP Server Process

MCP Server Process:
┌─────────────────────────────────┐
│ Transport Layer                 │
│  ├── MCP Tools (stdio)          │
│  └── HTTP API + SSE (dashboard) │
├─────────────────────────────────┤
│ Service Layer                   │
│  ├── CurriculumService          │
│  ├── QAService                  │
│  ├── VizService                 │
│  └── ExerciseService            │
├─────────────────────────────────┤
│ Storage Layer                   │
│  ├── SQLite (better-sqlite3)    │
│  └── File System (exercises)    │
└─────────────────────────────────┘
```

### Why This Architecture

- **Single process**: Simple to run, bundle, and distribute via npm
- **Layer boundaries**: Each service is independently unit-testable via vitest
- **Shared memory**: SSE notifications are trivial (no IPC needed)
- **Extensible**: New features = new service file, not untangling a monolith
- **Proven pattern**: Matches deep-think plugin structure (engine/, tools/, persistence/)
- **Extractable**: Can split into separate processes later if needed — boundaries are already defined

### Alternatives Considered

1. **Monolith MCP (Approach A)** — Simpler but couples everything. go-learn's `app.js` already shows the pain of this at scale. Not chosen because StudyDash has 5 subsystems.
2. **Multi-Server Split (Approach C)** — Maximum isolation but overkill. 3 processes to manage, SQLite WAL concurrency concerns, IPC for SSE. Not chosen because operational complexity outweighs benefits for a plugin.

## 3. Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Database | better-sqlite3 |
| Build | esbuild (single bundle.mjs) |
| Tests | vitest |
| Dashboard | Vanilla HTML/JS/CSS (embedded) |
| Distribution | npm package + Claude Code plugin |

### Why TypeScript

Every MCP server in the Claude Code plugin ecosystem uses Node.js. Go and Python are not used. The deep-think plugin provides a working template for the build pipeline (esbuild bundle, vitest tests, npm publish).

## 4. Data Model

### SQLite Schema

Location: `~/.claude/learn/data.db` (global, user-level)

```sql
CREATE TABLE subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  language    TEXT DEFAULT '',          -- 'go', 'python', 'rust', '' for non-coding
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'roadmap', 'pdf')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE phases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id    INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('question', 'answer', 'note')),
  content     TEXT NOT NULL,
  session_id  TEXT NOT NULL DEFAULT '',
  question_id INTEGER REFERENCES entries(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE visualizations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  steps_json  TEXT NOT NULL,            -- JSON array of {html, description}
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('coding', 'quiz', 'project', 'assignment')),
  description   TEXT NOT NULL,
  difficulty    TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  est_minutes   INTEGER DEFAULT 15,
  source        TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'pdf_import')),
  starter_code  TEXT DEFAULT '',
  test_content  TEXT DEFAULT '',        -- test file content for coding exercises
  quiz_json     TEXT DEFAULT '',        -- JSON for quiz questions/answers
  file_path     TEXT DEFAULT '',        -- path to generated exercise directory
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'passed', 'failed')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE exercise_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  test_name   TEXT NOT NULL,
  passed      INTEGER NOT NULL DEFAULT 0,
  output      TEXT DEFAULT '',
  ran_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_phases_subject ON phases(subject_id);
CREATE INDEX idx_topics_phase ON topics(phase_id);
CREATE INDEX idx_entries_topic ON entries(topic_id);
CREATE INDEX idx_entries_kind ON entries(kind);
CREATE INDEX idx_viz_topic ON visualizations(topic_id);
CREATE INDEX idx_exercises_topic ON exercises(topic_id);
CREATE INDEX idx_results_exercise ON exercise_results(exercise_id);

-- Full-text search (standalone FTS5 table, not external-content)
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(content);

CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.id;
END;

CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
  DELETE FROM entries_fts WHERE rowid = old.id;
  INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content);
END;
```

### Service-to-Table Mapping

| Service | Tables owned |
|---------|-------------|
| CurriculumService | subjects, phases, topics, settings |
| QAService | entries, entries_fts |
| VizService | visualizations |
| ExerciseService | exercises, exercise_results |

## 5. MCP Tools

### Curriculum Management (CurriculumService)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `learn_create_subject` | name, language?, source? | Create a new subject |
| `learn_import_curriculum` | subject_id, phases_json | Import phases/topics (from Claude's PDF parsing). `phases_json` is a JSON string: `[{name, description, topics: [{name, description}]}]` |
| `learn_switch_subject` | subject (name or ID) | Set active subject |
| `learn_set_topic` | topic (name or ID) | Set active topic within current subject |
| `learn_mark_done` | topic? | Mark topic as done (default: active topic) |
| `learn_get_progress` | | Get completion stats for active subject |
| `learn_get_curriculum` | | Get full topic tree for active subject |

### Q&A Logging (QAService)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `learn_log_question` | content, session_id? | Log a question (markdown) |
| `learn_log_answer` | content, question_id?, kind?, session_id? | Log answer/note, pair to question |
| `learn_search` | query | Full-text search across all entries |

### Visualizations (VizService)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `learn_create_viz` | title, steps[] | Store a step-through visualization |
| `learn_get_viz` | | List visualizations for current topic |

### Exercises (ExerciseService)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `learn_create_exercise` | title, type, description, difficulty?, starter_code?, test_content?, quiz_json? | Create exercise + write files to disk |
| `learn_run_tests` | exercise_id | Execute tests, return pass/fail results |
| `learn_get_exercises` | | List exercises for current topic with latest results |

**Total: 15 tools** (go-learn had 7)

## 6. Plugin Components

### Skills

| Skill | Directory | Triggers when |
|-------|-----------|--------------|
| `learn` | `skills/learn/` | User asks questions about a subject they're studying. Auto-logs Q&A, suggests viz/exercises. |
| `import` | `skills/import/` | User mentions importing PDFs, syllabi, or creating a new subject. |

### Commands

| Command | File | Description |
|---------|------|-------------|
| `/learn` | `commands/learn.md` | Start/switch learning session, show active subject + topic |
| `/learn import` | `commands/import.md` | Import a PDF/syllabus into a subject |
| `/learn dashboard` | `commands/dashboard.md` | Print the dashboard URL |

### Hooks

| Event | Matcher | Action |
|-------|---------|--------|
| `PostToolUse` | `learn_mark_done` | Prompt Claude to generate exercises for completed topic |
| `PostToolUse` | `learn_log_answer` | Prompt Claude to consider generating a visualization (respects auto_viz setting) |
| `PreCompact` | | Save active subject/topic state to survive context compaction |

### Rules

`rules/tutor-mode.md` — Generic version of go-learn's `learning-mode.md`:
- Auto-log all Q&A during learning sessions
- Manage topic progression
- Adapt teaching style to the subject
- Subject-agnostic (no Go-specific instructions)

## 7. Dashboard

### Tech

Vanilla HTML/JS/CSS embedded via esbuild. No framework. Matches go-learn's approach.

### Views

| View | Content |
|------|---------|
| Home | Subject switcher, progress bar, stats grid, recently active topics |
| Topics | Phase tree with collapsible groups, status dots, Q&A counts |
| Topic Detail | Tabs: Q&A, Visualize, Exercises, Resources |
| Search | Full-text search across all entries, viz, exercises |

### API Endpoints

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/subjects` | GET | All subjects with progress stats |
| `/api/subjects/:id/phases` | GET | Phase tree for a subject |
| `/api/topics/:id` | GET | Topic with entries |
| `/api/topics/:id/viz` | GET | Visualizations for topic |
| `/api/topics/:id/exercises` | GET | Exercises with latest test results |
| `/api/exercises/:id/run` | POST | Trigger test run, return results |
| `/api/exercises/:id/submit` | POST | Submit quiz answers, return score |
| `/api/search?q=` | GET | Full-text search results |
| `/api/events` | GET | SSE stream for live updates |

### Responsive Design

- **Mobile**: Bottom navigation (Home, Topics, Study, Search), single-column layout
- **Desktop**: Sidebar with topic tree, main content area
- **SSE**: Any MCP tool that modifies data fires a notify event; dashboard auto-refreshes

### Dashboard Security

- **Localhost-only**: Dashboard HTTP server binds to `127.0.0.1` only. Not accessible from the network.
- **CSRF protection**: `POST` endpoints (`/api/exercises/:id/run`, `/api/exercises/:id/submit`) check `Origin` header matches `localhost`.
- No authentication needed — the threat model is the same as go-learn: single-user, local machine.

### Dashboard Port

Default: `19282` (avoids conflict with go-learn's `19281`). Configurable via `settings` table.

## 8. Visualization System

### Storage

Visualizations stored in the `visualizations` table as JSON:

```json
{
  "title": "Unbuffered Channel",
  "steps": [
    {
      "html": "<div class='viz-box box-blue'>main()</div>...",
      "description": "Channel created with `ch := make(chan string)`."
    }
  ]
}
```

### CSS Primitives

Dashboard ships with reusable CSS classes for visualization elements:

| Class | Use |
|-------|-----|
| `viz-box` + `box-{color}` | Labeled box (process, component, node) |
| `viz-arrow` | Directional flow arrow |
| `viz-slot` | Buffer/queue slot |
| `viz-select-case` | Decision branch |
| `viz-flow` | Layout container (vertical/horizontal) |

Claude generates HTML using these primitives for any subject.

### Generation Flow

1. Claude explains a concept via `learn_log_answer`
2. `PostToolUse` hook fires
3. If `auto_viz` setting is `true` (default): Claude generates steps and calls `learn_create_viz`
4. If `auto_viz` is `false`: Claude asks "Want me to create a visualization for this?"
5. Dashboard receives SSE notify, Visualize tab shows new diagram

### Security

Visualization HTML is rendered inside a `<div>` with `innerHTML` sanitized via a simple allowlist filter: only permitted tags (`div`, `span`, `small`, `br`, `code`, `strong`) and only `class` and `style` attributes. All `<script>` tags and event handlers (`onclick`, etc.) are stripped before rendering. This is enforced in the dashboard JS before inserting into the DOM.

### No Restart Required

Visualizations are data (stored in SQLite), not code. New visualizations appear in the dashboard immediately via SSE — no plugin restart needed.

## 9. Exercise System

### Types

| Type | Generation | Validation | Storage |
|------|-----------|------------|---------|
| **Coding** | Claude generates starter code + test file | `go test -json` / `pytest` / `cargo test` (child process) | Files on disk + metadata in DB |
| **Quiz** | Claude generates questions + correct answers | Server compares answers | JSON in DB |
| **Project** | Claude generates description + acceptance criteria + tests | Same as coding (file-based tests) | Files on disk + metadata in DB |
| **Assignment** | Imported from PDF | Claude generates tests based on requirements | Files on disk + metadata in DB |

### File Layout (coding exercises)

```
~/.claude/learn/exercises/{subject-slug}/{exercise-slug}/
├── main.go          (starter code — language matches subject)
├── main_test.go     (AI-generated test cases)
└── README.md        (exercise description)
```

### Test Execution Flow

1. Dashboard: user clicks "Run Tests"
2. `POST /api/exercises/:id/run`
3. `ExerciseService` looks up subject language, maps to test command
4. Spawns child process (`go test -json`, `pytest --tb=short -q`, `cargo test 2>&1`)
5. Parses structured output into per-test pass/fail
6. Stores results in `exercise_results`
7. SSE notifies dashboard
8. Dashboard updates test status dots and progress bar

### Language-to-Command Mapping

| Language | Test command | Output parsing |
|----------|-------------|---------------|
| go | `go test -json ./...` | JSON stream, one event per test |
| python | `pytest --tb=short -q` | Exit code + stdout |
| rust | `cargo test 2>&1` | Stdout parsing |
| javascript | `npm test` | Exit code + stdout |
| (none) | N/A | Quiz-only, no file-based tests |

### Security

The language-to-command mapping is a strict allowlist. No user-controlled strings in the spawned command. Exercise paths are validated to be within `~/.claude/learn/exercises/`.

## 10. PDF Import

### Flow

1. User provides a PDF path in Claude Code session
2. Claude reads the PDF natively (Read tool)
3. Claude classifies the content:
   - **High confidence**: Auto-imports (syllabus becomes curriculum, assignment becomes exercise)
   - **Low confidence**: Asks user to confirm ("This looks like lecture slides for Week 3. Import as notes?")
4. Claude calls appropriate MCP tools:
   - Syllabus: `learn_create_subject` + `learn_import_curriculum`
   - Lecture slides: `learn_log_answer` (as notes attached to topics)
   - Assignments: `learn_create_exercise` (type: assignment)

### No Server-Side PDF Parsing

Claude reads PDFs natively. The MCP server never touches raw PDF files — it only receives structured data that Claude has already extracted. This keeps the server simple and dependency-free.

## 11. Project Structure

```
study-dash/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── hooks/
│   └── hooks.json
├── rules/
│   └── tutor-mode.md
├── skills/
│   ├── learn/
│   │   └── SKILL.md
│   └── import/
│       └── SKILL.md
├── commands/
│   ├── learn.md
│   ├── import.md
│   └── dashboard.md
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── tools/
│   │   │   ├── curriculum.ts
│   │   │   ├── qa.ts
│   │   │   ├── exercises.ts
│   │   │   └── viz.ts
│   │   ├── services/
│   │   │   ├── curriculum.ts
│   │   │   ├── qa.ts
│   │   │   ├── exercises.ts
│   │   │   └── viz.ts
│   │   ├── dashboard/
│   │   │   ├── server.ts
│   │   │   ├── api.ts
│   │   │   └── static/
│   │   │       ├── index.html
│   │   │       ├── app.js
│   │   │       └── styles.css
│   │   └── storage/
│   │       ├── db.ts
│   │       ├── schema.ts
│   │       └── files.ts
│   ├── __tests__/
│   │   ├── services/
│   │   │   ├── curriculum.test.ts
│   │   │   ├── qa.test.ts
│   │   │   ├── exercises.test.ts
│   │   │   └── viz.test.ts
│   │   ├── storage/
│   │   │   └── db.test.ts
│   │   └── integration.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── package.json
├── README.md
└── LICENSE
```

## 12. Distribution

### npm Package

Published as `study-dash` (or `@bis-code/study-dash`). Users install via:

```json
{
  "mcpServers": {
    "study-dash": {
      "command": "npx",
      "args": ["-y", "study-dash"]
    }
  }
}
```

Or as a Claude Code plugin — installable from the plugin marketplace.

### Bundle

esbuild bundles the server + embedded dashboard static files into a single `dist/bundle.mjs`. Same pattern as deep-think.

## 13. Settings

### Global Settings

Stored in the `settings` table (key-value):

| Key | Default | Description |
|-----|---------|-------------|
| `auto_viz` | `true` | Auto-generate visualizations after explanations |
| `dashboard_port` | `19282` | Dashboard HTTP port (19282 to avoid conflict with go-learn's 19281) |

### Session State

Active subject/topic is **per-session**, not global. Each MCP tool call includes an optional `session_id` parameter (generated by Claude at session start). The server tracks active subject/topic per session in memory (a `Map<string, {subjectId, topicId}>`). This avoids conflicts when multiple Claude Code sessions run concurrently.

If no `session_id` is provided, a default session is used (backward compatibility for single-session usage).

## 14. Security Considerations

- **Exercise execution**: Strict language-to-command allowlist. No shell injection. Paths validated to `~/.claude/learn/exercises/`.
- **Visualization HTML**: Rendered in sandboxed container. Only whitelisted CSS classes styled. No script execution.
- **No sensitive data**: Learning data only — no API keys, passwords, or PII stored.
- **PDF handling**: Claude reads PDFs, not the server. No server-side file parsing attack surface.

## 15. Testing Strategy

| Layer | Approach |
|-------|----------|
| Storage | Unit tests with in-memory SQLite |
| Services | Unit tests per service, mocking storage |
| Tools | Integration tests (tool handler → service → in-memory DB) |
| Dashboard API | Integration tests (HTTP request → response) |
| Exercise runner | Integration tests with real test files |
| E2E | Manual testing via Claude Code session |

## 16. Schema Migrations

The database lives at `~/.claude/learn/data.db` and persists across plugin upgrades. Schema changes must be backward-compatible.

### Strategy

- A `schema_version` integer stored in the `settings` table
- On startup, the server checks `schema_version` against the expected version
- Migrations are an ordered array of SQL strings (same pattern as go-learn's `migrations` array)
- Each migration runs in a transaction; `schema_version` is bumped after success
- Migrations are additive only (add columns with defaults, add tables, add indexes). Never drop or rename.

### Example

```typescript
const migrations = [
  // v1 -> v2: add updated_at to topics
  `ALTER TABLE topics ADD COLUMN updated_at TEXT DEFAULT ''`,
  // v2 -> v3: add hint_count to exercises
  `ALTER TABLE exercises ADD COLUMN hint_count INTEGER DEFAULT 3`,
];
```

## 17. SSE Event Protocol

### Event Format

```
data: {"type": "<event_type>", "payload": {...}, "ts": "2026-03-21T10:00:00Z"}
```

### Event Types

| Type | Payload | Triggers when |
|------|---------|--------------|
| `connected` | `{}` | Initial SSE connection |
| `update` | `{ table: string, id: number }` | Any data modification (insert/update) |
| `test_result` | `{ exerciseId: number, results: TestResult[] }` | Test run completes |

The dashboard uses `type` to decide what to refresh. For `update`, it refetches the relevant API endpoint. For `test_result`, it updates the exercise card directly.

## 18. Quiz Schema

### Quiz JSON Format

Stored in `exercises.quiz_json`:

```json
{
  "questions": [
    {
      "id": 1,
      "text": "What does `chan<- string` mean?",
      "type": "multiple_choice",
      "options": ["Receive-only", "Send-only", "Bidirectional", "Closed"],
      "correct": 1,
      "explanation": "The arrow points into chan — send-only."
    }
  ]
}
```

### Supported Question Types

| Type | Fields |
|------|--------|
| `multiple_choice` | options[], correct (index) |
| `true_false` | correct (boolean) |
| `fill_in` | correct (string, case-insensitive match) |

### Scoring

Score = correct answers / total questions. Exercise status becomes `passed` if score >= 0.7, `failed` otherwise. Stored in `exercise_results` with one row per question.

## 19. Exercise Status Rules

| Condition | Exercise status |
|-----------|----------------|
| Created, no tests run | `pending` |
| User opened/edited files | `in_progress` |
| All tests pass | `passed` |
| Any test fails | `failed` |
| Quiz score >= 70% | `passed` |
| Quiz score < 70% | `failed` |

Status transitions: `pending` -> `in_progress` -> `passed`/`failed`. Can retry (failed -> in_progress -> passed).

## 20. Open Questions

1. **Plugin name**: "study-dash" is the working name. Alternatives: "claude-learn", "learn-track". TBD.
2. **Roadmap.sh integration**: Manual curriculum definition for now. Automated scraping could be a future enhancement.
3. **Spaced repetition**: Not in v1. Natural extension — schedule review sessions based on time since last interaction with a topic.
4. **Export/sharing**: Not in v1. Could export curriculum + Q&A as markdown or share between users.
