---
name: learn
description: Start or manage a learning session — show active subject/topic, list subjects, switch between them
---

Check the current learning state with `learn_get_progress`.

If a subject is active, show:
- Current subject and topic
- Progress (X/Y topics done)
- Dashboard URL: http://127.0.0.1:19282

If no subject is active, list available subjects and ask which to work on. If no subjects exist, suggest creating one or importing a curriculum.
