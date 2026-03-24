# Language Registry — Design Specification

**Date**: 2026-03-24
**Status**: Draft
**Author**: Claude (brainstormed with Sorin)

## 1. Overview

### Problem

Language-specific logic is scattered across 5 locations in the codebase. Adding a new language requires touching `extensionForLanguage()`, `commandMap`, go.mod generation, CodeMirror `langMap`, and hljs script tags. This makes it error-prone and tedious to add language support.

Additionally, non-coding subjects (like History) can currently have coding exercises created for them, which then fail with "Unsupported language" when tests are run.

### Solution

Consolidate all server-side language configuration into a single `languages.ts` registry. Each language is a single config entry. Adding a language = adding one entry to one file. Non-coding subjects are gated from coding/project exercise types.

### Non-Goals

- User-configurable languages (YAGNI — Sorin is the primary user)
- Frontend language config changes (CodeMirror and hljs already support all planned languages)
- Changing the exercise file structure (still `main` + `test` per exercise)
- Changing DB schema, MCP tool signatures, or dashboard API contracts

## 2. Architecture

### LanguageConfig Interface

```typescript
interface LanguageConfig {
  id: string;                          // 'go', 'python', 'rust', 'typescript', 'javascript'
  name: string;                        // 'Go', 'Python', 'Rust', 'TypeScript', 'JavaScript'
  extension: string;                   // '.go', '.py', '.rs', '.ts', '.js'
  mainFile: string;                    // 'main.go', 'main.py', 'lib.rs', 'main.ts'
  testFile: string;                    // 'main_test.go', 'test_main.py', 'lib_test.rs', 'main.test.ts'
  testCommand: string;                 // 'go', 'python3', 'cargo', 'npx'
  testArgs: string[];                  // ['test', '-json', '-count=1', './...']
  scaffoldFiles?: Record<string, string>; // { 'go.mod': 'module ...\n\ngo 1.21\n' }
}
```

### Registry

```typescript
const LANGUAGES: Map<string, LanguageConfig> = new Map([...]);

function getLanguageConfig(language: string): LanguageConfig | undefined;
function getExtension(language: string): string;         // fallback: '.txt'
function getTestCommand(language: string): { command: string; args: string[] } | undefined;
function getScaffoldFiles(language: string, subjectSlug: string, exerciseSlug: string): Record<string, string>;
function getFileNames(language: string): { mainFile: string; testFile: string };
```

### What Changes

| Current code | Replacement |
|---|---|
| `extensionForLanguage()` switch in exercises.ts | `getExtension(lang)` from languages.ts |
| `commandMap` object in exercises.ts:134-139 | `getTestCommand(lang)` from languages.ts |
| Go-only go.mod block in exercises.ts:111-114 | `getScaffoldFiles(lang, ...)` from languages.ts |
| `mainFile`/`testFile` hardcoded as `main{ext}`/`main_test{ext}` | `getFileNames(lang)` from languages.ts |
| No validation on exercise type vs subject language | Gate coding/project exercises to subjects with a language |

### What Stays the Same

- DB schema (no changes)
- MCP tool signatures (no changes)
- Dashboard API contracts (no changes)
- Frontend CodeMirror langMap (already language-aware)
- Frontend hljs script tags (already covers go/python/rust/ts)
- Service layer interfaces (ExerciseService methods keep same signatures)

## 3. Language Definitions

### Go
- Files: `main.go`, `main_test.go`
- Test: `go test -json -count=1 ./...`
- Scaffold: `go.mod` with module name and `go 1.21`

### Python
- Files: `main.py`, `test_main.py`
- Test: `python3 -m pytest --tb=short -q .`
- Scaffold: none

### Rust
- Files: `main.rs`, `main_test.rs`
- Test: `cargo test`
- Scaffold: `Cargo.toml` with package name

### JavaScript / TypeScript
- Files: `main.ts`, `main.test.ts`
- Test: `npx vitest run`
- Scaffold: `package.json` with vitest dependency

## 4. Non-Coding Subject Gating

When `learn_create_exercise` is called with `type: 'coding'` or `type: 'project'`:
- Look up the subject for the active topic
- If `subject.language` is empty → return error: "Coding exercises require a subject with a programming language. Use quiz or assignment type instead."
- If `subject.language` is set but not in the registry → return error: "Unsupported language: {lang}. Supported: go, python, rust, typescript, javascript."

Quizzes and assignments are always allowed regardless of language.

## 5. Exercise Hints in Tutor Mode

The `rules/tutor-mode.md` file should include per-language conventions for exercise code generation so Claude follows the right patterns. The exercise generation hook in `hooks.json` should remind Claude to check the subject's language.

The `hooks.json` PostToolUse hook for `learn_mark_done` already tells Claude to generate exercises. We add language context: "Check the subject's language and follow its conventions for file naming and test structure."

## 6. Testing Strategy

- Unit test the registry functions (getExtension, getTestCommand, getScaffoldFiles, getFileNames)
- Unit test non-coding subject gating (reject coding exercise for History)
- Integration test: create Python exercise → verify `test_main.py` naming
- Existing Go tests continue to pass (regression)
