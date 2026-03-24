# StudyDash Comprehensive Bugfix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 12 bugs discovered during systematic debugging — cross-platform MCP startup, Go exercise execution, dashboard quiz/exercise rendering, missing MCP tools, and editor language support.

**Architecture:** No architectural changes. All fixes are within existing layers: npm packaging config, ExerciseService, dashboard frontend (app.js), and MCP tool registration. Each task is independently testable.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, MCP SDK, vanilla JS dashboard

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` (root) | Modify | Fix `files` array — remove `better-sqlite3`, add `start.sh` |
| `server/start.sh` | Modify | Force-rebuild native deps when binary is stale |
| `server/src/services/exercises.ts` | Modify | Add `go.mod` generation, add `listForTopic` with results join |
| `server/src/tools/curriculum.ts` | Modify | Add `learn_list_subjects` tool |
| `server/src/tools/exercises.ts` | Modify | Add `learn_submit_quiz`, `learn_get_exercise_files`, `learn_save_exercise_files` tools |
| `server/src/dashboard/api.ts` | Modify | Add exercise results join to exercises endpoint |
| `server/src/dashboard/static/app.js` | Modify | Fix quiz render, exercise results parsing, editor language support |
| `server/src/dashboard/static/index.html` | Modify | Remove hardcoded `main.go` tab labels |
| `server/__tests__/services/exercises.test.ts` | Modify | Add go.mod tests, exercise results join tests |
| `server/__tests__/services/curriculum.test.ts` | Modify | Add list subjects test (service already exists, just verify) |
| `server/__tests__/tools/curriculum.test.ts` | Create | Test learn_list_subjects MCP tool |
| `server/__tests__/tools/exercises.test.ts` | Create | Test learn_submit_quiz, learn_get/save_exercise_files MCP tools |
| `server/__tests__/dashboard/api.test.ts` | Create | Test exercises-with-results endpoint |

---

### Task 1: Fix npm packaging — start.sh missing + better-sqlite3 cross-platform

The MCP server cannot start at all for npm installs. Two issues:
1. `server/start.sh` is not in the `files` array → not included in the tarball
2. `server/node_modules/better-sqlite3` IS in `files` → ships a Pi arm64 binary that crashes on other platforms

**Files:**
- Modify: `package.json` (root, lines 22-32)
- Modify: `server/start.sh`

- [ ] **Step 1: Read current package.json files array**

Current `files` array includes `server/node_modules/better-sqlite3` (ships wrong binary) and is missing `server/start.sh` (required by `.mcp.json`).

- [ ] **Step 2: Fix root package.json files array**

Remove `server/node_modules/better-sqlite3` and add `server/start.sh`:

```json
"files": [
  ".claude-plugin",
  "server/dist",
  "server/package.json",
  "server/start.sh",
  "commands",
  "skills",
  "hooks",
  "rules",
  ".mcp.json"
]
```

- [ ] **Step 3: Fix start.sh to detect stale/missing native binary**

The current check `[ ! -d "$SCRIPT_DIR/node_modules/better-sqlite3" ]` only checks directory existence. We need to check if the binary actually loads:

```bash
#!/bin/sh
# Ensure native dependencies are installed before starting the MCP server.
# better-sqlite3 is a C++ addon that must be compiled on the user's machine.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if better-sqlite3 native binary works on this platform
if ! node -e "require('better-sqlite3')" --prefix "$SCRIPT_DIR" 2>/dev/null; then
  npm install --prefix "$SCRIPT_DIR" --silent 2>/dev/null
fi

exec node "$SCRIPT_DIR/dist/bundle.mjs"
```

- [ ] **Step 4: Verify with npm pack --dry-run**

Run: `npm pack --dry-run 2>&1 | grep -E "(start\.sh|better-sqlite3)"`
Expected: `start.sh` present, `better-sqlite3` absent

- [ ] **Step 5: Test start.sh still works locally**

Run: `timeout 5 sh server/start.sh 2>&1 || true`
Expected: `study-dash MCP server running, dashboard at http://127.0.0.1:19282`

- [ ] **Step 6: Commit**

