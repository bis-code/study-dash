// StudyDash — Dashboard Application
// Connects to the learn-cc API and renders a responsive learning dashboard.

// --- Markdown config ---
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// --- State ---
const state = {
  subjects: [],
  activeSubject: null,
  phases: [],
  activeTopic: null,
  activeTab: 'qa',
  topicData: null,
  topicViz: [],
  topicExercises: [],
  topicResources: [],
  searchTimeout: null,
  vizIndex: 0,
  vizStep: 0,
};

// --- API Helper ---
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Sanitize viz HTML ---
function sanitizeVizHtml(html) {
  const allowed = ['div', 'span', 'small', 'br', 'code', 'strong', 'em'];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove all script tags
  tmp.querySelectorAll('script').forEach(el => el.remove());
  // Walk all elements, remove disallowed tags, strip non-class/style attributes
  const walk = (node) => {
    const children = [...node.children];
    for (const child of children) {
      if (!allowed.includes(child.tagName.toLowerCase())) {
        child.replaceWith(...child.childNodes);
      } else {
        [...child.attributes].forEach(attr => {
          if (attr.name !== 'class' && attr.name !== 'style') child.removeAttribute(attr.name);
        });
        walk(child);
      }
    }
  };
  walk(tmp);
  return tmp.innerHTML;
}

// --- Escape HTML for text content in templates ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Format time ---
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return escapeHtml(text);
  return escapeHtml(text.substring(0, max)) + '...';
}

// --- On load ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    state.subjects = await api('/api/subjects');
  } catch {
    state.subjects = [];
  }

  if (state.subjects.length > 0) {
    state.activeSubject = state.subjects[0];
    await loadSubject();
  }

  renderAllSubjectSwitchers();
  renderHome();
  connectSSE();
});

// --- SSE ---
function connectSSE() {
  const dot = document.getElementById('sse-dot');
  let evtSource;

  function connect() {
    evtSource = new EventSource('/api/events');

    evtSource.onopen = () => {
      if (dot) { dot.classList.remove('disconnected'); dot.classList.add('connected'); }
    };

    evtSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          await refresh();
        }
      } catch { /* ignore parse errors */ }
    };

    evtSource.onerror = () => {
      if (dot) { dot.classList.remove('connected'); dot.classList.add('disconnected'); }
      evtSource.close();
      setTimeout(connect, 3000);
    };
  }

  connect();
}

async function refresh() {
  // Re-fetch subjects
  try {
    state.subjects = await api('/api/subjects');
  } catch { /* keep existing */ }

  if (state.activeSubject) {
    // Refresh the active subject from the new list
    const updated = state.subjects.find(s => s.id === state.activeSubject.id);
    if (updated) state.activeSubject = updated;
    await loadSubject();
  }

  renderAllSubjectSwitchers();

  // Re-render current view
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id.replace('page-', '');
    if (pageId === 'home') renderHome();
    else if (pageId === 'topics') renderTopicsPage();
    else if (pageId === 'topic' && state.activeTopic) await selectTopic(state.activeTopic);
  }
}

// --- Subject management ---
async function loadSubject() {
  if (!state.activeSubject) return;
  try {
    state.phases = await api(`/api/subjects/${state.activeSubject.id}/phases`);
  } catch {
    state.phases = [];
  }
  renderSidebar();
}

async function switchSubject(id) {
  const subject = state.subjects.find(s => s.id === id);
  if (!subject) return;
  state.activeSubject = subject;
  state.activeTopic = null;
  state.topicData = null;
  await loadSubject();
  renderAllSubjectSwitchers();
  renderHome();
  renderTopicsPage();
  // If on topic detail page, go back to topics
  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id === 'page-topic') {
    showPage('topics');
  }
}

function renderAllSubjectSwitchers() {
  const containers = ['home-subjects', 'topics-subjects', 'sidebar-subjects'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (state.subjects.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = state.subjects.map(s =>
      `<button class="subject-btn ${state.activeSubject && state.activeSubject.id === s.id ? 'active' : ''}"
              onclick="switchSubject(${s.id})">${escapeHtml(s.name)}</button>`
    ).join('');
  });
}

