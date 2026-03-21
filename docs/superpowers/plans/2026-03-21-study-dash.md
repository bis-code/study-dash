# StudyDash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin for structured learning on any subject, with MCP tools, web dashboard, AI-generated visualizations, and exercise validation.

**Architecture:** Layered MCP Server (single Node.js process). Transport layer (MCP tools + HTTP API) calls service layer (CurriculumService, QAService, VizService, ExerciseService) which calls storage layer (SQLite via better-sqlite3 + file system). Dashboard is vanilla HTML/JS/CSS embedded via esbuild.

**Tech Stack:** TypeScript, Node.js 20+, @modelcontextprotocol/sdk, better-sqlite3, esbuild, vitest, vanilla HTML/JS/CSS

**Spec:** `docs/superpowers/specs/2026-03-21-study-dash-design.md`

**Reference implementations:**
- `/tmp/mcp-deep-think/` — plugin structure, build pipeline, MCP SDK usage
- `/tmp/go-learn/` — dashboard patterns, Q&A cards, SSE, visualization CSS

**Security note:** Exercise test execution MUST use `execFile` (not `exec`) with strict argument arrays to prevent shell injection. Never pass user-controlled strings through a shell.

**Build note:** `better-sqlite3` is a native Node.js addon — it CANNOT be bundled by esbuild. The bundle command uses `--external:better-sqlite3` so it remains a runtime dependency. Users installing via `npx` will get it from npm; plugin installs need `node_modules` present.

**Dev note:** `${CLAUDE_PLUGIN_ROOT}` in `.mcp.json` is set by Claude Code at plugin load time. For manual testing during development, run the server directly: `node server/dist/bundle.mjs`

---

## File Map

### Plugin Shell
| File | Responsibility |
|------|---------------|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.mcp.json` | MCP server config |
| `hooks/hooks.json` | PostToolUse + PreCompact hooks |
| `rules/tutor-mode.md` | Claude tutor behavior rules |
| `skills/learn/SKILL.md` | Auto-activate learning skill |
| `skills/import/SKILL.md` | PDF import skill |
| `commands/learn.md` | /learn command |
| `commands/import.md` | /learn import command |
| `commands/dashboard.md` | /learn dashboard command |

### Server
| File | Responsibility |
|------|---------------|
| `server/src/index.ts` | Entry point — wire up MCP server, dashboard, services |
| `server/src/types.ts` | Shared TypeScript interfaces |
| `server/src/storage/schema.ts` | SQL schema string + migration array |
| `server/src/storage/db.ts` | Database class — open, migrate, query helpers |
| `server/src/storage/files.ts` | Exercise file I/O (write starter code, read test output) |
| `server/src/services/curriculum.ts` | CurriculumService — subjects, phases, topics, progress |
| `server/src/services/qa.ts` | QAService — entries, search |
| `server/src/services/viz.ts` | VizService — create/list visualizations |
| `server/src/services/exercises.ts` | ExerciseService — create exercises, run tests, quiz scoring |
| `server/src/tools/curriculum.ts` | MCP tool handlers for curriculum (7 tools) |
| `server/src/tools/qa.ts` | MCP tool handlers for Q&A (3 tools) |
| `server/src/tools/viz.ts` | MCP tool handlers for viz (2 tools) |
| `server/src/tools/exercises.ts` | MCP tool handlers for exercises (3 tools) |
| `server/src/dashboard/server.ts` | HTTP server — static files, API routing, SSE |
| `server/src/dashboard/api.ts` | REST API handlers |
| `server/src/dashboard/static/index.html` | Dashboard HTML |
| `server/src/dashboard/static/app.js` | Dashboard JS |
| `server/src/dashboard/static/styles.css` | Dashboard CSS |

### Tests
| File | Responsibility |
|------|---------------|
| `server/__tests__/storage/db.test.ts` | Database + schema + migrations |
| `server/__tests__/services/curriculum.test.ts` | CurriculumService unit tests |
| `server/__tests__/services/qa.test.ts` | QAService unit tests |
| `server/__tests__/services/viz.test.ts` | VizService unit tests |
| `server/__tests__/services/exercises.test.ts` | ExerciseService unit tests |
| `server/__tests__/integration.test.ts` | Tool handler to service to DB integration |

### Build + Config
| File | Responsibility |
|------|---------------|
| `server/package.json` | Server dependencies + scripts |
| `server/tsconfig.json` | TypeScript config |
| `server/vitest.config.ts` | Vitest config |
| `package.json` | Root package (plugin metadata) |

---

## Phase 1: Foundation (Scaffold + Storage + Types)

### Task 1: Scaffold project structure

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `package.json` (root)
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "study-dash",
  "version": "0.1.0",
  "description": "Claude Code plugin for structured learning on any subject",
  "license": "MIT",
  "author": "Ioan-Sorin Baicoianu <baicoianuioansorin@gmail.com>",
  "repository": "https://github.com/bis-code/study-dash"
}
```

