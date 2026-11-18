'use strict';

// ---------- Constants ----------
const STORAGE_KEY = 'birthday-battle-v1';
const MIN_KIDS = 2;
const MAX_KIDS = 20;
const DEFAULT_KIDS = 4;
const AVATARS = [
  '🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🐵', '🦊', '🐶', '🐱',
  '🐰', '🦄', '🐲', '🦖', '🐙', '🦈', '🐬', '🦋', '🐝', '🐞',
  '🦉', '🐧', '🦜', '🐢', '🚀', '⚽', '🏀', '🎸', '🎨', '👑',
  '🌈', '⭐', '🍕', '🍩', '🧁', '🍉', '🤖', '👻', '🦸', '🧙',
];
const GAME_IDEAS = [
  'Musical Chairs', 'Sack Race', 'Treasure Hunt', 'Pin the Tail',
  'Egg & Spoon', 'Freeze Dance', 'Limbo', 'Balloon Pop',
];
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

const app = document.getElementById('app');
const nav = document.getElementById('nav');

// ---------- State ----------
// kids:    [{ id, name, avatar }]
// games:   [{ id, name, participants: [kidId], results: { kidId: points }, medals: { kidId: place }, playedAt }]
// current: the game in progress (same shape as a game, minus id/playedAt) or null
// points:  points awarded for 1st / 2nd / 3rd place
let state = loadState();
let draft = null; // new-game form: { name, participants: [kidId] }

function defaultState() {
  return { kids: [], games: [], current: null, points: { 1: 3, 2: 2, 3: 1 } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const base = defaultState();
      return { ...base, ...saved, points: { ...base.points, ...(saved.points || {}) } };
    }
  } catch (e) {
    // Corrupt or unavailable storage: start fresh.
  }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Storage unavailable (e.g. private mode): the app still works for this session.
  }
}

// ---------- Helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const kidById = (id) => state.kids.find((k) => k.id === id);
const isReady = () => state.kids.length >= MIN_KIDS && state.kids.every((k) => k.name.trim());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function freeAvatar() {
  const taken = new Set(state.kids.map((k) => k.avatar));
  return AVATARS.find((a) => !taken.has(a)) || AVATARS[0];
}

function addKid() {
  state.kids.push({ id: uid(), name: '', avatar: freeAvatar() });
}

function kidHasPoints(id) {
  return state.games.some((g) => (g.results[id] || 0) !== 0)
    || Boolean(state.current && state.current.results[id]);
}

function totals() {
  const t = Object.fromEntries(state.kids.map((k) => [k.id, 0]));
  for (const g of state.games) {
    for (const [id, pts] of Object.entries(g.results)) {
      if (id in t) t[id] += pts;
    }
  }
  return t;
}

// Returns [{ kid, points, rank }] sorted by points; tied kids share a rank.
function ranked(scores, ids) {
  const list = ids
    .map((id) => ({ kid: kidById(id), points: scores[id] || 0 }))
    .filter((r) => r.kid);
  list.sort((a, b) => b.points - a.points || a.kid.name.localeCompare(b.kid.name));
  let rank = 0;
  list.forEach((r, i) => {
    if (i === 0 || r.points !== list[i - 1].points) rank = i + 1;
    r.rank = rank;
  });
  return list;
}