// --- Progress ---
function renderProgress() {
  if (!state.activeSubject) return;
  const p = state.activeSubject.progress || {};
  const total = p.total_topics || 0;
  const done = p.done || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const text = `${done} / ${total} topics`;

  // Home progress
  const hFill = document.getElementById('home-progress-fill');
  const hText = document.getElementById('home-progress-text');
  if (hFill) hFill.style.width = pct + '%';
  if (hText) hText.textContent = text;

  // Sidebar progress
  const sFill = document.getElementById('sidebar-progress-fill');
  const sText = document.getElementById('sidebar-progress-text');
  if (sFill) sFill.style.width = pct + '%';
  if (sText) sText.textContent = text;
}

// --- Sidebar ---
function renderSidebar() {
  renderProgress();
  const container = document.getElementById('sidebar-phases');
  if (!container) return;

  if (state.phases.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No phases yet</p></div>';
    return;
  }

  container.innerHTML = state.phases.map(phase => {
    const topics = phase.topics || [];
    const doneCount = topics.filter(t => t.status === 'done').length;
    return `
      <div class="phase-group">
        <div class="phase-header" onclick="togglePhase(this)">
          ${escapeHtml(phase.name)}
          <span style="font-size:10px;color:var(--text-muted)">${doneCount}/${topics.length}</span>
          <span class="chevron">&#9660;</span>
        </div>
        <div class="phase-topics">
          ${topics.map(t => `
            <div class="topic-item ${state.activeTopic === t.id ? 'active' : ''}"
                 onclick="selectTopic(${t.id})"
                 data-topic-id="${t.id}">
              <span class="status-dot ${escapeHtml(t.status)}"></span>
              <span>${escapeHtml(t.name)}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

function togglePhase(el) {
  el.classList.toggle('collapsed');
  el.nextElementSibling.classList.toggle('collapsed');
}

// --- Home page ---
function renderHome() {
  renderProgress();

  const statsEl = document.getElementById('home-stats');
  const recentEl = document.getElementById('home-recent');

  if (state.subjects.length === 0) {
    if (statsEl) statsEl.innerHTML = '';
    if (recentEl) recentEl.innerHTML = `
      <div class="empty-state">
        <p>Welcome to StudyDash!</p>
        <p>Start by creating a subject with <code>/learn</code></p>
      </div>`;
    return;
  }

  const p = state.activeSubject ? (state.activeSubject.progress || {}) : {};

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${p.done || 0}</div>
        <div class="stat-label">Topics Done</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${p.total_entries || 0}</div>
        <div class="stat-label">Q&amp;A Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value yellow">${p.total_exercises || 0}</div>
        <div class="stat-label">Exercises</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">${p.total_viz || 0}</div>
        <div class="stat-label">Visualizations</div>
      </div>`;
  }

  // Show recently active topics (in_progress first, then by updated_at)
  if (recentEl) {
    const allTopics = state.phases.flatMap(ph => (ph.topics || []).map(t => ({ ...t, phaseName: ph.name })));
    const active = allTopics
      .filter(t => t.status !== 'todo')
      .sort((a, b) => {
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
        return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
      })
      .slice(0, 5);

    if (active.length === 0) {
      recentEl.innerHTML = `<div class="empty-state"><p>No active topics yet. Import a curriculum with <code>/learn import</code></p></div>`;
    } else {
      recentEl.innerHTML = active.map(t => `
        <div class="exercise-card" style="cursor:pointer" onclick="selectTopic(${t.id})">
          <div class="exercise-header">
            <span class="exercise-title">${escapeHtml(t.name)}</span>
            <span class="badge ${escapeHtml(t.status)}">${escapeHtml(t.status.replace('_', ' '))}</span>
          </div>
          <div class="exercise-desc">${escapeHtml(t.phaseName)}</div>
        </div>
      `).join('');
    }
  }
}

// --- Topics page ---
function renderTopicsPage() {
  const container = document.getElementById('topics-phases');
  if (!container) return;

  if (state.phases.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No topics yet.</p><p>Import a curriculum with <code>/learn import</code></p></div>`;
    return;
  }

  container.innerHTML = state.phases.map(phase => {
    const topics = phase.topics || [];
    return `
      <div class="phase-group">
        <div class="phase-header" onclick="togglePhase(this)">
          ${escapeHtml(phase.name)}
          <span class="chevron">&#9660;</span>
        </div>
        <div class="phase-topics">
          ${topics.map(t => `
            <div class="topic-item ${state.activeTopic === t.id ? 'active' : ''}"
                 onclick="selectTopic(${t.id})">
              <span class="status-dot ${escapeHtml(t.status)}"></span>
              ${escapeHtml(t.name)}
              <span class="topic-count"></span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

// --- Topic selection ---
async function selectTopic(id) {
  state.activeTopic = id;
  state.activeTab = 'qa';

  // Fetch topic detail, viz, exercises, and resources in parallel
  try {
    const [topicData, viz, exercises, resources] = await Promise.all([
      api(`/api/topics/${id}`),
      api(`/api/topics/${id}/viz`).catch(() => []),
      api(`/api/topics/${id}/exercises`).catch(() => []),
      api(`/api/topics/${id}/resources`).catch(() => []),
    ]);

    state.topicData = topicData;
    state.topicViz = viz || [];
    state.topicExercises = exercises || [];
    state.topicResources = resources || [];
  } catch {
    state.topicData = null;
    state.topicViz = [];
    state.topicExercises = [];
    state.topicResources = [];
  }

  // Update sidebar active state
  document.querySelectorAll('.topic-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset?.topicId) === id);
  });

  showPage('topic');
  renderTopicDetail();
  switchTab('qa');
}

function renderTopicDetail() {
  const data = state.topicData;
  if (!data) return;

  document.getElementById('topic-name').textContent = data.name || '';
  const statusEl = document.getElementById('topic-status');
  statusEl.textContent = (data.status || '').replace('_', ' ');
  statusEl.className = `badge ${data.status || ''}`;
  document.getElementById('topic-desc').textContent = data.description || '';
}

// --- Tab switching ---
function switchTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll('#page-topic .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('#page-topic .tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });

  // Render tab content
  if (tab === 'qa') renderQATab();
  else if (tab === 'viz') renderVizTab();
  else if (tab === 'exercises') renderExercisesTab();
  else if (tab === 'resources') renderResourcesTab();
}

// --- Q&A Tab ---
function renderQATab() {
  const container = document.getElementById('tab-qa');
  if (!container) return;

  const entries = state.topicData?.entries || [];

  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No Q&amp;A entries yet</p><p>Ask questions in Claude to see them here</p></div>`;
    return;
  }

  // Group entries into Q&A cards by question_id
  const questionMap = new Map();
  const groups = [];

  entries.forEach(e => {
    if (e.kind === 'question') {
      const group = { question: e, answers: [] };
      questionMap.set(e.id, group);
      groups.push(group);
    } else if (e.question_id && questionMap.has(e.question_id)) {
      questionMap.get(e.question_id).answers.push(e);
    } else {
      groups.push({ standalone: e });
    }
  });

  // marked.parse is used intentionally for markdown rendering (same as go-learn)
  container.innerHTML = groups.map(g => {
    if (g.standalone) {
      const e = g.standalone;
      return `
        <div class="entry-card">
          <div class="entry-header">
            <span class="entry-kind ${escapeHtml(e.kind)}">${escapeHtml(e.kind)}</span>
            <span>${formatTime(e.created_at)}</span>
          </div>
          <div class="entry-body">${marked.parse(e.content || '')}</div>
        </div>`;
    }

    const q = g.question;
    let html = `<div class="qa-card">`;
    html += `
      <div class="qa-question">
        <div class="entry-header">
          <span class="entry-kind question">question</span>
          <span>${formatTime(q.created_at)}</span>
        </div>
        <div class="entry-body">${marked.parse(q.content || '')}</div>
      </div>`;

    g.answers.forEach(a => {
      html += `
        <div class="qa-answer">
          <div class="entry-header">
            <span class="entry-kind ${escapeHtml(a.kind)}">${escapeHtml(a.kind)}</span>
            <span>${formatTime(a.created_at)}</span>
          </div>
          <div class="entry-body">${marked.parse(a.content || '')}</div>
        </div>`;
    });

    html += `</div>`;
    return html;
  }).join('');
}

// --- Visualize Tab ---
function renderVizTab() {
  const container = document.getElementById('tab-viz');
  if (!container) return;

  const vizList = state.topicViz;

  if (!vizList || vizList.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No visualizations yet</p><p>Visualizations will appear here as you learn</p></div>`;
    return;
  }

  // Reset viz state
  state.vizIndex = 0;
  state.vizStep = 0;

  renderVizSelector(container);
}

function renderVizSelector(container) {
  if (!container) container = document.getElementById('tab-viz');
  if (!container) return;

  const vizList = state.topicViz;
  if (!vizList || vizList.length === 0) return;

  let html = `<div class="viz-selector">`;
  vizList.forEach((v, i) => {
    html += `<button class="viz-select-btn ${i === state.vizIndex ? 'active' : ''}" onclick="selectViz(${i})">${escapeHtml(v.title)}</button>`;
  });
  html += `</div>`;
  html += `<div id="viz-stage-container"></div>`;

  container.innerHTML = html;
  renderVizStage();
}

function selectViz(index) {
  state.vizIndex = index;
  state.vizStep = 0;

  // Update selector buttons
  document.querySelectorAll('.viz-select-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  renderVizStage();
}

function renderVizStage() {
  const stageContainer = document.getElementById('viz-stage-container');
  if (!stageContainer) return;

  const viz = state.topicViz[state.vizIndex];
  if (!viz) return;

  let steps;
  try {
    steps = typeof viz.steps_json === 'string' ? JSON.parse(viz.steps_json) : viz.steps_json;
  } catch {
    stageContainer.innerHTML = `<div class="empty-state"><p>Invalid visualization data</p></div>`;
    return;
  }

  if (!steps || steps.length === 0) {
    stageContainer.innerHTML = `<div class="empty-state"><p>No steps in this visualization</p></div>`;
    return;
  }

  const step = steps[state.vizStep] || steps[0];
  const totalSteps = steps.length;

  // sanitizeVizHtml strips dangerous content, allowing only safe tags with class/style
  stageContainer.innerHTML = `
    <div class="viz-stage">
      <div class="viz-canvas">${sanitizeVizHtml(step.html || step.canvas || '')}</div>
      ${step.description || step.desc ? `<div class="viz-description">${sanitizeVizHtml(step.description || step.desc || '')}</div>` : ''}
      <div class="viz-controls">
        <button onclick="vizPrev()" ${state.vizStep === 0 ? 'disabled' : ''}>Prev</button>
        <span class="viz-step-label">Step ${state.vizStep + 1} / ${totalSteps}</span>
        <button onclick="vizNext()" ${state.vizStep >= totalSteps - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;
}

function vizPrev() {
  if (state.vizStep > 0) {
    state.vizStep--;
    renderVizStage();
  }
}

function vizNext() {
  const viz = state.topicViz[state.vizIndex];
  if (!viz) return;
  let steps;
  try {
    steps = typeof viz.steps_json === 'string' ? JSON.parse(viz.steps_json) : viz.steps_json;
  } catch { return; }
  if (state.vizStep < (steps?.length || 1) - 1) {
    state.vizStep++;
    renderVizStage();
  }
}

// --- Exercises Tab ---
function renderExercisesTab() {
  const container = document.getElementById('tab-exercises');
  if (!container) return;

  const exercises = state.topicExercises;

  if (!exercises || exercises.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No exercises yet</p><p>Exercises are generated when you complete topics</p></div>`;
    return;
  }

  container.innerHTML = exercises.map((ex, i) => {
    const results = ex.results || [];
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const hasPassed = total > 0 && passed === total;

    let detailHtml = '';

    // Quiz type
    if (ex.type === 'quiz' && ex.quiz_json) {
      let quiz;
      try {
        quiz = typeof ex.quiz_json === 'string' ? JSON.parse(ex.quiz_json) : ex.quiz_json;
      } catch { quiz = null; }

      if (quiz && Array.isArray(quiz)) {
        detailHtml += `<h4>Questions</h4>`;
        detailHtml += quiz.map((q, qi) => `
          <div class="quiz-question" data-exercise="${i}" data-question="${qi}">
            <p>${marked.parse(q.question || q.text || '')}</p>
            ${(q.options || q.choices || []).map((opt, oi) => `
              <div class="quiz-option" data-exercise="${i}" data-question="${qi}" data-option="${oi}" onclick="selectQuizOption(this)">
                ${escapeHtml(opt)}
              </div>
            `).join('')}
          </div>
        `).join('');
        detailHtml += `
          <div class="exercise-actions">
            <button class="exercise-action-btn btn-primary" onclick="submitQuiz(${ex.id}, ${i})">Submit Answers</button>
          </div>`;
      }
    }

    // Coding type — test cases
    if (ex.type === 'coding' || ex.type === 'project' || ex.type === 'assignment') {
      if (results.length > 0) {
        detailHtml += `<h4>Test Results</h4>`;
        detailHtml += results.map(r => `
          <div class="test-case">
            <div class="test-case-header">
              <span class="test-status ${r.passed ? 'pass' : 'fail'}"></span>
              ${escapeHtml(r.test_name)}
            </div>
            ${r.output ? `<div class="test-case-body">${truncate(r.output, 300)}</div>` : ''}
          </div>
        `).join('');

        detailHtml += `
          <div class="exercise-progress">
            <span>${passed}/${total} tests</span>
            <div class="exercise-progress-bar">
              <div class="exercise-progress-fill ${hasPassed ? 'green' : 'yellow'}" style="width:${total > 0 ? Math.round(passed / total * 100) : 0}%"></div>
            </div>
          </div>`;
      }

      detailHtml += `
        <div class="exercise-actions">
          <button class="exercise-action-btn btn-primary" onclick="runExercise(${ex.id}, ${i})">Run Tests</button>
        </div>`;
    }

    return `
      <div class="exercise-card expandable" id="exercise-${i}">
        <div class="exercise-header" onclick="toggleExercise(${i})">
          <span class="exercise-title">${escapeHtml(ex.title)}</span>
          <span class="exercise-type ${escapeHtml(ex.type)}">${escapeHtml(ex.type)}</span>
          <span class="exercise-expand-icon">&#9660;</span>
        </div>
        <div class="exercise-desc">${escapeHtml(ex.description || '')}</div>
        <div class="exercise-meta">
          ${ex.difficulty ? `<span>Difficulty: ${escapeHtml(ex.difficulty)}</span>` : ''}
          ${ex.est_minutes ? `<span>${ex.est_minutes} min</span>` : ''}
          ${ex.source ? `<span>Source: ${escapeHtml(ex.source)}</span>` : ''}
          ${ex.status ? `<span>Status: ${escapeHtml(ex.status)}</span>` : ''}
        </div>
        <div class="exercise-detail" id="exercise-detail-${i}">
          ${detailHtml}
        </div>
      </div>`;
  }).join('');
}

function toggleExercise(index) {
  const detail = document.getElementById('exercise-detail-' + index);
  const card = detail ? detail.closest('.exercise-card') : null;
  if (detail) detail.classList.toggle('open');
  if (card) card.classList.toggle('open');
}

function selectQuizOption(el) {
  const questionEl = el.closest('.quiz-question');
  if (questionEl) {
    questionEl.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
  }
  el.classList.add('selected');
}

async function submitQuiz(exerciseId, cardIndex) {
  const card = document.getElementById(`exercise-${cardIndex}`);
  if (!card) return;

  const answers = [];
  card.querySelectorAll('.quiz-question').forEach(q => {
    const selected = q.querySelector('.quiz-option.selected');
    if (selected) {
      answers.push(parseInt(selected.dataset.option));
    } else {
      answers.push(-1);
    }
  });

  try {
    const result = await fetch(`/api/exercises/${exerciseId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const data = await result.json();

    if (data.results) {
      data.results.forEach((r, i) => {
        const questionEl = card.querySelectorAll('.quiz-question')[i];
        if (!questionEl) return;
        questionEl.querySelectorAll('.quiz-option').forEach((opt, oi) => {
          opt.classList.remove('selected');
          if (oi === r.correct_index) opt.classList.add('correct');
          else if (oi === answers[i] && !r.passed) opt.classList.add('incorrect');
        });
      });
    }

    if (data.score !== undefined) {
      const actionsEl = card.querySelector('.exercise-actions');
      if (actionsEl) {
        const scoreDiv = document.createElement('div');
        scoreDiv.style.cssText = `margin-top:8px;font-size:14px;font-weight:600;color:${data.passed ? 'var(--green)' : 'var(--yellow)'}`;
        scoreDiv.textContent = `Score: ${data.score}/${data.total}${data.passed ? ' - Passed!' : ''}`;
        actionsEl.appendChild(scoreDiv);
      }
    }
  } catch (err) {
    console.error('Submit quiz error:', err);
  }
}

async function runExercise(exerciseId, cardIndex) {
  const btn = document.querySelector(`#exercise-${cardIndex} .btn-primary`);
  if (btn) { btn.textContent = 'Running...'; btn.disabled = true; }

  try {
    const res = await fetch(`/api/exercises/${exerciseId}/run`, { method: 'POST' });
    const data = await res.json();

    if (data.results && state.topicExercises[cardIndex]) {
      state.topicExercises[cardIndex].results = data.results;
    }

    renderExercisesTab();

    // Re-open the card
    const detail = document.getElementById(`exercise-detail-${cardIndex}`);
    if (detail) detail.classList.add('open');
  } catch (err) {
    console.error('Run exercise error:', err);
    if (btn) { btn.textContent = 'Run Tests'; btn.disabled = false; }
  }
}

// --- Resources Tab ---
function renderResourcesTab() {
  const container = document.getElementById('tab-resources');
  if (!container) return;

  const resources = state.topicResources || [];

  if (resources.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No resources yet</p><p class="text-muted">Ask Claude to add reference links for this topic</p></div>';
    return;
  }

  let html = '<div class="resources-list">';
  for (const r of resources) {
    html += '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener" class="resource-card">' +
      '<span class="resource-title">' + escapeHtml(r.title) + '</span>' +
      '<span class="resource-url">' + escapeHtml(r.url) + '</span>' +
      '</a>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// --- Navigation ---
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'home') renderHome();
  else if (page === 'topics') renderTopicsPage();
  else if (page === 'search') document.getElementById('search-input')?.focus();
}

// --- Search ---
const searchInput = document.getElementById('search-input');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => doSearch(e.target.value, 'search-results'), 200);
  });
}

const modalSearchInput = document.getElementById('modal-search-input');
if (modalSearchInput) {
  modalSearchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => doSearch(e.target.value, 'modal-search-results'), 200);
  });
}

async function doSearch(query, resultsContainerId) {
  const container = document.getElementById(resultsContainerId);
  if (!container) return;

  if (!query || !query.trim()) {
    container.innerHTML = '';
    return;
  }

  try {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);

    if (!results || results.length === 0) {
      container.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    container.innerHTML = results.map(r => `
      <div class="search-result-item" onclick="closeSearchModal(); selectTopic(${r.topic_id})">
        <div class="search-result-meta">
          <span class="entry-kind ${escapeHtml(r.kind)}">${escapeHtml(r.kind)}</span>
        </div>
        <div class="search-result-content">${truncate(r.content, 150)}</div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="search-no-results">Search failed</div>';
  }
}

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const input = document.getElementById('modal-search-input');
    if (input) { input.value = ''; input.focus(); }
    const results = document.getElementById('modal-search-results');
    if (results) results.innerHTML = '';
  }
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) modal.classList.add('hidden');
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openSearchModal();
  }
  if (e.key === 'Escape') {
    closeSearchModal();
  }
});