```bash
git add package.json server/start.sh
git commit -m "fix(packaging): include start.sh, remove pre-built better-sqlite3 from npm tarball

The npm package shipped a platform-specific better-sqlite3 binary (arm64 Linux)
that crashed on other platforms. start.sh now detects stale binaries and rebuilds.
start.sh itself was also missing from the files array.

Closes the 'MCP fails for other people' issue.

🤖 Generated with Claude Code"
```

---

### Task 2: Fix Go exercise test execution — add go.mod

Go exercises fail because `go test ./...` requires a `go.mod` file in the exercise directory.

**Files:**
- Modify: `server/src/services/exercises.ts` (createExercise method, ~line 95)
- Modify: `server/__tests__/services/exercises.test.ts`

- [ ] **Step 1: Write failing test — go.mod created for Go exercises**

Add to `server/__tests__/services/exercises.test.ts`:

```typescript
it('createExercise — Go coding type: creates go.mod in exercise directory', () => {
  const exercise = svc.createExercise(topicId, {
    title: 'Go Mod Test',
    type: 'coding',
    description: 'Test go.mod creation',
    starter_code: 'package main\n\nfunc Hello() string { return "hello" }',
    test_content: 'package main\n\nimport "testing"\n\nfunc TestHello(t *testing.T) {\n\tif Hello() != "hello" { t.Fatal("wrong") }\n}',
  });

  expect(exercise.file_path).toBeTruthy();
  expect(existsSync(join(exercise.file_path, 'go.mod'))).toBe(true);

  const goMod = readFileSync(join(exercise.file_path, 'go.mod'), 'utf-8');
  expect(goMod).toContain('module');
  expect(goMod).toContain('go 1.21');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/services/exercises.test.ts -t "go.mod"`
Expected: FAIL — `go.mod` does not exist

- [ ] **Step 3: Add go.mod generation in createExercise**

In `server/src/services/exercises.ts`, inside the `if ((type === 'coding' || type === 'project') && (starter_code || test_content))` block (around line 95), after writing files, add go.mod for Go:

```typescript
// Add go.mod for Go exercises so `go test` works
if (subject.language.toLowerCase() === 'go') {
  const moduleName = `exercises/${subject.slug}/${exerciseSlug}`;
  files['go.mod'] = `module ${moduleName}\n\ngo 1.21\n`;
}
```

This must be placed BEFORE the `writeExerciseFiles` call so it's included in the files map.

- [ ] **Step 4: Also add go.mod in saveExerciseFiles for Go**

In `saveExerciseFiles` method (~line 324), when creating directory for exercise without file_path, also write go.mod:

```typescript
if (lang === 'go') {
  const goModPath = join(filePath, 'go.mod');
  if (!existsSync(goModPath)) {
    const exerciseSlug = slugify(exercise.title);
    writeFileSync(goModPath, `module exercises/${subject.slug}/${exerciseSlug}\n\ngo 1.21\n`, 'utf-8');
  }
}
```

Add `existsSync` to the imports from `node:fs` if not already there (it is).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run __tests__/services/exercises.test.ts -t "go.mod"`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add server/src/services/exercises.ts server/__tests__/services/exercises.test.ts
git commit -m "fix(exercises): generate go.mod for Go exercises so go test works

Modern Go requires a go.mod file. Without it, 'go test ./...' fails with
'go: no go.mod file found'. Now generated on exercise creation and when
saving files to a new directory.

🤖 Generated with Claude Code"
```

---

### Task 3: Fix quiz rendering in dashboard

Quizzes never render because `app.js` checks `Array.isArray(quiz)` but quiz_json is `{ questions: [...] }`.

**Files:**
- Modify: `server/src/dashboard/static/app.js` (~line 632-655)

- [ ] **Step 1: Fix quiz parsing in renderExercisesTab**

At line 638, change:
```javascript
// BEFORE (broken):
if (quiz && Array.isArray(quiz)) {

// AFTER (fixed):
const questions = Array.isArray(quiz) ? quiz : (quiz && Array.isArray(quiz.questions) ? quiz.questions : null);
if (questions) {
```

