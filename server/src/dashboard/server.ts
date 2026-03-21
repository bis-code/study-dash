import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CurriculumService } from '../services/curriculum.js';
import type { QAService } from '../services/qa.js';
import type { VizService } from '../services/viz.js';
import type { ExerciseService } from '../services/exercises.js';
import {
  handleSubjects,
  handlePhases,
  handleTopic,
  handleTopicViz,
  handleTopicExercises,
  handleRunTests,
  handleSubmitQuiz,
  handleSearch,
  writeJSON,
} from './api.js';

// ── Embedded static content ──
// At runtime (tsc output), read from disk.
// In bundle mode, esbuild --loader:.html=text replaces these with inlined strings.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const staticDir = join(__dirname, 'static');

function loadStatic(name: string): string {
  try {
    return readFileSync(join(staticDir, name), 'utf-8');
  } catch {
    return '';
  }
}

const indexHtml = loadStatic('index.html');
const appJs = loadStatic('app.js');
const stylesCss = loadStatic('styles.css');

const STATIC_FILES: Record<string, { content: string; contentType: string }> = {
  '/': { content: indexHtml, contentType: 'text/html; charset=utf-8' },
  '/index.html': { content: indexHtml, contentType: 'text/html; charset=utf-8' },
  '/app.js': { content: appJs, contentType: 'application/javascript; charset=utf-8' },
  '/styles.css': { content: stylesCss, contentType: 'text/css; charset=utf-8' },
};

export class DashboardServer {
  private sseClients = new Set<http.ServerResponse>();
  private httpServer: http.Server | null = null;

  constructor(
    private curriculumSvc: CurriculumService,
    private qaSvc: QAService,
    private vizSvc: VizService,
    private exerciseSvc: ExerciseService,
    private port: number,
  ) {}

  start(): void {
    this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
    this.httpServer.listen(this.port, '127.0.0.1', () => {
      console.error(`Dashboard running at http://127.0.0.1:${this.port}`);
    });
  }

  stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  notify(): void {
    const data = JSON.stringify({ type: 'update', ts: new Date().toISOString() });
    const message = `data: ${data}\n\n`;
    for (const client of this.sseClients) {
      client.write(message);
    }
  }

  // ── Request routing ────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CSRF check for POST requests
    if (method === 'POST') {
      const origin = req.headers.origin ?? '';
      if (origin && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: invalid origin' }));
        return;
      }
    }

    // SSE endpoint
    if (url === '/api/events' && method === 'GET') {
      this.handleSSE(req, res);
      return;
    }

    // API routes
    if (url.startsWith('/api/')) {
      this.routeAPI(method, url, req, res);
      return;
    }

    // Static files
    this.serveStatic(url, res);
  }

  // ── SSE ────────────────────────────────────────────────────────────────

  private handleSSE(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connected event
    const connected = JSON.stringify({ type: 'connected', ts: new Date().toISOString() });
    res.write(`data: ${connected}\n\n`);

    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  // ── API router ─────────────────────────────────────────────────────────

  private routeAPI(method: string, url: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    // Strip query string for pattern matching
    const path = url.split('?')[0];

    // GET /api/subjects
    if (method === 'GET' && path === '/api/subjects') {
      handleSubjects(this.curriculumSvc)(req, res);
      return;
    }

    // GET /api/subjects/:id/phases
    if (method === 'GET' && /^\/api\/subjects\/\d+\/phases$/.test(path)) {
      handlePhases(this.curriculumSvc)(req, res);
      return;
    }

    // GET /api/topics/:id/viz
    if (method === 'GET' && /^\/api\/topics\/\d+\/viz$/.test(path)) {
      handleTopicViz(this.vizSvc)(req, res);
      return;
    }

    // GET /api/topics/:id/exercises
    if (method === 'GET' && /^\/api\/topics\/\d+\/exercises$/.test(path)) {
      handleTopicExercises(this.exerciseSvc)(req, res);
      return;
    }

    // GET /api/topics/:id
    if (method === 'GET' && /^\/api\/topics\/\d+$/.test(path)) {
      handleTopic(this.curriculumSvc, this.qaSvc)(req, res);
      return;
    }

    // POST /api/exercises/:id/run
    if (method === 'POST' && /^\/api\/exercises\/\d+\/run$/.test(path)) {
      handleRunTests(this.exerciseSvc)(req, res);
      return;
    }

    // POST /api/exercises/:id/submit
    if (method === 'POST' && /^\/api\/exercises\/\d+\/submit$/.test(path)) {
      handleSubmitQuiz(this.exerciseSvc)(req, res);
      return;
    }

    // GET /api/search?q=...
    if (method === 'GET' && path === '/api/search') {
      handleSearch(this.qaSvc)(req, res);
      return;
    }

    // 404 for unknown API routes
    writeJSON(res, { error: 'Not found' }, 404);
  }

  // ── Static file serving ────────────────────────────────────────────────

  private serveStatic(url: string, res: http.ServerResponse): void {
    const file = STATIC_FILES[url];
    if (file) {
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.content);
      return;
    }

    // Fallback: serve index.html for SPA routing
    const index = STATIC_FILES['/'];
    if (index) {
      res.writeHead(200, { 'Content-Type': index.contentType });
      res.end(index.content);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}
