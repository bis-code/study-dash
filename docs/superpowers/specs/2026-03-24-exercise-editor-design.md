# Exercise Editor Design Spec

## Goal

Add a LeetCode-style exercise editor to the StudyDash dashboard. Users click an exercise card to open a full-page split-pane view with a problem description, code editor, and test runner — all in the browser.

## Scope

- **Go language only** (extensible to Python/Rust/TypeScript later)
- **Coding and project exercise types** (quizzes stay as-is)
- **Single-user, local** — no sandboxing or auth concerns

## Architecture

### Navigation Flow

1. User is on topic detail → Exercises tab → clicks an exercise card
2. Topic detail view is replaced with the exercise editor view
3. "Back" button returns to the topic detail (same topic, exercises tab)

### Layout (LeetCode Classic)

```
┌─────────────────────┬──────────────────────────┐
│                     │  [main.go] [main_test.go] │
│  Problem            │─────────────────────────── │
│  Description        │  CodeMirror Editor         │
│                     │                            │
│  - Title            │                            │
│  - Description (md) │                            │
│  - Difficulty/Time  ├────────────────────────────┤
│  - Status           │  TEST OUTPUT               │
│                     │  ✓ TestBinarySearch  0.01s  │
│                     │  ✗ TestEdgeCase     0.00s  │
│                     │  [Run Tests]     [Ctrl+Enter]│
└─────────────────────┴────────────────────────────┘
```

- **Left pane (40%):** Exercise title, difficulty badge, estimated time, status, description rendered as markdown (using existing `marked` library)
- **Right-top (60%, flex-grow):** CodeMirror 6 editor with two tabs — `main.go` and `main_test.go`. Single editor instance, tab switching swaps the document buffer.
- **Right-bottom (fixed ~200px):** Test output panel with per-test pass/fail indicators, progress bar, "Run Tests" button
- **Split:** CSS grid with `grid-template-columns: 2fr 3fr`. No draggable resizer — fixed proportions.

## Backend

### New Endpoints

#### `GET /api/exercises/:id/files`

Returns exercise file contents for the editor.

**Response:**
```json
{
  "main": "package algorithms\n\nfunc BinarySearch...",
  "test": "package algorithms\n\nimport \"testing\"...",
  "language": "go",
  "mainFile": "main.go",
  "testFile": "main_test.go"
}
```

**Logic:**
1. Look up exercise by ID → 404 if not found
2. Look up subject for the exercise's topic → get language
3. Determine file names from language (`main.go`, `main_test.go` for Go)
4. Read files from `exercise.file_path` directory
5. If files don't exist, return empty strings

#### `POST /api/exercises/:id/files`

Saves editor content back to disk.

**Request:**
```json
{
  "main": "package algorithms\n\nfunc BinarySearch...",
  "test": "package algorithms\n\nimport \"testing\"..."
}
```

**Logic:**
1. Look up exercise by ID → 404 if not found
2. Look up subject → determine file names
3. Write `main` content to `main.go`, `test` content to `main_test.go` in `exercise.file_path`
4. If `file_path` is empty (exercise created without starter code), create the directory via FileStore and update the DB
5. Return 200

#### "Run Tests" Flow (Frontend)

Two sequential calls:
1. `POST /api/exercises/:id/files` — save current editor content
2. `POST /api/exercises/:id/run` — existing endpoint, runs `go test`, returns results

No changes to the existing run endpoint.

### File Extension Migration

One-time migration that runs on server startup:

1. Query all exercises with a non-empty `file_path`
2. For each, look up the subject's language → determine correct extension
3. In the exercise directory: if `main.txt` exists but `main.<ext>` doesn't, rename `main.txt` → `main.<ext>` (same for test file)
4. Idempotent — safe to run multiple times
5. Log count of migrated files to stderr

**Location:** New function in `FileStore` or a standalone migration module, called from server startup in `index.ts`.

## Frontend

### CodeMirror 6 Integration

**CDN loading via ES modules from `esm.sh`:**
- `codemirror` (core)
- `@codemirror/lang-go` (Go syntax highlighting)
- `@codemirror/theme-one-dark` (dark theme matching dashboard)

**Lazy loading:** Modules are imported dynamically on first editor open, not on page load. Cached in `window._cm` for subsequent opens.

**Editor configuration:**
- Go language support
- One Dark theme
- Line numbers
- Bracket matching
- Basic keybindings (default keymap)
- `Ctrl+Enter` / `Cmd+Enter` → Run Tests

**Tab switching:** Two content buffers stored in JS state (`mainContent`, `testContent`). Switching tabs:
1. Read current editor content into the active buffer
2. Replace editor document with the other buffer's content
3. Update active tab indicator

### New Functions in `app.js`

#### `openExerciseEditor(exerciseId)`
- Fetches exercise data + files from API
- Replaces topic detail view with editor layout
- Initializes CodeMirror (lazy-loads if first time)
- Sets up tab switching and keyboard shortcuts

#### `closeExerciseEditor()`
- Restores topic detail view
- Re-renders exercises tab (to show updated status/results)

#### `runTestsFromEditor(exerciseId)`
- Saves current editor content via `POST /api/exercises/:id/files`
- Calls `POST /api/exercises/:id/run`
- Updates test output panel with results
- Updates exercise status in state

### Styles

New CSS for:
- `.exercise-editor` — full-height grid container
- `.exercise-editor-problem` — left pane with scrollable markdown
- `.exercise-editor-code` — right pane with tabs + CodeMirror
- `.exercise-editor-output` — test output panel
- `.editor-tab`, `.editor-tab.active` — tab styling
- `.test-result-row` — individual test pass/fail display

All using existing CSS variables (`--bg-primary`, `--text-primary`, `--green`, etc.) to match the dashboard theme.

### Exercise Card Update

The existing exercise cards in `renderExercisesTab()` get an "Open Editor" button for coding/project exercises (in addition to the existing "Run Tests" button). Clicking it calls `openExerciseEditor(exercise.id)`.

## Non-Goals

- **No draggable split panes** — fixed proportions, keep it simple
- **No multi-language support** — Go only for now
- **No real-time collaboration** — single user
- **No file tree** — just two files (main + test)
- **No Monaco editor** — CodeMirror is sufficient
- **No autosave** — save happens on Run Tests

## Future Extensions

- Add language support (Python, Rust, TypeScript) by loading the appropriate CodeMirror language pack
- Add more file tabs if exercises need multiple files
- Draggable split pane divider
- Auto-save with debounce
- Diff view comparing your solution to a reference