Then change all references from `quiz` to `questions` within the block:
- Line 640: `quiz.map(...)` → `questions.map(...)`
- Line 643: `q.question || q.text` stays as-is
- Line 644: `q.options || q.choices` stays as-is

- [ ] **Step 2: Fix submitQuiz to send correct number of answers**

The quiz questions count should match. No change needed here — the answer collection logic at line 728 iterates `.quiz-question` elements which will now exist.

- [ ] **Step 3: Fix quiz result highlighting**

At line 751, `r.correct_index` doesn't exist in the server response. The server returns `{ test_name, passed, output }`. Remove the incorrect highlighting code and replace with pass/fail feedback:

```javascript
if (data.results) {
  data.results.forEach((r, i) => {
    const questionEl = card.querySelectorAll('.quiz-question')[i];
    if (!questionEl) return;
    const options = questionEl.querySelectorAll('.quiz-option');
    const selectedOpt = questionEl.querySelector('.quiz-option.selected');
    if (selectedOpt) {
      selectedOpt.classList.add(r.passed ? 'correct' : 'incorrect');
    }
  });
}
```

- [ ] **Step 4: Rebuild bundle**

Run: `cd server && npm run bundle`
Expected: `Bundle written to dist/bundle.mjs`

- [ ] **Step 5: Manual verification approach**

Start the server, create a quiz exercise via the test suite or MCP tools, verify the quiz renders in the dashboard at http://127.0.0.1:19282.

- [ ] **Step 6: Commit**

```bash
git add server/src/dashboard/static/app.js
git commit -m "fix(dashboard): fix quiz rendering — handle QuizPayload object shape

Quiz UI never rendered because code checked Array.isArray on the QuizPayload
object ({questions: [...]}) instead of the questions array. Also fixed quiz
result highlighting to use actual server response fields.

🤖 Generated with Claude Code"
```

---

### Task 4: Fix exercise test results in dashboard

Two bugs: (a) `runExercise` expects `data.results` but API returns array directly, (b) initial load doesn't include results.

**Files:**
- Modify: `server/src/dashboard/static/app.js` (~lines 771-792)
- Modify: `server/src/dashboard/api.ts` (handleTopicExercises)
- Modify: `server/src/services/exercises.ts` (add listForTopicWithResults)
- Create: `server/__tests__/dashboard/api.test.ts`

- [ ] **Step 1: Write failing test for exercises-with-results**

Create `server/__tests__/dashboard/api.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../../src/storage/db.js';
import { FileStore } from '../../src/storage/files.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ExerciseService } from '../../src/services/exercises.js';

describe('Exercise results join', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let svc: ExerciseService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    const tmpDir = mkdtempSync(join(tmpdir(), 'api-test-'));
    fileStore = new FileStore(tmpDir);
    curriculum = new CurriculumService(db);
    svc = new ExerciseService(db, fileStore);

    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      { name: 'P1', description: '', topics: [{ name: 'T1', description: '' }] },
    ]);
    topicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;
  });

  afterEach(() => { db.close(); });

  it('listForTopicWithResults includes exercise_results', () => {
    const exercise = svc.createExercise(topicId, {
      title: 'Test Results Join',
      type: 'coding',
      description: 'Test',
    });

    // Insert a fake result
    db.raw.prepare(
      'INSERT INTO exercise_results (exercise_id, test_name, passed, output) VALUES (?, ?, ?, ?)'
    ).run(exercise.id, 'TestFoo', 1, 'ok');

    const list = svc.listForTopicWithResults(topicId);
    expect(list).toHaveLength(1);
    expect(list[0].results).toHaveLength(1);
    expect(list[0].results[0].test_name).toBe('TestFoo');
    expect(list[0].results[0].passed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/dashboard/api.test.ts`
Expected: FAIL — `listForTopicWithResults` does not exist

- [ ] **Step 3: Add listForTopicWithResults to ExerciseService**

In `server/src/services/exercises.ts`, add after `listForTopic`:

