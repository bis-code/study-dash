#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Database } from './storage/db.js';
import { FileStore } from './storage/files.js';
import { CurriculumService } from './services/curriculum.js';
import { QAService } from './services/qa.js';
import { VizService } from './services/viz.js';
import { ExerciseService } from './services/exercises.js';
import { registerCurriculumTools } from './tools/curriculum.js';
import { registerQATools } from './tools/qa.js';
import { registerVizTools } from './tools/viz.js';
import { registerExerciseTools } from './tools/exercises.js';
import { DashboardServer } from './dashboard/server.js';
import type { SessionState } from './types.js';

const fileStore = new FileStore();
const db = new Database(fileStore.dbPath);
const sessions = new Map<string, SessionState>();

const curriculumSvc = new CurriculumService(db);
const qaSvc = new QAService(db);
const vizSvc = new VizService(db);
const exerciseSvc = new ExerciseService(db, fileStore);

const port = Number(db.getSetting('dashboard_port') ?? '19282');
const dashboard = new DashboardServer(curriculumSvc, qaSvc, vizSvc, exerciseSvc, port);
const notify = () => dashboard.notify();

const server = new McpServer({ name: 'study-dash', version: '0.1.0' });

registerCurriculumTools(server, curriculumSvc, sessions, notify);
registerQATools(server, qaSvc, sessions, notify);
registerVizTools(server, vizSvc, sessions, notify);
registerExerciseTools(server, exerciseSvc, sessions, notify);

dashboard.start();

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`study-dash MCP server running, dashboard at http://127.0.0.1:${port}`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