- [ ] **Step 2: Create server/package.json**

```json
{
  "name": "study-dash-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "study-dash": "dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsc && chmod +x dist/index.js",
    "bundle": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/bundle.mjs --external:better-sqlite3 --loader:.html=text --loader:.css=text --loader:.js=text",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22",
    "esbuild": "^0.27.4",
    "typescript": "^5.3.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["__tests__", "dist"]
}
```

- [ ] **Step 4: Create server/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
  },
});
```

- [ ] **Step 5: Create .claude-plugin/plugin.json**

```json
{
  "name": "study-dash",
  "version": "0.1.0",
  "description": "Structured learning on any subject with dashboard, Q&A logging, visualizations, exercises",
  "author": {
    "name": "Ioan-Sorin Baicoianu",
    "email": "baicoianuioansorin@gmail.com"
  },
  "repository": "https://github.com/bis-code/study-dash",
  "license": "MIT",
  "keywords": ["learning", "education", "dashboard", "exercises", "visualizations"],
  "mcpServers": "./.mcp.json"
}
```

- [ ] **Step 6: Create .mcp.json**

```json
{
  "mcpServers": {
    "study-dash": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/bundle.mjs"]
    }
  }
}
```

- [ ] **Step 7: Install dependencies**

Run: `cd server && npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold study-dash project structure"
```

---

### Task 2: Types

**Files:**
- Create: `server/src/types.ts`

- [ ] **Step 1: Write shared types**

All interfaces — pure TypeScript, no runtime code:

- `Subject` — id, name, slug, language, source, created_at
- `Phase` — id, subject_id, name, description, sort_order
- `Topic` — id, phase_id, name, description, sort_order, status, updated_at
- `Entry` — id, topic_id, kind, content, session_id, question_id (nullable), created_at
- `Visualization` — id, topic_id, title, steps_json, created_at
- `VizStep` — html (string), description (string)
- `Exercise` — id, topic_id, title, type, description, difficulty, est_minutes, source, starter_code, test_content, quiz_json, file_path, status, created_at
- `ExerciseResult` — id, exercise_id, test_name, passed (boolean), output, ran_at
- `QuizQuestion` — id, text, type ('multiple_choice'|'true_false'|'fill_in'), options? (string[]), correct (number|boolean|string), explanation
- `QuizPayload` — questions: QuizQuestion[]
- `ProgressStats` — total_topics, done, in_progress, todo, total_entries, total_exercises, total_viz
- `PhaseWithTopics` — extends Phase with topics: Topic[]
- `TopicWithEntries` — extends Topic with entries: Entry[]
- `SessionState` — subjectId: number|null, topicId: number|null
- `SSEEvent` — type: 'connected'|'update'|'test_result', payload: Record<string, unknown>, ts: string

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

### Task 3: Storage layer — schema + database

**Files:**
- Create: `server/src/storage/schema.ts`
- Create: `server/src/storage/db.ts`
- Create: `server/__tests__/storage/db.test.ts`

- [ ] **Step 1: Write db.test.ts**

Tests:
- Creates all tables (subjects, phases, topics, entries, visualizations, exercises, exercise_results, settings, entries_fts)
- Sets schema_version on first init
- getSetting/setSetting round-trips

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/storage/db.test.ts`
Expected: FAIL — cannot resolve `../src/storage/db.js`