```typescript
listForTopicWithResults(topicId: number): (Exercise & { results: ExerciseResult[] })[] {
  const exercises = this.listForTopic(topicId);
  const getResults = this.db.raw.prepare<[number], ExerciseResult>(
    'SELECT * FROM exercise_results WHERE exercise_id = ? ORDER BY id ASC'
  );
  return exercises.map(ex => ({
    ...ex,
    results: getResults.all(ex.id),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run __tests__/dashboard/api.test.ts`
Expected: PASS

- [ ] **Step 5: Use listForTopicWithResults in dashboard API**

In `server/src/dashboard/api.ts`, `handleTopicExercises` function (~line 112):

```typescript
// BEFORE:
const exercises = exerciseSvc.listForTopic(id);

// AFTER:
const exercises = exerciseSvc.listForTopicWithResults(id);
```

- [ ] **Step 6: Fix runExercise response parsing in app.js**

At `app.js` line ~778, fix the response handling:

```javascript
// BEFORE (broken):
if (data.results && state.topicExercises[cardIndex]) {
  state.topicExercises[cardIndex].results = data.results;
}

// AFTER (fixed — API returns ExerciseResult[] directly):
if (Array.isArray(data) && state.topicExercises[cardIndex]) {
  state.topicExercises[cardIndex].results = data;
} else if (data.error) {
  console.error('Run exercise error:', data.error);
}
```

- [ ] **Step 7: Rebuild bundle and run full tests**

Run: `cd server && npm test && npm run bundle`
Expected: All tests pass, bundle written

- [ ] **Step 8: Commit**

```bash
git add server/src/services/exercises.ts server/src/dashboard/api.ts server/src/dashboard/static/app.js server/__tests__/dashboard/api.test.ts
git commit -m "fix(dashboard): show exercise test results on initial load and after run

Added listForTopicWithResults to join exercise_results on the exercises
endpoint. Fixed runExercise frontend to handle array response instead of
expecting a .results wrapper.

🤖 Generated with Claude Code"
```

---

### Task 5: Add missing MCP tools — list_subjects, submit_quiz, exercise files

Claude can't discover subjects, submit quizzes, or read/write exercise code.

**Files:**
- Modify: `server/src/tools/curriculum.ts`
- Modify: `server/src/tools/exercises.ts`
- Create: `server/__tests__/tools/exercises.test.ts`

- [ ] **Step 1: Write failing test for learn_list_subjects**

We need an integration-level test that exercises the MCP tool registration. Since the tools are thin wrappers, testing the service method is sufficient. The service `listSubjects()` already works (tested in curriculum.test.ts). We just need the MCP tool.

- [ ] **Step 2: Add learn_list_subjects tool**

In `server/src/tools/curriculum.ts`, after `learn_get_curriculum` (line ~199), add:

```typescript
// 8. learn_list_subjects
server.tool(
  'learn_list_subjects',
  'List all available subjects',
  {},
  async () => {
    const subjects = svc.listSubjects();
    if (subjects.length === 0) {
      return ok('No subjects found. Create one with learn_create_subject.');
    }
    return ok(JSON.stringify(subjects, null, 2));
  },
);
```

- [ ] **Step 3: Write tests for quiz and file MCP tools**

