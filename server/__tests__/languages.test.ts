import { describe, it, expect } from 'vitest';
import {
  getLanguageConfig,
  getExtension,
  getTestCommand,
  getFileNames,
  getScaffoldFiles,
  isLanguageSupported,
  SUPPORTED_LANGUAGES,
} from '../src/languages.js';

describe('getLanguageConfig', () => {
  it('returns config for a known language', () => {
    const config = getLanguageConfig('go');
    expect(config).toBeDefined();
    expect(config?.id).toBe('go');
    expect(config?.name).toBe('Go');
  });

  it('is case-insensitive: Go', () => {
    expect(getLanguageConfig('Go')?.id).toBe('go');
  });

  it('is case-insensitive: GO', () => {
    expect(getLanguageConfig('GO')?.id).toBe('go');
  });

  it('is case-insensitive: go', () => {
    expect(getLanguageConfig('go')?.id).toBe('go');
  });

  it('returns undefined for unknown language', () => {
    expect(getLanguageConfig('cobol')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getLanguageConfig('')).toBeUndefined();
  });
});

describe('getExtension', () => {
  it('returns .go for go', () => {
    expect(getExtension('go')).toBe('.go');
  });

  it('returns .py for python', () => {
    expect(getExtension('python')).toBe('.py');
  });

  it('returns .rs for rust', () => {
    expect(getExtension('rust')).toBe('.rs');
  });

  it('returns .ts for typescript', () => {
    expect(getExtension('typescript')).toBe('.ts');
  });

  it('returns .ts for javascript', () => {
    expect(getExtension('javascript')).toBe('.ts');
  });

  it('returns .txt for unknown language', () => {
    expect(getExtension('brainfuck')).toBe('.txt');
  });

  it('returns .txt for empty string', () => {
    expect(getExtension('')).toBe('.txt');
  });
});

describe('getTestCommand', () => {
  it('returns command and args for go', () => {
    const result = getTestCommand('go');
    expect(result).toEqual({ command: 'go', args: ['test', '-json', '-count=1', './...'] });
  });

  it('returns command and args for python', () => {
    const result = getTestCommand('python');
    expect(result).toEqual({ command: 'python3', args: ['-m', 'pytest', '--tb=short', '-q', '.'] });
  });

  it('returns command and args for rust', () => {
    const result = getTestCommand('rust');
    expect(result).toEqual({ command: 'cargo', args: ['test'] });
  });

  it('returns command and args for typescript', () => {
    const result = getTestCommand('typescript');
    expect(result).toEqual({ command: 'npx', args: ['vitest', 'run'] });
  });

  it('returns undefined for unknown language', () => {
    expect(getTestCommand('unknown')).toBeUndefined();
  });
});

describe('getFileNames', () => {
  it('returns go file names', () => {
    expect(getFileNames('go')).toEqual({ mainFile: 'main.go', testFile: 'main_test.go' });
  });

  it("returns python's test_main.py as testFile", () => {
    expect(getFileNames('python')).toEqual({ mainFile: 'main.py', testFile: 'test_main.py' });
  });

  it('returns rust file names', () => {
    expect(getFileNames('rust')).toEqual({ mainFile: 'main.rs', testFile: 'main_test.rs' });
  });

  it('returns typescript file names', () => {
    expect(getFileNames('typescript')).toEqual({ mainFile: 'main.ts', testFile: 'main.test.ts' });
  });

  it('returns .txt fallback for unknown language', () => {
    expect(getFileNames('unknown')).toEqual({ mainFile: 'main.txt', testFile: 'main_test.txt' });
  });
});

describe('getScaffoldFiles', () => {
  it('returns go.mod for go', () => {
    const files = getScaffoldFiles('go', 'algorithms', 'two-sum');
    expect(files).toHaveProperty('go.mod');
    expect(files['go.mod']).toContain('module exercises/algorithms/two-sum');
    expect(files['go.mod']).toContain('go 1.21');
  });

  it('interpolates slugs correctly in go.mod', () => {
    const files = getScaffoldFiles('go', 'data-structures', 'linked-list');
    expect(files['go.mod']).toContain('module exercises/data-structures/linked-list');
  });

  it('returns Cargo.toml for rust', () => {
    const files = getScaffoldFiles('rust', 'algorithms', 'fizzbuzz');
    expect(files).toHaveProperty('Cargo.toml');
    expect(files['Cargo.toml']).toContain('name = "fizzbuzz"');
    expect(files['Cargo.toml']).toContain('edition = "2021"');
  });

  it('returns package.json for typescript', () => {
    const files = getScaffoldFiles('typescript', 'algorithms', 'two-sum');
    expect(files).toHaveProperty('package.json');
    expect(files['package.json']).toContain('vitest');
  });

  it('returns package.json for javascript', () => {
    const files = getScaffoldFiles('javascript', 'algorithms', 'two-sum');
    expect(files).toHaveProperty('package.json');
  });

  it('returns empty object for python (no scaffold files)', () => {
    expect(getScaffoldFiles('python', 'algorithms', 'two-sum')).toEqual({});
  });

  it('returns empty object for unknown language', () => {
    expect(getScaffoldFiles('unknown', 'subject', 'exercise')).toEqual({});
  });
});

describe('isLanguageSupported', () => {
  it('returns true for go', () => expect(isLanguageSupported('go')).toBe(true));
  it('returns true for python', () => expect(isLanguageSupported('python')).toBe(true));
  it('returns true for rust', () => expect(isLanguageSupported('rust')).toBe(true));
  it('returns true for typescript', () => expect(isLanguageSupported('typescript')).toBe(true));
  it('returns true for javascript', () => expect(isLanguageSupported('javascript')).toBe(true));
  it('returns false for unknown language', () => expect(isLanguageSupported('cobol')).toBe(false));
  it('returns false for empty string', () => expect(isLanguageSupported('')).toBe(false));
});

describe('SUPPORTED_LANGUAGES', () => {
  it('lists all 5 supported languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(5);
  });

  it('includes go, python, rust, typescript, javascript', () => {
    expect(SUPPORTED_LANGUAGES).toContain('go');
    expect(SUPPORTED_LANGUAGES).toContain('python');
    expect(SUPPORTED_LANGUAGES).toContain('rust');
    expect(SUPPORTED_LANGUAGES).toContain('typescript');
    expect(SUPPORTED_LANGUAGES).toContain('javascript');
  });
});
