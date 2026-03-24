# Language Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all language-specific logic into a single registry so adding a language is a one-entry change, and gate coding exercises for non-coding subjects.

**Architecture:** Create `server/src/languages.ts` with a `LanguageConfig` interface and registry map. Replace all scattered switch/map patterns in `exercises.ts` with registry lookups. Add exercise type validation in the MCP tool layer.

**Tech Stack:** TypeScript, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/languages.ts` | Create | Language registry — single source of truth for all language config |
| `server/src/services/exercises.ts` | Modify | Replace `extensionForLanguage()`, `commandMap`, go.mod logic with registry calls |
| `server/src/tools/exercises.ts` | Modify | Add non-coding subject gating for coding/project exercises |
| `server/__tests__/languages.test.ts` | Create | Unit tests for registry functions |
| `server/__tests__/services/exercises.test.ts` | Modify | Add Python file naming test, update go.mod test |
| `server/__tests__/tools/exercises.test.ts` | Modify | Add non-coding subject gating test |
| `rules/tutor-mode.md` | Modify | Add language-aware exercise generation guidance |
| `hooks/hooks.json` | Modify | Add language context hint to exercise generation hook |

---

### Task 1: Create the language registry

**Files:**
- Create: `server/src/languages.ts`
- Create: `server/__tests__/languages.test.ts`

- [ ] **Step 1: Write failing tests for the registry**

Create `server/__tests__/languages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getLanguageConfig,
  getExtension,
  getTestCommand,
  getScaffoldFiles,
  getFileNames,
  isLanguageSupported,
  SUPPORTED_LANGUAGES,
} from '../src/languages.js';

