---
name: Learning Session
description: Activates when user asks questions about a subject they're studying. Auto-logs Q&A, manages topic progression, suggests visualizations and exercises.
version: 1.0.0
---

When the user is in a learning session (asking questions about a subject they're studying), follow these rules:

1. Check if there's an active subject and topic via `learn_get_progress`. If not, help the user set one up.
2. For every question the user asks about the subject:
   - Call `learn_log_question` with the question text (markdown)
   - Provide a thorough answer with examples
   - Call `learn_log_answer` with a summary of the answer, passing the `question_id` to pair them
3. When the user finishes a topic, call `learn_mark_done`
4. Suggest the next topic when one is completed

Use the learn_* MCP tools for all operations. Never ask the user to manually track their progress.

## Exercise Creation Rules

When creating coding or project exercises via `learn_create_exercise`, these rules are mandatory:

1. **Always provide `test_content`** with real, runnable tests. Never use comments, placeholders, or TODOs in place of tests. `test_content` is optional in the tool schema for quiz-type exercises only — coding and project exercises without tests are incomplete.

2. **Minimum 3 test cases per exercise:**
   - Happy path (typical valid input)
   - Edge case (empty, nil, zero, or null input)
   - Boundary case (limits, single element, max values, etc.)

3. **Use idiomatic test patterns per language:**
   - Go: table-driven `t.Run()` subtests with a `tests` slice of structs
   - Python: `pytest.mark.parametrize` or individual `test_*` functions
   - Rust: `#[cfg(test)]` module with `#[test]` functions and `assert_eq!`

4. **`starter_code` must compile but return zero values** (e.g., `return 0`, `return ""`, `return nil`), so tests fail in a meaningful way until the user implements the solution. Never leave stubs as syntax errors or empty bodies in languages that require return values.

5. **Test names must be descriptive** — they appear in the dashboard test results UI. Prefer names like `"empty input returns zero"` over `"test1"` or `"case2"`.
