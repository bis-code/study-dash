export interface Subject {
  id: number;
  name: string;
  slug: string;
  language: string;
  source: 'manual' | 'roadmap' | 'pdf';
  created_at: string;
}

export interface Phase {
  id: number;
  subject_id: number;
  name: string;
  description: string;
  sort_order: number;
}

export interface Topic {
  id: number;
  phase_id: number;
  name: string;
  description: string;
  sort_order: number;
  status: 'todo' | 'in_progress' | 'done';
  updated_at: string;
}

export interface Entry {
  id: number;
  topic_id: number;
  kind: 'question' | 'answer' | 'note';
  content: string;
  session_id: string;
  question_id: number | null;
  created_at: string;
}

export interface Visualization {
  id: number;
  topic_id: number;
  title: string;
  steps_json: string;
  created_at: string;
}

export interface Resource {
  id: number;
  topic_id: number;
  title: string;
  url: string;
  source: 'manual' | 'auto' | 'import';
  created_at: string;
}

export interface VizStep {
  html: string;
  description: string;
}

export interface Exercise {
  id: number;
  topic_id: number;
  title: string;
  type: 'coding' | 'quiz' | 'project' | 'assignment';
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  est_minutes: number;
  source: 'ai' | 'pdf_import';
  starter_code: string;
  test_content: string;
  quiz_json: string;
  file_path: string;
  status: 'pending' | 'in_progress' | 'passed' | 'failed';
  created_at: string;
}

export interface ExerciseResult {
  id: number;
  exercise_id: number;
  test_name: string;
  passed: boolean;
  output: string;
  ran_at: string;
}

export interface QuizQuestion {
  id: number;
  text: string;
  type: 'multiple_choice' | 'true_false' | 'fill_in';
  options?: string[];
  correct: number | boolean | string;
  explanation: string;
}

export interface QuizPayload {
  questions: QuizQuestion[];
}

export interface ProgressStats {
  total_topics: number;
  done: number;
  in_progress: number;
  todo: number;
  total_entries: number;
  total_exercises: number;
  total_viz: number;
}

export interface PhaseWithTopics extends Phase {
  topics: Topic[];
}

export interface TopicWithEntries extends Topic {
  entries: Entry[];
}

export interface SessionState {
  subjectId: number | null;
  topicId: number | null;
}

export interface SSEEvent {
  type: 'connected' | 'update' | 'test_result';
  payload: Record<string, unknown>;
  ts: string;
}
