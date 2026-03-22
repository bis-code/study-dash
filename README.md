# StudyDash

A Claude Code plugin for structured learning on any subject. Import curricula from PDFs or build your own, track Q&A sessions, get AI-generated visualizations, and validate your understanding with exercises — all from a live dashboard.

## Install

```bash
# Add the bis-code marketplace (one-time)
/plugin marketplace add bis-code/claude-plugins

# Install the plugin
/plugin install study-dash@bis-code
```

## How It Works

```
import curriculum → study topics → log Q&A → generate viz → create exercises
       |                |              |            |              |
  PDF / manual     set active      auto-logged   AI step-through  coding + quiz
  roadmap.sh       topic           to dashboard   diagrams         with real tests
```

**Start learning** with `/learn` — pick a subject or create one. Ask questions and Claude auto-logs everything to the dashboard.

**Import a curriculum** with `/import` — drop a PDF syllabus from school (itslearning, etc.) and the plugin extracts phases, topics, and assignments automatically.

**Dashboard** at `http://127.0.0.1:19282` — live updates via SSE as you learn.

## Dashboard

The dashboard shows your learning progress across all subjects:

- **Home** — subject switcher, stats grid, recently active topics
- **Topics** — phase tree with collapsible groups, completion status
- **Topic Detail** — four tabs:
  - **Q&A** — paired question/answer cards with syntax highlighting
  - **Visualize** — AI-generated step-through diagrams (prev/next controls)
  - **Exercises** — coding exercises with test validation, quizzes, projects, school assignments
  - **Resources** — reference links, context7 docs, imported PDFs
- **Search** — full-text search across all your notes

Mobile-responsive: bottom nav on phones, sidebar on desktop.

## Commands

| Command | What it does |
|---------|-------------|
| `/learn` | Start or manage a learning session — show active subject/topic, switch |
| `/import` | Import a PDF syllabus, lecture slides, or assignment |
| `/dashboard` | Show the dashboard URL |

## Skills (auto-triggering)

| Skill | Triggers when... |
|-------|-----------------|
| `Learning Session` | User asks questions about a subject they're studying |
| `Import Curriculum` | User mentions importing PDFs, syllabi, or creating subjects |

## MCP Tools

### Curriculum
| Tool | Description |
|------|------------|
| `learn_create_subject` | Create a new learning subject |
| `learn_import_curriculum` | Import phases and topics from structured data |
| `learn_switch_subject` | Set the active subject |
| `learn_set_topic` | Set the active topic |
| `learn_mark_done` | Mark a topic as completed |
| `learn_get_progress` | Get completion stats |
| `learn_get_curriculum` | Get the full topic tree |

### Q&A
| Tool | Description |
|------|------------|
| `learn_log_question` | Log a question (markdown) |
| `learn_log_answer` | Log an answer paired to a question |
| `learn_search` | Full-text search across all entries |

### Visualizations
| Tool | Description |
|------|------------|
| `learn_create_viz` | Store a step-through visualization |
| `learn_get_viz` | List visualizations for the current topic |

### Exercises
| Tool | Description |
|------|------------|
| `learn_create_exercise` | Create a coding exercise, quiz, project, or assignment |
| `learn_run_tests` | Execute tests and return pass/fail results |
| `learn_get_exercises` | List exercises for the current topic |

## Hooks

| Event | Action |
|-------|--------|
| After `learn_mark_done` | Auto-generates exercises for the completed topic |
| After `learn_log_answer` | Considers generating a visualization (configurable) |
| Before compaction | Saves active subject/topic to preserve context |

## Curriculum Sources

| Source | How |
|--------|-----|
| **PDF** | Drop a school syllabus/slides/assignment — Claude reads and classifies it |
| **Manual** | Define phases and topics yourself, or follow roadmap.sh |
| **context7** | Supplements existing topics with live library documentation |

## Exercise Types

| Type | Validation |
|------|-----------|
| **Coding** | Real test execution (`go test`, `pytest`, `cargo test`, `vitest`) |
| **Quiz** | Multiple choice, true/false, fill-in-the-blank — scored in dashboard |
| **Project** | Larger exercises with acceptance criteria and test files |
| **Assignment** | Imported from school PDFs with grading criteria |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `auto_viz` | `true` | Auto-generate visualizations after explanations |
| `dashboard_port` | `19282` | Dashboard HTTP port |

## Architecture

Single Node.js process with layered internals:

```
Transport:  MCP Tools (stdio) + HTTP API (dashboard)
Services:   CurriculumService | QAService | VizService | ExerciseService
Storage:    SQLite (better-sqlite3) + File System (exercises)
```

Data stored at `~/.claude/learn/data.db` — persists across sessions.

## Development

```bash
cd server
npm install
npm test          # run tests (vitest)
npm run bundle    # build dist/bundle.mjs
```

## License

MIT
