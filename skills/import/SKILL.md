---
name: Import Curriculum
description: Activates when user mentions importing PDFs, syllabi, creating new learning subjects, or setting up a curriculum from itslearning or roadmap.sh.
version: 1.0.0
---

When the user wants to import a curriculum or create a new learning subject:

1. **For PDFs**: Read the PDF using the Read tool. Classify the content:
   - **Syllabus/curriculum**: Extract phases and topics, call `learn_create_subject` then `learn_import_curriculum`
   - **Lecture slides**: Attach as notes to relevant topics via `learn_log_answer` with kind='note'
   - **Assignments**: Create exercises via `learn_create_exercise` with type='assignment'
   - If unsure about classification, ask the user to confirm

2. **For manual subjects**: Ask the user for the subject name and language, call `learn_create_subject`, then help them define phases and topics

3. **For roadmap.sh**: The user defines topics manually based on the roadmap. Help them structure it into phases and topics, then import via `learn_import_curriculum`

Always confirm the imported structure with the user before finalizing.