// ---------- Routing ----------
function currentRoute() {
  return location.hash.replace(/^#\/?/, '').split('/')[0];
}

function go(route) {
  if (currentRoute() === route) render();
  else location.hash = '#/' + route;
}

window.addEventListener('hashchange', render);

function render() {
  let route = currentRoute();
  const ready = isReady();
  if (!['setup', 'scores', 'game'].includes(route)) route = ready ? 'scores' : 'setup';
  if (!ready) route = 'setup';
  if (currentRoute() !== route) history.replaceState(null, '', '#/' + route);

  renderNav(route, ready);
  if (route === 'setup') renderSetup();
  else if (route === 'scores') renderScores();
  else renderGame();
  window.scrollTo(0, 0);
}

function renderNav(route, ready) {
  const link = (r, label) => {
    const cls = ['nav-link', r === route ? 'active' : '', !ready && r !== 'setup' ? 'disabled' : '']
      .filter(Boolean).join(' ');
    return `<a class="${cls}" href="#/${r}">${label}</a>`;
  };
  const gameLabel = state.current ? 'Game 🔴' : 'Game';
  nav.innerHTML = link('setup', 'Players') + link('scores', 'Scores') + link('game', gameLabel);
}

// ---------- Setup screen ----------
function renderSetup() {
  if (state.kids.length === 0) {
    for (let i = 0; i < DEFAULT_KIDS; i++) addKid();
    saveState();
  }
  const n = state.kids.length;
  const started = state.games.length > 0 || state.current;

  app.innerHTML = `
    <section class="screen">
      <h1>Who's playing?</h1>
      <div class="card count-card">
        <span class="count-label">Number of kids</span>
        <div class="stepper">
          <button class="round-btn" data-action="count-dec" ${n <= MIN_KIDS ? 'disabled' : ''} aria-label="One less kid">−</button>
          <span class="count-num">${n}</span>
          <button class="round-btn" data-action="count-inc" ${n >= MAX_KIDS ? 'disabled' : ''} aria-label="One more kid">+</button>
        </div>
      </div>

      <ol class="kid-list">
        ${state.kids.map((k, i) => `
          <li class="card kid-row">
            <button class="avatar-btn" data-action="pick-avatar" data-id="${k.id}" title="Choose an avatar" aria-label="Choose avatar for kid ${i + 1}">${k.avatar}</button>
            <input class="name-input" data-id="${k.id}" type="text" maxlength="20"
              placeholder="Kid ${i + 1}'s name" value="${esc(k.name)}" autocomplete="off">
          </li>`).join('')}
      </ol>

      <details class="card settings">
        <summary>Points per place</summary>
        <div class="settings-grid">
          ${[1, 2, 3].map((p) => `
            <label>${MEDALS[p]} ${['1st', '2nd', '3rd'][p - 1]}
              <input class="points-input" data-place="${p}" type="number" min="0" max="99" value="${state.points[p]}">
            </label>`).join('')}
        </div>
      </details>

      <p class="form-error" id="setup-error" hidden></p>

      <div class="actions">
        <button class="btn primary big" data-action="setup-done">${started ? 'Save &amp; show scores' : "Let's party! 🎉"}</button>
        ${started ? '<button class="btn danger" data-action="reset">Start a new party</button>' : ''}
      </div>
    </section>`;
}

function openAvatarPicker(kidId) {
  const kid = kidById(kidId);
  if (!kid) return;
  const takenByOthers = new Set(state.kids.filter((k) => k.id !== kidId).map((k) => k.avatar));

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Choose an avatar">
      <h2>Pick an avatar${kid.name.trim() ? ` for ${esc(kid.name.trim())}` : ''}</h2>
      <div class="avatar-grid">
        ${AVATARS.map((a) => `
          <button class="avatar-choice ${a === kid.avatar ? 'selected' : ''}" data-avatar="${a}"
            ${takenByOthers.has(a) ? 'disabled title="Already taken"' : ''}>${a}</button>`).join('')}
      </div>
      <button class="btn" data-close>Close</button>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-avatar]');
    if (choice && !choice.disabled) {
      kid.avatar = choice.dataset.avatar;
      saveState();
      close();
      renderSetup();
    } else if (e.target === overlay || e.target.closest('[data-close]')) {
      close();
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('.avatar-choice.selected, .avatar-choice:not([disabled])')?.focus();
}

function finishSetup() {
  const errorEl = document.getElementById('setup-error');
  const empty = state.kids.filter((k) => !k.name.trim());
  document.querySelectorAll('.name-input').forEach((input) => {
    input.classList.toggle('invalid', empty.some((k) => k.id === input.dataset.id));
  });
  if (empty.length) {
    errorEl.textContent = `Please enter a name for ${plural(empty.length, 'kid')}.`;
    errorEl.hidden = false;
    document.querySelector('.name-input.invalid')?.focus();
    return;
  }
  state.kids.forEach((k) => { k.name = k.name.trim(); });
  saveState();
  go('scores');
}

// ---------- Score screen ----------
function renderScores() {
  const scores = totals();
  const board = ranked(scores, state.kids.map((k) => k.id));
  const max = Math.max(1, ...board.map((r) => r.points));
  const history = [...state.games].reverse();

  app.innerHTML = `
    <section class="screen">
      <h1>Scoreboard</h1>
      <ol class="board">
        ${board.map((r) => `
          <li class="card board-row ${r.points > 0 && r.rank <= 3 ? 'rank-' + r.rank : ''}">
            <span class="rank">${r.points > 0 && MEDALS[r.rank] ? MEDALS[r.rank] : '#' + r.rank}</span>
            <span class="board-avatar">${r.kid.avatar}</span>
            <div class="board-main">
              <span class="board-name">${esc(r.kid.name)}</span>
              <div class="bar"><div class="bar-fill" style="width:${(r.points / max) * 100}%"></div></div>
            </div>
            <span class="board-points">${r.points}<small>pts</small></span>
          </li>`).join('')}
      </ol>

      <div class="actions">
        <button class="btn primary big" data-action="go-game">
          ${state.current ? `Back to ${esc(state.current.name)} ▶` : 'Start a game 🎲'}
        </button>
      </div>

      <h2>Games played <span class="muted">(${state.games.length})</span></h2>
      ${history.length ? `
        <ul class="history">
          ${history.map((g) => {
            const podium = ranked(g.results, g.participants).filter((r) => r.points > 0).slice(0, 3);
            return `
              <li class="card history-row">
                <div>
                  <div class="history-name">${esc(g.name)}</div>
                  <div class="muted small">
                    ${plural(g.participants.length, 'player')}
                    ${podium.length ? ' · ' + podium.map((r) => `${MEDALS[r.rank] || ''} ${esc(r.kid.name)} +${r.points}`).join(' · ') : ''}
                  </div>
                </div>
                <button class="icon-btn" data-action="delete-game" data-id="${g.id}" title="Delete this game" aria-label="Delete ${esc(g.name)}">🗑️</button>
              </li>`;
          }).join('')}
        </ul>` : '<p class="muted">No games yet. Start one!</p>'}
    </section>`;
}

// ---------- Game screen ----------
function renderGame() {
  if (state.current) renderGameInProgress();
  else renderNewGame();
}

function renderNewGame() {
  if (!draft) draft = { name: '', participants: state.kids.map((k) => k.id) };
  draft.participants = draft.participants.filter((id) => kidById(id));
  const playedNames = new Set(state.games.map((g) => g.name.toLowerCase()));

  app.innerHTML = `
    <section class="screen">
      <h1>New game</h1>
      <div class="card">
        <label class="field-label" for="game-name">Game name</label>
        <input id="game-name" class="text-input" type="text" maxlength="40"
          placeholder="Game ${state.games.length + 1}" value="${esc(draft.name)}" autocomplete="off">
        <div class="chips ideas">
          ${GAME_IDEAS.map((idea) => `
            <button class="chip ${playedNames.has(idea.toLowerCase()) ? 'used' : ''}" data-action="idea" data-name="${esc(idea)}">${esc(idea)}</button>`).join('')}
        </div>
      </div>

      <div class="section-head">
        <h2>Who's playing? <span class="muted">(${draft.participants.length})</span></h2>
        <div>
          <button class="btn small-btn" data-action="select-all">All</button>
          <button class="btn small-btn" data-action="select-none">None</button>
        </div>
      </div>
      <div class="player-picker">
        ${state.kids.map((k) => `
          <button class="player-toggle ${draft.participants.includes(k.id) ? 'on' : ''}" data-action="toggle-player" data-id="${k.id}"
            aria-pressed="${draft.participants.includes(k.id)}">
            <span class="toggle-avatar">${k.avatar}</span>
            <span>${esc(k.name)}</span>
          </button>`).join('')}
      </div>

      <p class="form-error" id="game-error" hidden></p>

      <div class="actions">
        <button class="btn primary big" data-action="start-game">Start game ▶</button>
      </div>
    </section>`;
}

function renderGameInProgress() {
  const g = state.current;
  g.participants = g.participants.filter((id) => kidById(id));

  app.innerHTML = `
    <section class="screen">
      <div class="game-title">
        <span class="now-playing">Now playing</span>
        <h1>${esc(g.name)}</h1>
        <span class="muted">${plural(g.participants.length, 'player')} · tap a medal or use − / + to give points</span>
      </div>

      <div class="participants">
        ${g.participants.map((id) => {
          const k = kidById(id);
          const pts = g.results[id] || 0;
          const medal = g.medals[id];
          return `
            <div class="card player-card ${medal ? 'medal-' + medal : ''}">
              <div class="player-avatar">${k.avatar}</div>
              <div class="player-name">${esc(k.name)}</div>
              <div class="player-points">${pts} <small>pts</small></div>
              <div class="medal-row">
                ${[1, 2, 3].map((p) => `
                  <button class="medal-btn ${medal === p ? 'on' : ''}" data-action="medal" data-id="${id}" data-place="${p}"
                    title="${['1st', '2nd', '3rd'][p - 1]} place: ${state.points[p]} pts">${MEDALS[p]}</button>`).join('')}
              </div>
              <div class="stepper small">
                <button class="round-btn" data-action="adjust" data-id="${id}" data-delta="-1" ${pts <= 0 ? 'disabled' : ''} aria-label="Remove a point from ${esc(k.name)}">−</button>
                <button class="round-btn" data-action="adjust" data-id="${id}" data-delta="1" aria-label="Add a point for ${esc(k.name)}">+</button>
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="actions">
        <button class="btn primary big" data-action="finish-game">Finish game ✅</button>
        <button class="btn" data-action="cancel-game">Cancel game</button>
      </div>
    </section>`;
}

function startGame() {
  const errorEl = document.getElementById('game-error');
  if (!draft.participants.length) {
    errorEl.textContent = 'Pick at least one player.';
    errorEl.hidden = false;
    return;
  }
  const name = draft.name.trim() || `Game ${state.games.length + 1}`;
  // Keep players in the same order as the setup list.
  const participants = state.kids.map((k) => k.id).filter((id) => draft.participants.includes(id));
  state.current = {
    name,
    participants,
    results: Object.fromEntries(participants.map((id) => [id, 0])),
    medals: {},
  };
  draft = null;
  saveState();
  render();
}

function finishGame() {
  const g = state.current;
  const awarded = g.participants.some((id) => g.results[id] > 0);
  if (!awarded && !confirm('No points were given in this game. Save it anyway?')) return;
  state.games.push({ ...g, id: uid(), playedAt: new Date().toISOString() });
  state.current = null;
  saveState();
  go('scores');
  if (awarded) confetti();
}

function confetti() {
  const pieces = ['🎉', '🎈', '⭐', '🎊', '✨', '🧁'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.textContent = pieces[i % pieces.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDelay = Math.random() * 0.6 + 's';
    s.style.animationDuration = 1.8 + Math.random() * 1.2 + 's';
    s.style.fontSize = 18 + Math.random() * 22 + 'px';
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3800);
}

// ---------- Events ----------
document.addEventListener('click', (e) => {
  const navLink = e.target.closest('.nav-link.disabled');
  if (navLink) {
    e.preventDefault();
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id } = el.dataset;

  switch (action) {
    // Setup
    case 'count-inc':
      if (state.kids.length < MAX_KIDS) { addKid(); saveState(); renderSetup(); }
      document.querySelector('.kid-row:last-child .name-input')?.focus();
      break;
    case 'count-dec': {
      const last = state.kids[state.kids.length - 1];
      if (state.kids.length <= MIN_KIDS) break;
      const label = last.name.trim() || 'the last kid';
      if (kidHasPoints(last.id) && !confirm(`Remove ${label}? Their points will be lost.`)) break;
      state.kids.pop();
      saveState();
      renderSetup();
      break;
    }
    case 'pick-avatar':
      openAvatarPicker(id);
      break;
    case 'setup-done':
      finishSetup();
      break;
    case 'reset':
      if (confirm('Start a new party? This erases all players, games and scores.')) {
        state = defaultState();
        draft = null;
        saveState();
        go('setup');
      }
      break;

    // Scores
    case 'go-game':
      go('game');
      break;
    case 'delete-game': {
      const g = state.games.find((x) => x.id === id);
      if (g && confirm(`Delete "${g.name}" and its points?`)) {
        state.games = state.games.filter((x) => x.id !== id);
        saveState();
        renderScores();
      }
      break;
    }

    // New game
    case 'idea':
      draft.name = el.dataset.name;
      document.getElementById('game-name').value = draft.name;
      break;
    case 'toggle-player':
      draft.participants = draft.participants.includes(id)
        ? draft.participants.filter((x) => x !== id)
        : [...draft.participants, id];
      renderNewGame();
      break;
    case 'select-all':
      draft.participants = state.kids.map((k) => k.id);
      renderNewGame();
      break;
    case 'select-none':
      draft.participants = [];
      renderNewGame();
      break;
    case 'start-game':
      startGame();
      break;

    // Game in progress
    case 'medal': {
      const g = state.current;
      const place = Number(el.dataset.place);
      if (g.medals[id] === place) {
        delete g.medals[id];
        g.results[id] = 0;
      } else {
        g.medals[id] = place;
        g.results[id] = state.points[place];
      }
      saveState();
      renderGameInProgress();
      break;
    }
    case 'adjust': {
      const g = state.current;
      g.results[id] = Math.max(0, (g.results[id] || 0) + Number(el.dataset.delta));
      saveState();
      renderGameInProgress();
      break;
    }
    case 'finish-game':
      finishGame();
      break;
    case 'cancel-game':
      if (confirm(`Cancel "${state.current.name}"? Points from this game won't be saved.`)) {
        state.current = null;
        saveState();
        go('scores');
      }
      break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.classList.contains('name-input')) {
    const kid = kidById(t.dataset.id);
    if (kid) {
      kid.name = t.value;
      t.classList.remove('invalid');
      saveState();
    }
  } else if (t.classList.contains('points-input')) {
    state.points[t.dataset.place] = Math.max(0, Math.min(99, parseInt(t.value, 10) || 0));
    saveState();
  } else if (t.id === 'game-name' && draft) {
    draft.name = t.value;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.classList.contains('name-input')) {
    const inputs = [...document.querySelectorAll('.name-input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else finishSetup();
  } else if (e.target.id === 'game-name') {
    startGame();
  }
});

render();