describe('Language Registry', () => {
  it('getLanguageConfig returns config for known language', () => {
    const go = getLanguageConfig('go');
    expect(go).toBeDefined();
    expect(go!.id).toBe('go');
    expect(go!.extension).toBe('.go');
    expect(go!.mainFile).toBe('main.go');
    expect(go!.testFile).toBe('main_test.go');
  });

  it('getLanguageConfig is case-insensitive', () => {
    expect(getLanguageConfig('Go')).toBeDefined();
    expect(getLanguageConfig('GO')).toBeDefined();
    expect(getLanguageConfig('go')).toBeDefined();
  });

  it('getLanguageConfig returns undefined for unknown language', () => {
    expect(getLanguageConfig('cobol')).toBeUndefined();
  });

  it('getLanguageConfig returns undefined for empty string', () => {
    expect(getLanguageConfig('')).toBeUndefined();
  });

  it('getExtension returns correct extensions', () => {
    expect(getExtension('go')).toBe('.go');
    expect(getExtension('python')).toBe('.py');
    expect(getExtension('rust')).toBe('.rs');
    expect(getExtension('typescript')).toBe('.ts');
    expect(getExtension('javascript')).toBe('.ts');
  });

  it('getExtension returns .txt for unknown language', () => {
    expect(getExtension('cobol')).toBe('.txt');
    expect(getExtension('')).toBe('.txt');
  });

  it('getTestCommand returns command for known language', () => {
    const cmd = getTestCommand('go');
    expect(cmd).toBeDefined();
    expect(cmd!.command).toBe('go');
    expect(cmd!.args).toContain('test');
  });

  it('getTestCommand returns undefined for unknown language', () => {
    expect(getTestCommand('cobol')).toBeUndefined();
  });

  it('getFileNames returns language-specific names', () => {
    expect(getFileNames('go')).toEqual({ mainFile: 'main.go', testFile: 'main_test.go' });
    expect(getFileNames('python')).toEqual({ mainFile: 'main.py', testFile: 'test_main.py' });
    expect(getFileNames('rust')).toEqual({ mainFile: 'main.rs', testFile: 'main_test.rs' });
    expect(getFileNames('typescript')).toEqual({ mainFile: 'main.ts', testFile: 'main.test.ts' });
  });

  it('getFileNames returns .txt fallback for unknown language', () => {
    expect(getFileNames('')).toEqual({ mainFile: 'main.txt', testFile: 'main_test.txt' });
  });

  it('getScaffoldFiles returns go.mod for Go', () => {
    const files = getScaffoldFiles('go', 'go', 'hello-world');
    expect(files['go.mod']).toBeDefined();
    expect(files['go.mod']).toContain('module');
    expect(files['go.mod']).toContain('go 1.21');
  });

  it('getScaffoldFiles returns empty for Python', () => {
    const files = getScaffoldFiles('python', 'python', 'hello');
    expect(Object.keys(files).length).toBe(0);
  });

  it('isLanguageSupported correctly identifies languages', () => {
    expect(isLanguageSupported('go')).toBe(true);
    expect(isLanguageSupported('python')).toBe(true);
    expect(isLanguageSupported('cobol')).toBe(false);
    expect(isLanguageSupported('')).toBe(false);
  });

  it('SUPPORTED_LANGUAGES lists all registered languages', () => {
    expect(SUPPORTED_LANGUAGES).toContain('go');
    expect(SUPPORTED_LANGUAGES).toContain('python');
    expect(SUPPORTED_LANGUAGES).toContain('rust');
    expect(SUPPORTED_LANGUAGES).toContain('typescript');
    expect(SUPPORTED_LANGUAGES).toContain('javascript');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run __tests__/languages.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the language registry**

Create `server/src/languages.ts`:

```typescript
export interface LanguageConfig {
  id: string;
  name: string;
  extension: string;
  mainFile: string;
  testFile: string;
  testCommand: string;
  testArgs: string[];
  scaffoldFiles?: (subjectSlug: string, exerciseSlug: string) => Record<string, string>;
}

const REGISTRY: Map<string, LanguageConfig> = new Map();

function register(config: LanguageConfig): void {
  REGISTRY.set(config.id, config);
}

// ── Go ──────────────────────────────────────────────────────────────────────
register({
  id: 'go',
  name: 'Go',
  extension: '.go',
  mainFile: 'main.go',
  testFile: 'main_test.go',
  testCommand: 'go',
  testArgs: ['test', '-json', '-count=1', './...'],
  scaffoldFiles: (subjectSlug, exerciseSlug) => ({
    'go.mod': `module exercises/${subjectSlug}/${exerciseSlug}\n\ngo 1.21\n`,
  }),

});

// ── Python ──────────────────────────────────────────────────────────────────
register({
  id: 'python',
  name: 'Python',
  extension: '.py',
  mainFile: 'main.py',
  testFile: 'test_main.py',
  testCommand: 'python3',
  testArgs: ['-m', 'pytest', '--tb=short', '-q', '.'],

});

// ── Rust ────────────────────────────────────────────────────────────────────
register({
  id: 'rust',
  name: 'Rust',
  extension: '.rs',
  mainFile: 'main.rs',
  testFile: 'main_test.rs',
  testCommand: 'cargo',
  testArgs: ['test'],
  scaffoldFiles: (subjectSlug, exerciseSlug) => ({
    'Cargo.toml': `[package]\nname = "${exerciseSlug}"\nversion = "0.1.0"\nedition = "2021"\n`,
  }),

});

// ── TypeScript ──────────────────────────────────────────────────────────────
register({
  id: 'typescript',
  name: 'TypeScript',
  extension: '.ts',
  mainFile: 'main.ts',
  testFile: 'main.test.ts',
  testCommand: 'npx',
  testArgs: ['vitest', 'run'],
  scaffoldFiles: () => ({
    'package.json': '{"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^2.0.0"}}',
  }),

});

// ── JavaScript (alias to TypeScript config with .ts extension) ──────────────
register({
  id: 'javascript',
  name: 'JavaScript',
  extension: '.ts',
  mainFile: 'main.ts',
  testFile: 'main.test.ts',
  testCommand: 'npx',
  testArgs: ['vitest', 'run'],
  scaffoldFiles: () => ({
    'package.json': '{"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^2.0.0"}}',
  }),

});

// ── Public API ──────────────────────────────────────────────────────────────

export function getLanguageConfig(language: string): LanguageConfig | undefined {
  return REGISTRY.get(language.toLowerCase());
}

export function getExtension(language: string): string {
  return getLanguageConfig(language)?.extension ?? '.txt';
}

export function getTestCommand(language: string): { command: string; args: string[] } | undefined {
  const config = getLanguageConfig(language);
  if (!config) return undefined;
  return { command: config.testCommand, args: config.testArgs };
}

export function getScaffoldFiles(language: string, subjectSlug: string, exerciseSlug: string): Record<string, string> {
  const config = getLanguageConfig(language);
  return config?.scaffoldFiles?.(subjectSlug, exerciseSlug) ?? {};
}

export function getFileNames(language: string): { mainFile: string; testFile: string } {
  const config = getLanguageConfig(language);
  if (!config) return { mainFile: 'main.txt', testFile: 'main_test.txt' };
  return { mainFile: config.mainFile, testFile: config.testFile };
}

export function isLanguageSupported(language: string): boolean {
  return REGISTRY.has(language.toLowerCase());
}

export const SUPPORTED_LANGUAGES: string[] = [...REGISTRY.keys()];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/languages.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/languages.ts server/__tests__/languages.test.ts
git commit -m "feat(languages): create language registry with Go, Python, Rust, TypeScript

Single source of truth for file extensions, test commands, scaffold files,
and exercise hints per language. Adding a language = adding one entry.

🤖 Generated with Claude Code"
```

---

### Task 2: Wire ExerciseService to use the registry

Replace all scattered language logic in `exercises.ts` with registry calls.

**Files:**
- Modify: `server/src/services/exercises.ts`
- Modify: `server/__tests__/services/exercises.test.ts`

- [ ] **Step 1: Write failing test for Python file naming**

Add to `server/__tests__/services/exercises.test.ts`:

```typescript
it('createExercise — Python coding type: uses test_main.py naming convention', () => {
  const subject = curriculum.createSubject('Python Basics', 'python', 'manual');
  curriculum.importCurriculum(subject.id, [
    { name: 'P1', description: '', topics: [{ name: 'Functions', description: '' }] },
  ]);
  const pyTopicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;

  const exercise = svc.createExercise(pyTopicId, {
    title: 'Add Numbers',
    type: 'coding',
    description: 'Add two numbers',
    starter_code: 'def add(a, b):\n    pass',
    test_content: 'from main import add\n\ndef test_add():\n    assert add(1, 2) == 3',
  });

  expect(exercise.file_path).toBeTruthy();
  expect(existsSync(join(exercise.file_path, 'main.py'))).toBe(true);
  expect(existsSync(join(exercise.file_path, 'test_main.py'))).toBe(true);
  // Should NOT have main_test.py (that's Go convention)
  expect(existsSync(join(exercise.file_path, 'main_test.py'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/services/exercises.test.ts -t "Python"`
Expected: FAIL — file is `main_test.py` not `test_main.py`

- [ ] **Step 3: Replace language logic in exercises.ts**

In `server/src/services/exercises.ts`:

1. Add import at top:
```typescript
import { getExtension, getTestCommand, getScaffoldFiles, getFileNames } from '../languages.js';
```

2. **Delete** the `extensionForLanguage` function (lines 18-31).

3. In `createExercise` (~line 95-116), replace the file writing block:
```typescript
if ((type === 'coding' || type === 'project') && (starter_code || test_content)) {
  const subject = this.getSubjectForTopic(topicId);
  if (subject) {
    const lang = subject.language.toLowerCase();
    const exerciseSlug = slugify(title);
    const { mainFile, testFile } = getFileNames(lang);

    const files: Record<string, string> = {};
    if (starter_code) files[mainFile] = starter_code;
    if (test_content) files[testFile] = test_content;
    files['README.md'] = `# ${title}\n\n${description}`;

    // Add scaffold files (go.mod, Cargo.toml, etc.)
    const scaffold = getScaffoldFiles(lang, subject.slug, exerciseSlug);
    Object.assign(files, scaffold);

    const filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, files);
    this.db.raw.prepare('UPDATE exercises SET file_path = ? WHERE id = ?').run(filePath, exerciseId);
  }
}
```

4. In `runTests` (~line 134-148), replace the `commandMap` with:
```typescript
const lang = subject.language.toLowerCase();
const config = getTestCommand(lang);
if (!config) throw new Error(`Unsupported language: ${subject.language}`);
```
Then use `config.command` and `config.args` instead of `commandMap[...]`.

5. In `getExerciseFiles` (~line 297-309), replace the extension/filename logic:
```typescript
const lang = subject?.language.toLowerCase() ?? '';
const { mainFile, testFile } = getFileNames(lang);

let main = '';
let test = '';
if (exercise.file_path) {
  try { main = readFileSync(join(exercise.file_path, mainFile), 'utf-8'); } catch {}
  try { test = readFileSync(join(exercise.file_path, testFile), 'utf-8'); } catch {}
}

return { main, test, language: lang, mainFile, testFile };
```

6. In `saveExerciseFiles` (~line 321-333), replace:
```typescript
const lang = subject.language.toLowerCase();
const { mainFile, testFile } = getFileNames(lang);

let filePath = exercise.file_path;
if (!filePath) {
  const exerciseSlug = slugify(exercise.title);
  filePath = this.fileStore.writeExerciseFiles(subject.slug, exerciseSlug, {});
  this.db.raw.prepare('UPDATE exercises SET file_path = ? WHERE id = ?').run(filePath, exerciseId);
}

// Add scaffold files if missing
const scaffold = getScaffoldFiles(lang, subject.slug, slugify(exercise.title));
for (const [name, content] of Object.entries(scaffold)) {
  const p = join(filePath, name);
  if (!existsSync(p)) writeFileSync(p, content, 'utf-8');
}

writeFileSync(join(filePath, mainFile), main, 'utf-8');
writeFileSync(join(filePath, testFile), test, 'utf-8');
```

7. In `migrateFileExtensions` (~line 345), replace `extensionForLanguage` call:
```typescript
const ext = getExtension(subject.language.toLowerCase());
```

- [ ] **Step 4: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass (existing Go tests still work + new Python test passes)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/exercises.ts server/__tests__/services/exercises.test.ts
git commit -m "refactor(exercises): use language registry instead of scattered switch/map

Replaced extensionForLanguage(), commandMap, and hardcoded go.mod logic
with registry lookups from languages.ts. Python exercises now correctly
use test_main.py naming convention.

🤖 Generated with Claude Code"
```

---

### Task 3: Gate coding exercises for non-coding subjects

**Files:**
- Modify: `server/src/tools/exercises.ts`
- Modify: `server/__tests__/tools/exercises.test.ts`

- [ ] **Step 1: Write failing test**

Add to `server/__tests__/tools/exercises.test.ts`:

```typescript
// Add to the existing describe block, using the existing db/fileStore/curriculum/svc:

import { isLanguageSupported } from '../../src/languages.js';

it('getSubjectLanguage — returns empty string for non-coding subject', () => {
  const subject = curriculum.createSubject('History', '', 'manual');
  curriculum.importCurriculum(subject.id, [
    { name: 'Ancient', description: '', topics: [{ name: 'Egypt', description: '' }] },
  ]);
  const histTopicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;

  const lang = svc.getSubjectLanguage(histTopicId);
  expect(lang).toBe('');
  expect(isLanguageSupported(lang)).toBe(false);
});

it('getSubjectLanguage — returns language for coding subject', () => {
  // topicId from beforeEach is a Go topic
  const lang = svc.getSubjectLanguage(topicId);
  expect(lang).toBe('go');
  expect(isLanguageSupported(lang)).toBe(true);
});

it('createExercise — quiz works for non-coding subject', () => {
  const subject = curriculum.createSubject('History', '', 'manual');
  curriculum.importCurriculum(subject.id, [
    { name: 'Ancient', description: '', topics: [{ name: 'Egypt', description: '' }] },
  ]);
  const histTopicId = curriculum.getCurriculum(subject.id)[0].topics[0].id;

  const quiz = svc.createExercise(histTopicId, {
    title: 'History Quiz',
    type: 'quiz',
    description: 'Test',
    quiz_json: JSON.stringify({ questions: [] }),
  });
  expect(quiz.id).toBeGreaterThan(0);
});
```

The gating itself lives in the MCP tool handler (Step 2). These tests verify the building blocks: `getSubjectLanguage` returns the right value, and `isLanguageSupported` correctly identifies non-coding subjects. The tool handler uses these to reject coding exercises.

- [ ] **Step 2: Add gating logic to learn_create_exercise tool**

In `server/src/tools/exercises.ts`, in the `learn_create_exercise` handler, after the session check and before calling `svc.createExercise`:

```typescript
import { isLanguageSupported, SUPPORTED_LANGUAGES } from '../languages.js';
```

Add validation:
```typescript
// Gate coding/project exercises for subjects without a language
if (type === 'coding' || type === 'project') {
  // Look up subject for the topic
  const topic = svc.listForTopic(session.topicId);
  // We need the subject — add a helper or use the DB directly
  // Actually, we need to expose getSubjectForTopic or check language via curriculum
}
```

The cleanest approach: add a public `getSubjectLanguage(topicId: number): string` method to ExerciseService:

In `server/src/services/exercises.ts`, add:
```typescript
getSubjectLanguage(topicId: number): string {
  const subject = this.getSubjectForTopic(topicId);
  return subject?.language ?? '';
}
```

Then in the tool handler:
```typescript
if (type === 'coding' || type === 'project') {
  const lang = svc.getSubjectLanguage(session.topicId);
  if (!lang) {
    return err('Coding/project exercises require a subject with a programming language. Use quiz or assignment type instead.');
  }
  if (!isLanguageSupported(lang)) {
    return err(`Unsupported language: "${lang}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd server && npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add server/src/services/exercises.ts server/src/tools/exercises.ts server/__tests__/tools/exercises.test.ts
git commit -m "feat(exercises): gate coding exercises for non-coding subjects

Subjects without a language cannot have coding/project exercises.
Quizzes and assignments are always allowed.

🤖 Generated with Claude Code"
```

---

### Task 4: Update tutor-mode rule and exercise generation hook

**Files:**
- Modify: `rules/tutor-mode.md`
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Update tutor-mode.md**

Add a section after "Teaching Style" in `rules/tutor-mode.md`:

```markdown
## Exercise Generation

When creating exercises for coding subjects:
- Check the subject's language before generating code
- Follow the language's conventions for file structure and testing:
  - **Go**: package main, testing.T, main.go + main_test.go
  - **Python**: plain functions, pytest assertions, main.py + test_main.py
  - **Rust**: fn functions, #[test] + assert_eq!, main.rs + main_test.rs
  - **TypeScript/JavaScript**: ESM exports, vitest describe/it/expect, main.ts + main.test.ts
- For non-coding subjects (no language): only create quiz or assignment exercises
- Always provide starter_code and test_content for coding exercises
```

- [ ] **Step 2: Update exercise generation hook**

In `hooks/hooks.json`, update the `learn_mark_done` PostToolUse hook prompt:

```json
"prompt": "The user just completed a topic. Generate 2-3 exercises for this topic using learn_create_exercise. Include at least one coding exercise (if the subject has a programming language) and one quiz. Match the difficulty to the topic content. For coding exercises, always provide starter_code and test_content following the subject's language conventions."
```

- [ ] **Step 3: Commit**

```bash
git add rules/tutor-mode.md hooks/hooks.json
git commit -m "docs(rules): add language-aware exercise generation guidance

Updated tutor-mode rule with per-language conventions for exercise code.
Updated exercise generation hook to respect subject language.

🤖 Generated with Claude Code"
```

---

### Task 5: Final verification + bundle rebuild

- [ ] **Step 1: Run full test suite**

Run: `cd server && npm test`
Expected: All tests pass

- [ ] **Step 2: Rebuild bundle**

Run: `cd server && npm run bundle`
Expected: `Bundle written to dist/bundle.mjs`

- [ ] **Step 3: Verify npm packaging**

Run: `cd /home/iob/explore-other-projects/learn-cc && npm pack --dry-run 2>&1 | head -40`
Expected: Correct files, no `node_modules/better-sqlite3`

- [ ] **Step 4: Smoke test**

Run: `timeout 5 sh server/start.sh 2>&1 || true`
Expected: `study-dash MCP server running`

- [ ] **Step 5: Commit bundle**

```bash
git add -f server/dist/bundle.mjs
git commit -m "chore: rebuild bundle.mjs

🤖 Generated with Claude Code"
```
