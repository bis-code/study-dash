import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class FileStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.claude', 'learn');
    mkdirSync(join(this.baseDir, 'exercises'), { recursive: true });
  }

  get exercisesDir(): string {
    return join(this.baseDir, 'exercises');
  }

  get dataDir(): string {
    return this.baseDir;
  }

  get dbPath(): string {
    return join(this.baseDir, 'data.db');
  }

  writeExerciseFiles(subjectSlug: string, exerciseSlug: string, files: Record<string, string>): string {
    const dir = join(this.exercisesDir, subjectSlug, exerciseSlug);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf-8');
    }
    return dir;
  }

  exerciseExists(subjectSlug: string, exerciseSlug: string): boolean {
    return existsSync(join(this.exercisesDir, subjectSlug, exerciseSlug));
  }

  readFile(path: string): string {
    return readFileSync(path, 'utf-8');
  }
}