Create `server/__tests__/tools/exercises.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../../src/storage/db.js';
import { FileStore } from '../../src/storage/files.js';
import { CurriculumService } from '../../src/services/curriculum.js';
import { ExerciseService } from '../../src/services/exercises.js';
import type { QuizPayload } from '../../src/types.js';

describe('Exercise MCP tool backing methods', () => {
  let db: Database;
  let fileStore: FileStore;
  let curriculum: CurriculumService;
  let svc: ExerciseService;
  let topicId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    const tmpDir = mkdtempSync(join(tmpdir(), 'tool-test-'));
    fileStore = new FileStore(tmpDir);
    curriculum = new CurriculumService(db);
    svc = new ExerciseService(db, fileStore);

    const subject = curriculum.createSubject('Go', 'go', 'manual');
    curriculum.importCurriculum(subject.id, [
      { name: 'P1', description: '', topics: [{ name: 'T1', description: '' }] },
    ]);
    topicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;
  });

  afterEach(() => { db.close(); });

  it('submitQuiz — returns score and results', () => {
    const quiz: QuizPayload = {
      questions: [
        { id: 1, text: 'Q1', type: 'multiple_choice', options: ['A', 'B'], correct: 0, explanation: 'A' },
      ],
    };
    const ex = svc.createExercise(topicId, {
      title: 'Quiz',
      type: 'quiz',
      description: 'Test',
      quiz_json: JSON.stringify(quiz),
    });

    const result = svc.submitQuiz(ex.id, [0]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('getExerciseFiles + saveExerciseFiles round-trip', () => {
    const ex = svc.createExercise(topicId, {
      title: 'Round Trip',
      type: 'coding',
      description: 'Test',
      starter_code: 'package main',
      test_content: 'package main',
    });

    svc.saveExerciseFiles(ex.id, 'package main\n\nfunc Updated() {}', 'package main\n\nfunc TestUpdated(t *testing.T) {}');

    const files = svc.getExerciseFiles(ex.id);
    expect(files).toBeDefined();
    expect(files!.main).toContain('Updated');
    expect(files!.test).toContain('TestUpdated');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run __tests__/tools/exercises.test.ts`
Expected: PASS (these test existing service methods)

- [ ] **Step 5: Add learn_submit_quiz tool**

In `server/src/tools/exercises.ts`, after `learn_get_exercises`:

```typescript
// 4. learn_submit_quiz
server.tool(
  'learn_submit_quiz',
  'Submit answers for a quiz exercise and get the score',
  {
    exercise_id: z.number().describe('ID of the quiz exercise'),
    answers: z.string().describe('JSON array of answers — numbers for multiple_choice, booleans for true_false, strings for fill_in'),
  },
  async ({ exercise_id, answers }) => {
    let parsed: (number | boolean | string)[];
    try {
      parsed = JSON.parse(answers);
    } catch {
      return err('Invalid JSON in answers parameter');
    }
    if (!Array.isArray(parsed)) {
      return err('answers must be a JSON array');
    }
    try {
      const result = svc.submitQuiz(exercise_id, parsed);
      notify();
      return ok(JSON.stringify(result, null, 2));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return err(`Failed to submit quiz: ${msg}`);
    }
  },
);
```

- [ ] **Step 6: Add learn_get_exercise_files tool**

```typescript
// 5. learn_get_exercise_files
server.tool(
  'learn_get_exercise_files',
  'Get the source code files for a coding exercise',
  {
    exercise_id: z.number().describe('ID of the exercise'),
  },
  async ({ exercise_id }) => {
    const files = svc.getExerciseFiles(exercise_id);
    if (!files) {
      return err(`Exercise ${exercise_id} not found`);
    }
    return ok(JSON.stringify(files, null, 2));
  },
);
```

- [ ] **Step 7: Add learn_save_exercise_files tool**

```typescript
// 6. learn_save_exercise_files
server.tool(
  'learn_save_exercise_files',
  'Save updated source code for a coding exercise',
  {
    exercise_id: z.number().describe('ID of the exercise'),
    main: z.string().describe('Main source file content'),
    test: z.string().describe('Test file content'),
  },
  async ({ exercise_id, main, test }) => {
    try {
      svc.saveExerciseFiles(exercise_id, main, test);
      notify();
      return ok(`Saved files for exercise ${exercise_id}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return err(`Failed to save files: ${msg}`);
    }
  },
);
```

- [ ] **Step 8: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add server/src/tools/curriculum.ts server/src/tools/exercises.ts server/__tests__/tools/exercises.test.ts
git commit -m "feat(tools): add learn_list_subjects, learn_submit_quiz, learn_get/save_exercise_files

Claude can now discover subjects, submit quiz answers, and view/edit exercise
source code during learning sessions. These complete the MCP tool surface.

🤖 Generated with Claude Code"
```

---

### Task 6: Make exercise editor language-aware

The editor hardcodes Go (tab labels, CodeMirror language mode).