- [ ] **Step 3: Write schema.ts**

Full SQL schema from spec Section 4. Include `PRAGMA foreign_keys=ON`, all `ON DELETE CASCADE`, FTS5 table + triggers. `migrations` array starts empty.

- [ ] **Step 4: Write db.ts**

Database class: constructor takes dbPath (`:memory:` for tests), runs schema, handles migrations, provides `getSetting`/`setSetting`/`listTables`/`raw`/`close` methods. Seeds default settings on first init (schema_version=1, auto_viz=true, dashboard_port=19282).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/storage/db.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/storage/ server/__tests__/storage/
git commit -m "feat(storage): add SQLite schema, migrations, and Database class"
```

---

### Task 4: File storage helper

**Files:**
- Create: `server/src/storage/files.ts`

- [ ] **Step 1: Write files.ts**

FileStore class with:
- `constructor(baseDir?)` — defaults to `~/.claude/learn`, creates `exercises/` dir
- `exercisesDir`, `dataDir`, `dbPath` getters
- `writeExerciseFiles(subjectSlug, exerciseSlug, files)` — writes files to exercise dir, returns path
- `exerciseExists(subjectSlug, exerciseSlug)` — checks if dir exists

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/storage/files.ts
git commit -m "feat(storage): add FileStore for exercise file I/O"
```

---

## Phase 2: Curriculum Subsystem

### Task 5: CurriculumService

**Files:**
- Create: `server/src/services/curriculum.ts`
- Create: `server/__tests__/services/curriculum.test.ts`

- [ ] **Step 1: Write curriculum.test.ts**

Tests:
- Creates a subject (name, slug, language)
- Auto-generates slug from name
- Imports curriculum with phases and topics
- Gets progress stats (total, done, in_progress, todo)
- Sets topic status
- Finds topic by name within subject
- Lists all subjects

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/services/curriculum.test.ts`
Expected: FAIL

- [ ] **Step 3: Write curriculum.ts**

CurriculumService with methods: `createSubject`, `listSubjects`, `getSubject`, `findSubjectByName`, `importCurriculum` (transactional), `getCurriculum` (returns PhaseWithTopics[]), `getProgress` (returns ProgressStats), `setTopicStatus`, `getTopic`, `findTopic`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/services/curriculum.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/curriculum.ts server/__tests__/services/curriculum.test.ts
git commit -m "feat(curriculum): add CurriculumService with CRUD, import, progress"
```

---

### Task 6: Curriculum MCP tools

**Files:**
- Create: `server/src/tools/curriculum.ts`

- [ ] **Step 1: Write curriculum tool handlers**

`registerCurriculumTools(server, svc, sessions, notify)` function that registers 7 tools:
- `learn_create_subject` — calls `svc.createSubject`
- `learn_import_curriculum` — parses phases_json, calls `svc.importCurriculum`
- `learn_switch_subject` — resolves by name or ID, updates session state
- `learn_set_topic` — resolves by name or ID, sets status to in_progress, updates session
- `learn_mark_done` — marks active or specified topic as done
- `learn_get_progress` — returns JSON stats for active subject
- `learn_get_curriculum` — returns JSON topic tree for active subject

Session state managed via `Map<string, SessionState>` passed in. Default session key `_default` for backward compatibility.

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/tools/curriculum.ts
git commit -m "feat(tools): add 7 curriculum MCP tool handlers"
```

---

## Phase 3: Q&A Subsystem

### Task 7: QAService + tools

**Files:**
- Create: `server/src/services/qa.ts`
- Create: `server/src/tools/qa.ts`
- Create: `server/__tests__/services/qa.test.ts`

- [ ] **Step 1: Write qa.test.ts**

Tests:
- Logs a question
- Logs an answer paired to a question
- Lists entries for a topic
- Full-text searches entries

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/services/qa.test.ts`
Expected: FAIL

- [ ] **Step 3: Write qa.ts service**

QAService with methods: `logEntry(topicId, kind, content, sessionId, questionId?)`, `listEntries(topicId)`, `search(query)`.

