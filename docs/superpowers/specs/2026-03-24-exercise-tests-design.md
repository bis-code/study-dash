# Exercise Test Enhancements — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Problem

1. Exercises created by Claude sometimes lack test content — the learn skill has no instructions about exercise creation at all, so test files end up as placeholders or empty.
2. Users cannot add test cases from the dashboard editor. The only way to add tests is editing the raw test file, which requires knowing Go test boilerplate.

## Solution

Two complementary changes:

### Part 1: Learn Skill — Exercise Creation Rules

Update `skills/learn/SKILL.md` to add explicit exercise creation instructions:

- When creating coding/project exercises via `learn_create_exercise`, Claude MUST always provide `test_content` with real, runnable tests.
- Minimum 3 test cases per exercise: happy path, edge case (empty/nil/zero), boundary case.
- Tests use idiomatic patterns per language:
  - Go: table-driven `t.Run()` subtests with `struct { name, input, expected }`
  - Python: `pytest.mark.parametrize` or individual `test_*` functions
  - Rust: `#[test]` functions with `assert_eq!`
- `starter_code` must contain function stubs that compile but return zero values, so tests fail meaningfully until the user implements the solution.
- Test names must be descriptive (they appear in the dashboard results).
- These are hard rules in the skill instructions. The MCP tool keeps `test_content` optional (for quiz type), but the skill text makes it clear that coding/project exercises without tests are incomplete.

### Part 2: Dashboard — Add Test Case UI

A template-based form in the exercise editor for adding test cases without writing boilerplate. **V1 scope: Go templates only.** Python/Rust templates can be added later following the same pattern. The form is hidden for non-Go exercises (users can still edit the test file directly via the raw editor tab).

#### UI Location

An "Add Test" button in the editor toolbar (alongside VS Code / Back buttons). Clicking opens an inline form below the toolbar, above the code editor.

#### Form Fields

| Field | Type | Required | Example |
|-------|------|----------|---------|
| Test Name | text input | yes | "empty slice returns -1" |
| Input | textarea | yes | `[]int{}, 5` |
| Expected | textarea | yes | `-1` |
| Assertion Type | dropdown | yes | equals, deep equals, error expected, no error, contains |

#### Generation Logic

On "Add", the system generates a test function using templates and appends it to the test file content.

**Go templates by assertion type:**

```go
// equals
t.Run("{name}", func(t *testing.T) {
    got := {FuncName}({input})
    if got != {expected} {
        t.Errorf("{FuncName}({input}) = %v, want %v", got, {expected})
    }
})

// deep equals
t.Run("{name}", func(t *testing.T) {
    got := {FuncName}({input})
    if !reflect.DeepEqual(got, {expected}) {
        t.Errorf("{FuncName}({input}) = %v, want %v", got, {expected})
    }
})

// error expected
t.Run("{name}", func(t *testing.T) {
    _, err := {FuncName}({input})
    if err == nil {
        t.Error("expected error, got nil")
    }
})

// no error
t.Run("{name}", func(t *testing.T) {
    _, err := {FuncName}({input})
    if err != nil {
        t.Errorf("unexpected error: %v", err)
    }
})

// contains
t.Run("{name}", func(t *testing.T) {
    got := {FuncName}({input})
    if !strings.Contains(got, {expected}) {
        t.Errorf("{FuncName}({input}) = %q, want substring %q", got, {expected})
    }
})
```

#### Function Name Detection

Auto-detect from `state.editorMainContent` using regex:
- Go: `/^func\s+([A-Z]\w+)\(/m` (first exported function), then `/^func\s+\([^)]+\)\s+([A-Z]\w+)\(/m` (first exported method)
- Python: `/^def\s+(\w+)\(/m`
- Fallback: `FuncName` placeholder for user to edit

**Limitation:** Method-based exercises (e.g., `func (s *Stack) Push(...)`) require the user to manually adjust the generated call in the test tab. The form pre-fills what it can detect but the raw editor is always available.

#### Insertion Logic

The generated `t.Run(...)` block is inserted before the closing `}` of the last `func Test...` function in the test file. If no test function exists, a wrapper `func TestSolution(t *testing.T) { ... }` is created. (`TestMain` is reserved in Go for test setup/teardown via `*testing.M`.)

**Import handling:** When inserting a test that uses `reflect.DeepEqual` or `strings.Contains`, check if the test file already has the required import (`"reflect"` or `"strings"`). If not, add it to the existing `import (...)` block. If no import block exists, create one after the `package` line.

#### Data Flow

1. User fills form, clicks "Add"
2. Frontend generates test code string from template
3. Appends to `state.editorTestContent`
4. If test tab is active, updates CodeMirror via `state.editorView.dispatch()` to replace content
5. No server call — changes are local until "Run Tests" (which saves then executes)
6. If the user enters invalid Go in form fields, the compile error surfaces naturally via "Run Tests" output — no client-side validation needed. The user can fix the generated code in the raw test editor.

## Architecture

### Files Changed

| Layer | File | Change |
|-------|------|--------|
| Frontend | `app.js` | Add test case form logic, template generation, function name detection, insertion |
| Frontend | `styles.css` | Form styles (inline panel in editor) |
| Frontend | `index.html` | Form markup in exercise editor page |
| Skill | `skills/learn/SKILL.md` | Exercise creation rules with test requirements |

### No Backend Changes

The test case feature is purely frontend string manipulation feeding into existing APIs:
- `POST /api/exercises/:id/files` — saves files (already exists)
- `POST /api/exercises/:id/run` — runs tests (already exists)

### No Database Changes

Test content is stored as a string in the existing `test_content` column. The structured form just generates code that goes into this string.

## Testing Strategy

- Verify learn skill instructions produce exercises with real tests (manual via Claude session)
- Test function name detection regex against various Go/Python function signatures
- Test template generation produces valid, compilable Go test code
- Test insertion logic correctly places new tests inside existing test functions
- E2E: add a test case via form, run tests, verify it appears in results
