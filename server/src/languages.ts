export interface LanguageConfig {
  id: string;
  name: string;
  extension: string;
  mainFile: string;
  testFile: string;
  testCommand: string;
  testArgs: string[];
  scaffoldFiles?: (subjectSlug: string, exerciseSlug: string) => Record<string, string>;
}

const registry = new Map<string, LanguageConfig>();

registry.set('go', {
  id: 'go',
  name: 'Go',
  extension: '.go',
  mainFile: 'main.go',
  testFile: 'main_test.go',
  testCommand: 'go',
  testArgs: ['test', '-json', '-count=1', './...'],
  scaffoldFiles: (subjectSlug: string, exerciseSlug: string) => ({
    'go.mod': `module exercises/${subjectSlug}/${exerciseSlug}\n\ngo 1.21\n`,
  }),
});

registry.set('python', {
  id: 'python',
  name: 'Python',
  extension: '.py',
  mainFile: 'main.py',
  testFile: 'test_main.py',
  testCommand: 'python3',
  testArgs: ['-m', 'pytest', '--tb=short', '-q', '.'],
});

registry.set('rust', {
  id: 'rust',
  name: 'Rust',
  extension: '.rs',
  mainFile: 'main.rs',
  testFile: 'main_test.rs',
  testCommand: 'cargo',
  testArgs: ['test'],
  scaffoldFiles: (_subjectSlug: string, exerciseSlug: string) => ({
    'Cargo.toml': `[package]\nname = "${exerciseSlug}"\nversion = "0.1.0"\nedition = "2021"\n`,
  }),
});

const tsScaffold = (_subjectSlug: string, _exerciseSlug: string): Record<string, string> => ({
  'package.json': `{"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^2.0.0"}}`,
});

registry.set('typescript', {
  id: 'typescript',
  name: 'TypeScript',
  extension: '.ts',
  mainFile: 'main.ts',
  testFile: 'main.test.ts',
  testCommand: 'npx',
  testArgs: ['vitest', 'run'],
  scaffoldFiles: tsScaffold,
});

registry.set('javascript', {
  id: 'javascript',
  name: 'JavaScript',
  extension: '.ts',
  mainFile: 'main.ts',
  testFile: 'main.test.ts',
  testCommand: 'npx',
  testArgs: ['vitest', 'run'],
  scaffoldFiles: tsScaffold,
});

export function getLanguageConfig(language: string): LanguageConfig | undefined {
  if (!language) return undefined;
  return registry.get(language.toLowerCase());
}

export function getExtension(language: string): string {
  return getLanguageConfig(language)?.extension ?? '.txt';
}

export function getTestCommand(language: string): { command: string; args: string[] } | undefined {
  const config = getLanguageConfig(language);
  if (!config) return undefined;
  return { command: config.testCommand, args: config.testArgs };
}

export function getScaffoldFiles(
  language: string,
  subjectSlug: string,
  exerciseSlug: string,
): Record<string, string> {
  const config = getLanguageConfig(language);
  if (!config?.scaffoldFiles) return {};
  return config.scaffoldFiles(subjectSlug, exerciseSlug);
}

export function getFileNames(language: string): { mainFile: string; testFile: string } {
  const config = getLanguageConfig(language);
  return {
    mainFile: config?.mainFile ?? 'main.txt',
    testFile: config?.testFile ?? 'main_test.txt',
  };
}

export function isLanguageSupported(language: string): boolean {
  return getLanguageConfig(language) !== undefined;
}

export const SUPPORTED_LANGUAGES: string[] = Array.from(registry.keys());