- [ ] **Step 4: Write qa.ts tools**

`registerQATools(server, svc, sessions, notify)` — registers 3 tools:
- `learn_log_question` — logs question to active topic
- `learn_log_answer` — logs answer/note, optionally paired to question_id
- `learn_search` — full-text search

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/services/qa.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/services/qa.ts server/src/tools/qa.ts server/__tests__/services/qa.test.ts
git commit -m "feat(qa): add QAService with logging, search, and MCP tools"
```

---

## Phase 4: Viz + Exercise Subsystems

### Task 8: VizService + tools

**Files:**
- Create: `server/src/services/viz.ts`
- Create: `server/src/tools/viz.ts`
- Create: `server/__tests__/services/viz.test.ts`

- [ ] **Step 1: Write viz.test.ts**

Tests:
- Creates a visualization with title and steps
- Lists visualizations for a topic

- [ ] **Step 2: Run test to verify it fails, then write viz.ts service**

VizService with methods: `create(topicId, title, steps)`, `listForTopic(topicId)`.

- [ ] **Step 3: Write viz tool handlers**

`registerVizTools(server, svc, sessions, notify)` — registers 2 tools:
- `learn_create_viz` — takes title + steps JSON string, stores viz
- `learn_get_viz` — returns visualizations for active topic

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
git add server/src/services/viz.ts server/src/tools/viz.ts server/__tests__/services/viz.test.ts
git commit -m "feat(viz): add VizService and MCP tools"
```

---

### Task 9: ExerciseService + tools

**Files:**
- Create: `server/src/services/exercises.ts`
- Create: `server/src/tools/exercises.ts`
- Create: `server/__tests__/services/exercises.test.ts`

- [ ] **Step 1: Write exercises.test.ts**

Tests:
- Creates a coding exercise (stores metadata, writes files)
- Creates a quiz exercise (stores quiz_json)
- Submits quiz answers and gets correct score
- Lists exercises for a topic

- [ ] **Step 2: Write exercises.ts service**

ExerciseService with:
- `constructor(db, fileStore)` — needs both storage layers
- `createExercise(topicId, data)` — inserts into DB. For coding/project types, uses `fileStore.writeExerciseFiles` to write starter code + test files
- `runTests(exerciseId)` — uses `execFile` (NOT `exec`) with strict argument arrays. Maps subject language to command via allowlist. Spawns child process, parses output, stores results in `exercise_results`. Returns results array.
- `submitQuiz(exerciseId, answers: number[])` — parses quiz_json, scores answers, stores results, updates exercise status (passed if >= 70%)
- `listForTopic(topicId)` — returns exercises with latest results joined
- `getLanguageCommand(language)` — returns `{ command: string, args: string[] }` from strict allowlist

Language command allowlist (using execFile, never exec):
```typescript
const LANG_COMMANDS: Record<string, { command: string, args: (dir: string) => string[] }> = {
  go: { command: 'go', args: (dir) => ['test', '-json', './...'] },
  python: { command: 'python', args: (dir) => ['-m', 'pytest', '--tb=short', '-q', dir] },
  rust: { command: 'cargo', args: (dir) => ['test', '--manifest-path', `${dir}/Cargo.toml`] },
  javascript: { command: 'npx', args: (dir) => ['vitest', 'run', '--root', dir] },
};
```

- [ ] **Step 3: Write exercise tool handlers**

