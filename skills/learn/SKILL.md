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