**Files:**
- Modify: `server/src/dashboard/static/index.html` (lines 92-93)
- Modify: `server/src/dashboard/static/app.js` (loadCodeMirror, openExerciseEditor)

- [ ] **Step 1: Fix hardcoded tab labels in HTML**

In `index.html`, lines 92-93, change from hardcoded labels to generic placeholders:

```html
<button class="editor-tab active" id="tab-main" onclick="switchEditorTab('main')">main</button>
<button class="editor-tab" id="tab-test" onclick="switchEditorTab('test')">test</button>
```

The `openExerciseEditor` function already dynamically sets tab text from `files.mainFile` / `files.testFile` (lines 908-910), so these are just initial placeholders.

- [ ] **Step 2: Make loadCodeMirror language-aware**

Replace the `loadCodeMirror` function with a language-dispatching version:

```javascript
async function loadCodeMirror(language) {
  if (!window._cmBase) {
    const [
      { EditorView, basicSetup },
      { EditorState },
      { oneDark },
      { keymap },
    ] = await Promise.all([
      import('https://esm.sh/codemirror@6.65.7'),
      import('https://esm.sh/@codemirror/state@6.5.2'),
      import('https://esm.sh/@codemirror/theme-one-dark@6.1.2'),
      import('https://esm.sh/@codemirror/view@6.36.5'),
    ]);
    window._cmBase = { EditorView, EditorState, basicSetup, oneDark, keymap };
  }

  // Load language extension
  const langMap = {
    go: () => import('https://esm.sh/@codemirror/lang-go@6.0.1').then(m => m.go()),
    python: () => import('https://esm.sh/@codemirror/lang-python@6.1.6').then(m => m.python()),
    rust: () => import('https://esm.sh/@codemirror/lang-rust@6.0.1').then(m => m.rust()),
    javascript: () => import('https://esm.sh/@codemirror/lang-javascript@6.2.2').then(m => m.javascript({ typescript: true })),
    typescript: () => import('https://esm.sh/@codemirror/lang-javascript@6.2.2').then(m => m.javascript({ typescript: true })),
  };

  const langFn = langMap[language] || langMap['go'];
  const langExt = await langFn();

  return { ...window._cmBase, langExt };
}
```

- [ ] **Step 3: Update openExerciseEditor to pass language**

In `openExerciseEditor`, change:
```javascript
// BEFORE:
const cm = await loadCodeMirror();
// ...
extensions: [cm.basicSetup, cm.go(), cm.oneDark, runTestsKeymap],

// AFTER:
const cm = await loadCodeMirror(files.language || 'go');
// ...
extensions: [cm.basicSetup, cm.langExt, cm.oneDark, runTestsKeymap],
```

- [ ] **Step 4: Rebuild bundle**

Run: `cd server && npm run bundle`
Expected: `Bundle written to dist/bundle.mjs`

- [ ] **Step 5: Commit**

```bash
git add server/src/dashboard/static/index.html server/src/dashboard/static/app.js
git commit -m "feat(dashboard): make exercise editor language-aware

CodeMirror now loads the correct language mode based on the exercise's subject
language. Supports Go, Python, Rust, JavaScript, and TypeScript. Tab labels
are set dynamically from the API response.

🤖 Generated with Claude Code"
```

---

### Task 7: Final bundle rebuild + full test suite

- [ ] **Step 1: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass (original 51 + new tests)

- [ ] **Step 2: Rebuild bundle**

Run: `cd server && npm run bundle`
Expected: `Bundle written to dist/bundle.mjs`

- [ ] **Step 3: Verify npm packaging**

Run: `npm pack --dry-run 2>&1 | grep -E "(start\.sh|better-sqlite3)"`
Expected: `start.sh` present, NO `better-sqlite3` lines

- [ ] **Step 4: Smoke test — server starts**

Run: `timeout 5 sh server/start.sh 2>&1 || true`
Expected: `study-dash MCP server running`

- [ ] **Step 5: Commit bundle if changed**

```bash
git add server/dist/bundle.mjs
git commit -m "chore: rebuild bundle.mjs

🤖 Generated with Claude Code"
```