`registerExerciseTools(server, svc, sessions, notify)` — registers 3 tools:
- `learn_create_exercise` — creates exercise via service
- `learn_run_tests` — runs tests for exercise_id
- `learn_get_exercises` — lists exercises for active topic

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
git add server/src/services/exercises.ts server/src/tools/exercises.ts server/__tests__/services/exercises.test.ts
git commit -m "feat(exercises): add ExerciseService with test runner, quiz scoring, MCP tools"
```

---

## Phase 5: Server Entry Point + Dashboard HTTP

### Task 10: MCP server entry point + Dashboard HTTP server + API

**Files:**
- Create: `server/src/index.ts`
- Create: `server/src/dashboard/server.ts`
- Create: `server/src/dashboard/api.ts`

- [ ] **Step 1: Write index.ts — wire everything together**

1. Create FileStore (default path)
2. Create Database (fileStore.dbPath)
3. Create sessions Map
4. Create all 4 services
5. Create DashboardServer
6. Register all tool groups (curriculum, qa, viz, exercises)
7. Start dashboard
8. Connect MCP server via StdioServerTransport

- [ ] **Step 2: Write server.ts**

DashboardServer class:
- `constructor(db, curriculumSvc, qaSvc, vizSvc, exerciseSvc, port)`
- `start()` — creates HTTP server on `127.0.0.1:port`, routes requests
- `notify()` — broadcasts SSE event to all connected clients
- Static file serving from embedded `static/` directory
- SSE client management (same pattern as go-learn's `dashboard/server.go`)
- CSRF check on POST endpoints: verify `Origin` header matches localhost

- [ ] **Step 3: Write api.ts**

REST API handler functions for all 9 endpoints:
- `GET /api/subjects` — list subjects with progress
- `GET /api/subjects/:id/phases` — phase tree
- `GET /api/topics/:id` — topic with entries
- `GET /api/topics/:id/viz` — visualizations
- `GET /api/topics/:id/exercises` — exercises with results
- `POST /api/exercises/:id/run` — trigger test execution
- `POST /api/exercises/:id/submit` — quiz submission
- `GET /api/search?q=` — full-text search
- `GET /api/events` — SSE stream

Each handler takes services as parameters and returns a handler function.

- [ ] **Step 4: Verify full server compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/dashboard/
git commit -m "feat: add MCP entry point, HTTP server with REST API and SSE"
```

---

### Task 12: Dashboard static files

**Files:**
- Create: `server/src/dashboard/static/index.html`
- Create: `server/src/dashboard/static/app.js`
- Create: `server/src/dashboard/static/styles.css`

- [ ] **Step 1: Build dashboard from mockup**

Reference: `/home/iob/explore-other-projects/learn-cc/mockup/index.html`
Reference: `/tmp/go-learn/internal/dashboard/static/` (SSE, markdown rendering, Q&A cards)

Convert mockup from hardcoded data to dynamic API calls:
- Fetch subjects from `/api/subjects`
- Fetch phases from `/api/subjects/:id/phases`
- Fetch topic detail from `/api/topics/:id`
- Fetch viz from `/api/topics/:id/viz`
- Fetch exercises from `/api/topics/:id/exercises`
- Search via `/api/search?q=`
- SSE listener on `/api/events` for live updates

Viz HTML sanitizer: allowlist filter that strips everything except permitted tags (div, span, small, br, code, strong) and only class/style attributes. No script tags, no event handlers.

Include marked.js + highlight.js for markdown rendering (same CDN links as go-learn).

- [ ] **Step 2: Build and test manually**

Run: `cd server && npm run bundle && node dist/bundle.mjs`
Open: `http://127.0.0.1:19282`
Expected: Dashboard loads, shows empty state

- [ ] **Step 3: Commit**

```bash
git add server/src/dashboard/static/
git commit -m "feat(dashboard): add responsive dashboard with subject switching, tabs, SSE"
```

---

## Phase 6: Integration Test

### Task 13: Integration test

**Files:**
- Create: `server/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

Full flow through service layer:
1. Create subject "Go" with language "go"
2. Import curriculum with 2 phases, 4 topics
3. Get progress — verify 4 total, 0 done
4. Set topic status to in_progress
5. Log question + answer for topic
6. Search for the question text
7. Create visualization for topic
8. List viz — verify 1 result
9. Create coding exercise for topic
10. Create quiz exercise for topic
11. Submit quiz answers — verify scoring
12. Get progress — verify counts updated

- [ ] **Step 2: Run full test suite**

Run: `cd server && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/integration.test.ts
git commit -m "test: add integration test for full learning flow"
```

---

## Phase 7: Plugin Shell

### Task 14: Rules, skills, commands, hooks

**Files:**
- Create: `rules/tutor-mode.md`
- Create: `skills/learn/SKILL.md`
- Create: `skills/import/SKILL.md`
- Create: `commands/learn.md`
- Create: `commands/import.md`
- Create: `commands/dashboard.md`
- Create: `hooks/hooks.json`

- [ ] **Step 1: Write tutor-mode.md**

Adapt go-learn's `.claude/rules/learning-mode.md` to be subject-agnostic:
- Auto-log all Q&A via learn_log_question/learn_log_answer (mandatory, always pair them)
- Check active subject/topic at session start via learn_get_progress
- If no subject active, ask user which to work on
- Adapt teaching style to the subject's language/domain
- Include runnable examples for coding subjects
- Content must be markdown with code blocks

- [ ] **Step 2: Write skills**

`skills/learn/SKILL.md`:
- name: "Learning Session"
- description: "Activates when user asks questions about a subject they're studying. Auto-logs Q&A, manages topic progression, suggests visualizations and exercises."
- Instructions: use learn_* tools, follow tutor-mode rules

`skills/import/SKILL.md`:
- name: "Import Curriculum"
- description: "Activates when user mentions importing PDFs, syllabi, creating new learning subjects, or setting up a curriculum."
- Instructions: read PDF, classify content, call appropriate learn_* tools

- [ ] **Step 3: Write commands**

`commands/learn.md`: /learn — show active subject/topic, list subjects, switch
`commands/import.md`: /learn import — guide PDF import flow
`commands/dashboard.md`: /learn dashboard — print dashboard URL

- [ ] **Step 4: Write hooks.json**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "learn_mark_done",
        "hooks": [{
          "type": "prompt",
          "prompt": "The user just completed a topic. Generate 2-3 exercises for this topic using learn_create_exercise. Include at least one coding exercise and one quiz. Match the difficulty to the topic content."
        }]
      },
      {
        "matcher": "learn_log_answer",
        "hooks": [{
          "type": "prompt",
          "prompt": "You just logged an answer. If the topic would benefit from a visual step-through diagram, create one with learn_create_viz using viz primitives (viz-box, viz-arrow, viz-slot, viz-select-case). Check auto_viz setting first. If off, ask the user."
        }]
      }
    ],
    "PreCompact": [{
      "matcher": "",
      "hooks": [{
        "type": "prompt",
        "prompt": "Before compaction, note the active subject and topic so you can restore context after compaction. Use learn_get_progress to check current state."
      }]
    }]
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add rules/ skills/ commands/ hooks/
git commit -m "feat(plugin): add rules, skills, commands, and hooks"
```

---

### Task 15: Build, bundle, and verify

- [ ] **Step 1: Build and bundle**

Run: `cd server && npm run bundle`
Expected: `dist/bundle.mjs` created

- [ ] **Step 2: Test the bundle starts**

Run: `echo '{}' | timeout 3 node server/dist/bundle.mjs 2>&1 || true`
Expected: stderr contains "study-dash MCP server running"

- [ ] **Step 3: Run full test suite one final time**

Run: `cd server && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build and verify study-dash plugin bundle"
```

---

## Phase Summary

| Phase | Tasks | What it produces |
|-------|-------|-----------------|
| 1: Foundation | 1-4 | Scaffold, types, SQLite schema, file storage |
| 2: Curriculum | 5-6 | CurriculumService + 7 MCP tools |
| 3: Q&A | 7 | QAService + 3 MCP tools |
| 4: Viz + Exercises | 8-9 | VizService + ExerciseService + 5 MCP tools |
| 5: Server + Dashboard | 10-12 | Entry point, HTTP server, API, dashboard UI |
| 6: Integration | 13 | Full-flow integration test |
| 7: Plugin Shell | 14-15 | Rules, skills, commands, hooks, bundle |

**Total: 15 tasks, 7 phases** (Task 10 includes entry point + HTTP server + API)

Each phase produces working, testable software. Phases 1-4 can be tested via vitest without the dashboard. Phase 5 adds the visual layer. Phase 6 validates everything works together. Phase 7 makes it a proper Claude Code plugin.
