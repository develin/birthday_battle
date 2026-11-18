'use strict';

// ---------- Constants ----------
const STORAGE_KEY = 'birthday-battle-v1';
const MIN_KIDS = 2;
const MAX_KIDS = 20;
const DEFAULT_KIDS = 4;
const BOARD_ONE_COLUMN_MAX = 8; // more kids than this → scoreboard uses two columns
const AVATARS = [
  '🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🐵', '🦊', '🐶', '🐱',
  '🐰', '🦄', '🐲', '🦖', '🐙', '🦈', '🐬', '🦋', '🐝', '🐞',
  '🦉', '🐧', '🦜', '🐢', '🚀', '⚽', '🏀', '🎸', '🎨', '👑',
  '🌈', '⭐', '🍕', '🍩', '🧁', '🍉', '🤖', '👻', '🦸', '🧙',
];
// Each kid keeps one color on every screen, so kids who can't read yet can
// still find themselves on the TV.
const KID_COLORS = [
  '#FF5D8F', '#3EC1F3', '#7BE07B', '#FF9F43', '#B583FF',
  '#2EE6C5', '#FF6B5B', '#6F8BFF', '#FF8AD8', '#F2E86D',
];
// Starter game list for a new party (and for saved data from before the game list existed).
const DEFAULT_GAMES = [
  'Topfschlagen', 'Reise nach Jerusalem', 'Sackhüpfen', 'Eierlauf',
  'Schokoladenessen', 'Stopptanz', 'Schatzsuche', 'Dosenwerfen',
  'Luftballontanz', 'Blinde Kuh',
];
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const WHEEL_COLORS = ['#FF5D8F', '#3EC1F3', '#7BE07B', '#FF9F43', '#B583FF', '#2EE6C5', '#FFD23F', '#6F8BFF'];
const WHEEL_SLOW_MS = 2000;     // slow spin before it speeds up (the Stopp button is locked meanwhile)
const WHEEL_SLOW_SPEED = 45;    // degrees per second
const WHEEL_RAMP_MS = 600;      // time to speed up to full speed

const app = document.getElementById('app');
const nav = document.getElementById('nav');

// ---------- State ----------
// kids:     [{ id, name, avatar, color }]
// gameList: [{ id, name, active, played }]  the games the party can play; inactive ones are never
//           offered. `played` counts rounds in the current wheel session (see normalizeRounds).
// games:    [{ id, name, participants: [kidId], results: { kidId: points }, medals: { kidId: place }, playedAt }]
// current:  the game in progress (same shape as a game plus gameId, minus id/playedAt) or null
// points:   points awarded for 1st / 2nd / 3rd place
let state = loadState();
let draft = null;  // new-game form: { gameId, participants: [kidId] }
let wheel = null;  // running wheel animation (see startWheel)
ensureKidColors();

function defaultGameList() {
  return DEFAULT_GAMES.map((name) => ({ id: uid(), name, active: true }));
}

function defaultState() {
  return { kids: [], gameList: defaultGameList(), games: [], current: null, points: { 1: 3, 2: 2, 3: 1 } };
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
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const kidById = (id) => state.kids.find((k) => k.id === id);
const gameById = (id) => state.gameList.find((g) => g.id === id);
const isReady = () => state.kids.length >= MIN_KIDS && state.kids.every((k) => k.name.trim());
const kidsLabel = (n) => `${n} ${n === 1 ? 'Kind' : 'Kinder'}`;
const ptsLabel = (n) => (n === 1 ? 'Punkt' : 'Punkte');
const pointsText = (n) => `${n} ${ptsLabel(n)}`;
const place = (n) => `${n}.`; // German ordinal: 1. 2. 3.
const kidStyle = (kid) => `--kid:${esc(kid.color)}`;
const timesPlayed = (name) => state.games.filter((g) => g.name.toLowerCase() === name.toLowerCase()).length;

function freeAvatar() {
  const taken = new Set(state.kids.map((k) => k.avatar));
  return AVATARS.find((a) => !taken.has(a)) || AVATARS[0];
}

// The least-used color, so colors only repeat once all of them are taken.
function freeColor() {
  const used = Object.fromEntries(KID_COLORS.map((c) => [c, 0]));
  state.kids.forEach((k) => { if (k.color in used) used[k.color]++; });
  return KID_COLORS.reduce((best, c) => (used[c] < used[best] ? c : best), KID_COLORS[0]);
}

// Saved data from before kids had colors: give each one a color.
function ensureKidColors() {
  let changed = false;
  state.kids.forEach((k) => {
    if (!k.color) { k.color = freeColor(); changed = true; }
  });
  if (changed) saveState();
}

function addKid() {
  state.kids.push({ id: uid(), name: '', avatar: freeAvatar(), color: freeColor() });
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

// ---------- Wheel weighting ----------
// Each round a game is played in the current session halves its slice of the wheel;
// the other games share the freed space.
const wheelWeight = (g) => Math.pow(0.5, g.played || 0);

// Slices of the wheel in degrees, clockwise from the top: [{ game, start, end }].
function wheelSlices() {
  const active = state.gameList.filter((g) => g.active);
  const total = active.reduce((sum, g) => sum + wheelWeight(g), 0);
  let angle = 0;
  return active.map((g) => {
    const sweep = (360 * wheelWeight(g)) / total;
    const slice = { game: g, start: angle, end: angle + sweep };
    angle += sweep;
    return slice;
  });
}

// A session lasts until every active game has been played at least once. Then
// every game counts as played one round less, so the session starts over.
function normalizeRounds() {
  const active = state.gameList.filter((g) => g.active);
  while (active.length && active.every((g) => (g.played || 0) >= 1)) {
    state.gameList.forEach((g) => { g.played = Math.max(0, (g.played || 0) - 1); });
  }
}

// Returns [{ kid, points, rank }] sorted by points; tied kids share a rank.
function ranked(scores, ids) {
  const list = ids
    .map((id) => ({ kid: kidById(id), points: scores[id] || 0 }))
    .filter((r) => r.kid);
  list.sort((a, b) => b.points - a.points || a.kid.name.localeCompare(b.kid.name, 'de'));
  let rank = 0;
  list.forEach((r, i) => {
    if (i === 0 || r.points !== list[i - 1].points) rank = i + 1;
    r.rank = rank;
  });
  return list;
}

// ---------- Routing ----------
// Routes: #/setup, #/games, #/scores, #/game, #/wheel, #/podium/<gameId>
function routeParts() {
  return location.hash.replace(/^#\/?/, '').split('/');
}

function currentRoute() {
  return routeParts()[0];
}

function go(path) {
  if (location.hash.replace(/^#\/?/, '') === path) render();
  else location.hash = '#/' + path;
}

window.addEventListener('hashchange', render);

function render() {
  document.querySelector('.winner-pop')?.remove();
  stopWheel();
  let route = currentRoute();
  const ready = isReady();
  if (!['setup', 'games', 'scores', 'game', 'wheel', 'podium'].includes(route)) route = ready ? 'scores' : 'setup';
  if (!ready && route !== 'games') route = 'setup';
  if (currentRoute() !== route) history.replaceState(null, '', '#/' + route);

  renderNav(route, ready);
  if (route === 'setup') renderSetup();
  else if (route === 'games') renderGameList();
  else if (route === 'scores') renderScores();
  else if (route === 'podium') renderPodium(routeParts()[1]);
  else if (route === 'wheel') renderWheel();
  else renderGame();
  app.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

function renderNav(route, ready) {
  const link = (r, label, needsKids) => {
    const cls = ['nav-link', r === route ? 'active' : '', !ready && needsKids ? 'disabled' : '']
      .filter(Boolean).join(' ');
    return `<a class="${cls}" href="#/${r}">${label}</a>`;
  };
  const gameLabel = state.current
    ? 'Spielen <span class="live-dot" title="Ein Spiel läuft gerade"></span>'
    : 'Spielen';
  nav.innerHTML = link('setup', 'Kinder', false)
    + link('games', 'Spiele', false)
    + link('scores', 'Punkte', true)
    + link('game', gameLabel, true);
  // The wheel belongs to "Spielen".
  if (route === 'wheel') nav.querySelector('[href="#/game"]')?.classList.add('active');
}

// "Neues Spiel" and "Zufall" side by side, used wherever a new game can be started.
function newGameButtons(extraClass = '') {
  return `
    <button class="btn big ${extraClass}" data-action="go-game">Neues Spiel</button>
    <button class="btn big random-btn ${extraClass}" data-action="go-wheel">🎲 Zufall</button>`;
}

// ---------- Setup screen (kids) ----------
function renderSetup() {
  if (state.kids.length === 0) {
    for (let i = 0; i < DEFAULT_KIDS; i++) addKid();
    saveState();
  }
  const n = state.kids.length;
  const started = state.games.length > 0 || state.current;

  app.innerHTML = `
    <section class="screen">
      <div class="setup-head">
        <h1>Wer spielt mit?</h1>
        <div class="stepper">
          <button class="round-btn" data-action="count-dec" ${n <= MIN_KIDS ? 'disabled' : ''} aria-label="Ein Kind weniger">−</button>
          <span class="count-num">${n}</span>
          <button class="round-btn" data-action="count-inc" ${n >= MAX_KIDS ? 'disabled' : ''} aria-label="Ein Kind mehr">+</button>
          <span class="count-label">${n === 1 ? 'Kind' : 'Kinder'}</span>
        </div>
      </div>

      <ol class="kid-list">
        ${state.kids.map((k, i) => `
          <li class="kid-row" style="${kidStyle(k)}">
            <button class="avatar-btn" data-action="pick-avatar" data-id="${k.id}" title="Bild aussuchen" aria-label="Bild für Kind ${i + 1} aussuchen">${k.avatar}</button>
            <input class="name-input" data-id="${k.id}" type="text" maxlength="20"
              placeholder="Name von Kind ${i + 1}" value="${esc(k.name)}" autocomplete="off">
          </li>`).join('')}
      </ol>

      <details class="settings">
        <summary>Punkte pro Platz</summary>
        <div class="settings-grid">
          ${[1, 2, 3].map((p) => `
            <label>${MEDALS[p]} ${place(p)} Platz
              <input class="points-input" data-place="${p}" type="number" min="0" max="99" value="${state.points[p]}">
            </label>`).join('')}
        </div>
      </details>

      <p class="form-error" id="setup-error" hidden></p>

      <div class="actions">
        <button class="btn primary big" data-action="setup-done">${started ? 'Speichern und Punkte zeigen' : "Los geht's! 🎉"}</button>
        ${started ? '<button class="btn danger" data-action="reset">Neue Party starten</button>' : ''}
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
    <div class="modal" role="dialog" aria-modal="true" aria-label="Bild aussuchen" style="${kidStyle(kid)}">
      <h2>Such dir ein Bild aus${kid.name.trim() ? `, ${esc(kid.name.trim())}` : ''}!</h2>
      <div class="avatar-grid">
        ${AVATARS.map((a) => `
          <button class="avatar-choice ${a === kid.avatar ? 'selected' : ''}" data-avatar="${a}"
            ${takenByOthers.has(a) ? 'disabled title="Schon vergeben"' : ''}>${a}</button>`).join('')}
      </div>
      <button class="btn" data-close>Schließen</button>
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
    errorEl.textContent = empty.length === 1
      ? 'Ein Kind hat noch keinen Namen.'
      : `${empty.length} Kinder haben noch keinen Namen.`;
    errorEl.hidden = false;
    document.querySelector('.name-input.invalid')?.focus();
    return;
  }
  state.kids.forEach((k) => { k.name = k.name.trim(); });
  saveState();
  go('scores');
}

// ---------- Game list screen ----------
function renderGameList() {
  const active = state.gameList.filter((g) => g.active).length;
  const chance = Object.fromEntries(wheelSlices().map((s) => [s.game.id, Math.round(((s.end - s.start) / 360) * 100)]));

  app.innerHTML = `
    <section class="screen">
      <div class="setup-head">
        <h1>Spiele</h1>
        <span class="count-label">${active} von ${state.gameList.length} Spielen sind an</span>
      </div>

      <form class="add-game" data-form="add-game">
        <label class="sr-only" for="new-game">Neues Spiel</label>
        <input id="new-game" class="text-input" type="text" maxlength="40" placeholder="Neues Spiel, zum Beispiel Wattepusten" autocomplete="off">
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
      <p class="form-error" id="games-error" hidden></p>

      ${state.gameList.length ? `
        <ul class="game-list">
          ${state.gameList.map((g) => {
            const played = timesPlayed(g.name);
            return `
              <li class="game-row ${g.active ? '' : 'off'}">
                <div class="game-row-main">
                  <span class="game-row-name">${esc(g.name)}</span>
                  <span class="game-row-meta">${played ? (played === 1 ? 'Einmal gespielt' : `${played}-mal gespielt`) : 'Noch nicht gespielt'}${g.active ? `, ${chance[g.id]} % auf dem Glücksrad` : ''}</span>
                </div>
                <button class="switch ${g.active ? 'on' : ''}" role="switch" aria-checked="${g.active}" data-action="toggle-game" data-id="${g.id}"
                  aria-label="${esc(g.name)} ${g.active ? 'ausschalten' : 'anschalten'}">
                  <span class="switch-track"><span class="switch-knob"></span></span>
                  <span class="switch-label">${g.active ? 'An' : 'Aus'}</span>
                </button>
                <button class="icon-btn" data-action="delete-list-game" data-id="${g.id}" title="Spiel löschen" aria-label="${esc(g.name)} löschen">🗑️</button>
              </li>`;
          }).join('')}
        </ul>` : '<p class="muted">Noch keine Spiele. Füge oben ein Spiel hinzu.</p>'}

      <p class="muted note">Spiele, die aus sind, kommen nicht aufs Glücksrad. Jedes Mal, wenn ein Spiel gespielt wurde, wird sein Feld auf dem Rad halb so groß, bis alle Spiele einmal dran waren.</p>
    </section>`;
}

function addGameToList() {
  const input = document.getElementById('new-game');
  const errorEl = document.getElementById('games-error');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  if (state.gameList.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
    errorEl.textContent = `„${name}“ ist schon in der Liste.`;
    errorEl.hidden = false;
    input.focus();
    return;
  }
  state.gameList.push({ id: uid(), name, active: true, played: 0 });
  saveState();
  renderGameList();
  document.getElementById('new-game')?.focus();
}

// ---------- Score screen ----------
function renderScores() {
  const scores = totals();
  const board = ranked(scores, state.kids.map((k) => k.id));
  const max = Math.max(1, ...board.map((r) => r.points));
  const cols = board.length > BOARD_ONE_COLUMN_MAX ? 2 : 1;
  const rows = Math.ceil(board.length / cols);
  const history = [...state.games].reverse();

  app.innerHTML = `
    <section class="screen fit scores-screen">
      <div class="board-panel">
        <h1>Punktestand</h1>
        <ol class="board ${cols === 2 ? 'two-col' : ''}" style="--rows:${rows}">
          ${board.map((r) => {
            const medal = r.points > 0 && MEDALS[r.rank];
            return `
              <li class="board-row ${medal ? 'place-' + r.rank : ''}" style="${kidStyle(r.kid)};--fill:${(r.points / max) * 100}%">
                <span class="rank ${medal ? 'rank-medal' : ''}">${medal || place(r.rank)}</span>
                <span class="board-avatar">${r.kid.avatar}</span>
                <span class="board-name">${esc(r.kid.name)}</span>
                <span class="board-points">${r.points}<small>${ptsLabel(r.points)}</small></span>
              </li>`;
          }).join('')}
        </ol>
      </div>

      <aside class="side-panel">
        ${state.current
          ? `<button class="btn primary big" data-action="go-game">Zurück zu ${esc(state.current.name)}</button>`
          : `<div class="side-buttons">${newGameButtons()}</div>`}
        <h2>Gespielt <span class="muted">${state.games.length}</span></h2>
        ${history.length ? `
          <ul class="history">
            ${history.map((g) => {
              const podium = ranked(g.results, g.participants).filter((r) => r.points > 0).slice(0, 3);
              return `
                <li class="history-row">
                  <div class="history-main">
                    <div class="history-name">${esc(g.name)}</div>
                    <div class="history-meta">
                      ${podium.length
                        ? podium.map((r) => `<span>${MEDALS[r.rank] || ''} ${esc(r.kid.name)} +${r.points}</span>`).join('')
                        : `<span>${kidsLabel(g.participants.length)}, keine Punkte</span>`}
                    </div>
                  </div>
                  <div class="history-actions">
                    ${podium.length ? `<a class="icon-btn" href="#/podium/${g.id}" title="Siegertreppchen zeigen" aria-label="Siegertreppchen für ${esc(g.name)} zeigen">🏆</a>` : ''}
                    <button class="icon-btn" data-action="delete-game" data-id="${g.id}" title="Spiel löschen" aria-label="${esc(g.name)} löschen">🗑️</button>
                  </div>
                </li>`;
            }).join('')}
          </ul>` : '<p class="muted">Fertige Spiele stehen dann hier.</p>'}
      </aside>
    </section>`;
}

// ---------- Game screen ----------
function renderGame() {
  if (state.current) renderGameInProgress();
  else renderNewGame();
}

function renderNewGame() {
  if (!draft) draft = { gameId: null, participants: state.kids.map((k) => k.id) };
  draft.participants = draft.participants.filter((id) => kidById(id));
  const choices = state.gameList.filter((g) => g.active);
  if (draft.gameId && !choices.some((g) => g.id === draft.gameId)) draft.gameId = null;

  app.innerHTML = `
    <section class="screen">
      <div class="game-head">
        <h1 class="game-name">Neues Spiel</h1>
        <div class="head-actions">
          <p class="form-error" id="game-error" hidden></p>
          <button class="btn primary big" data-action="start-game">Spiel starten</button>
        </div>
      </div>

      <div class="name-card">
        <div class="pick-head">
          <h2>Was spielen wir?</h2>
          ${choices.length ? '<button class="btn random-btn" data-action="go-wheel">🎲 Zufall</button>' : ''}
        </div>
        ${choices.length ? `
          <div class="game-tiles">
            ${choices.map((g) => `
              <button class="game-tile ${g.id === draft.gameId ? 'on' : ''}" data-action="pick-game" data-id="${g.id}" aria-pressed="${g.id === draft.gameId}">
                <span class="game-tile-name">${esc(g.name)}</span>
                ${timesPlayed(g.name) ? '<span class="game-tile-meta">Schon gespielt</span>' : ''}
              </button>`).join('')}
          </div>` : `
          <p class="muted">Gerade ist kein Spiel an.</p>
          <a class="btn" href="#/games">Spiele anschalten</a>`}
      </div>

      <div class="section-head">
        <h2>Wer spielt mit? <span class="muted">${draft.participants.length} von ${state.kids.length}</span></h2>
        <div class="section-tools">
          <button class="btn small-btn" data-action="select-all">Alle</button>
          <button class="btn small-btn" data-action="select-none">Keiner</button>
        </div>
      </div>
      <div class="player-picker">
        ${state.kids.map((k) => `
          <button class="player-toggle ${draft.participants.includes(k.id) ? 'on' : ''}" data-action="toggle-player" data-id="${k.id}"
            style="${kidStyle(k)}" aria-pressed="${draft.participants.includes(k.id)}">
            <span class="toggle-avatar">${k.avatar}</span>
            <span class="toggle-name">${esc(k.name)}</span>
          </button>`).join('')}
      </div>
    </section>`;
}

// ---------- Wheel screen ----------
const polar = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)]; // 0° at the top, clockwise
};

function renderWheel() {
  if (state.current) {
    location.replace('#/game');
    return;
  }
  const slices = wheelSlices();
  if (!slices.length) {
    app.innerHTML = `
      <section class="screen">
        <h1>Glücksrad</h1>
        <p class="muted">Gerade ist kein Spiel an.</p>
        <a class="btn" href="#/games">Spiele anschalten</a>
      </section>`;
    return;
  }

  const R = 100;
  const n = slices.length;
  const sliceSvg = slices.map((s, i) => {
    const sweep = s.end - s.start;
    let color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    // Don't let the last slice share a color with its neighbour, the first slice.
    if (n > 1 && i === n - 1 && i % WHEEL_COLORS.length === 0) color = WHEEL_COLORS[2];
    const shape = sweep >= 359.99
      ? `<circle r="${R}" fill="${color}"/>`
      : (() => {
          const [x1, y1] = polar(s.start, R);
          const [x2, y2] = polar(s.end, R);
          return `<path d="M0 0 L${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}"/>`;
        })();
    // Label along the radius, reading from the hub outwards (like a real wheel, so
    // labels turn with it). Font shrinks for narrow slices and long names.
    const mid = s.start + sweep / 2;
    const size = Math.max(3.5, Math.min(9, sweep / 4.5, 70 / (s.game.name.length * 0.55)));
    const label = `<text class="wheel-label" transform="rotate(${(mid - 90).toFixed(2)})" x="${R * 0.58}" y="0"
        font-size="${size.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${esc(s.game.name)}</text>`;
    return `<g class="wheel-slice" data-id="${s.game.id}">${shape}${label}</g>`;
  }).join('');

  app.innerHTML = `
    <section class="screen fit wheel-screen">
      <h1>Glücksrad</h1>
      <div class="wheel-stage">
        <div class="wheel-wrap">
          <svg class="wheel" viewBox="-115 -120 230 235" role="img" aria-label="Glücksrad mit ${n} Spielen">
            <g id="wheel-rotor">${sliceSvg}</g>
            <circle r="${R}" fill="none" class="wheel-rim"/>
            <circle r="11" class="wheel-hub"/>
            <polygon points="-9,-116 9,-116 0,-93" class="wheel-pointer"/>
          </svg>
        </div>
        <div class="wheel-side">
          <p class="wheel-status" id="wheel-status" aria-live="polite">Das Rad dreht sich …</p>
          <button class="btn primary stop-btn" id="wheel-stop" data-action="wheel-stop" disabled>Stopp!</button>
          <div class="wheel-result" id="wheel-result" hidden>
            <span class="wheel-result-label">Als Nächstes spielen wir</span>
            <span class="wheel-result-name" id="wheel-result-name"></span>
            <div class="wheel-result-actions">
              <button class="btn primary big" data-action="wheel-start-all">Mit allen Kindern starten</button>
              <button class="btn big" data-action="wheel-choose-kids">Kinder auswählen</button>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  startWheel(slices);
}

// Spins slowly for WHEEL_SLOW_MS, then speeds up to a random fast speed; only
// then can it be stopped. After "Stopp!" it slows down with a random amount of
// friction, so where it lands can't be aimed.
function startWheel(slices) {
  const rotor = document.getElementById('wheel-rotor');
  const now = performance.now();
  wheel = {
    slices,
    angle: Math.random() * 360,
    speed: WHEEL_SLOW_SPEED,
    fastSpeed: 900 + Math.random() * 400,
    friction: 0,
    phase: 'slow',
    started: now,
    last: now,
    raf: 0,
  };

  const frame = (t) => {
    if (!wheel) return;
    const dt = Math.min(0.1, (t - wheel.last) / 1000);
    wheel.last = t;
    const elapsed = t - wheel.started;

    if (wheel.phase === 'slow' && elapsed >= WHEEL_SLOW_MS) {
      wheel.phase = 'ramp';
    }
    if (wheel.phase === 'ramp') {
      const p = Math.min(1, (elapsed - WHEEL_SLOW_MS) / WHEEL_RAMP_MS);
      wheel.speed = WHEEL_SLOW_SPEED + (wheel.fastSpeed - WHEEL_SLOW_SPEED) * p;
      if (p >= 1) {
        wheel.phase = 'fast';
        const stopBtn = document.getElementById('wheel-stop');
        stopBtn.disabled = false;
        stopBtn.focus();
        document.getElementById('wheel-status').textContent = 'Drück auf Stopp!';
      }
    }
    if (wheel.phase === 'stopping') {
      wheel.speed *= Math.exp(-wheel.friction * dt);
      if (wheel.speed < 6) {
        finishWheel();
        return;
      }
    }

    wheel.angle = (wheel.angle + wheel.speed * dt) % 360;
    rotor.setAttribute('transform', `rotate(${wheel.angle.toFixed(2)})`);
    wheel.raf = requestAnimationFrame(frame);
  };
  wheel.raf = requestAnimationFrame(frame);
}

function stopWheel() {
  if (wheel) cancelAnimationFrame(wheel.raf);
  wheel = null;
}

function pressWheelStop() {
  if (!wheel || wheel.phase !== 'fast') return;
  wheel.phase = 'stopping';
  wheel.friction = 1.6 + Math.random() * 0.6;
  const stopBtn = document.getElementById('wheel-stop');
  stopBtn.disabled = true;
  document.getElementById('wheel-status').textContent = 'Gleich bleibt es stehen …';
}

function finishWheel() {
  // The pointer is at the top: find which slice sits under it.
  const local = ((360 - wheel.angle) % 360 + 360) % 360;
  const slice = wheel.slices.find((s) => local >= s.start && local < s.end) || wheel.slices[wheel.slices.length - 1];
  const game = slice.game;
  wheel.phase = 'done';
  wheel.winnerId = game.id;
  cancelAnimationFrame(wheel.raf);

  document.querySelectorAll('.wheel-slice').forEach((el) => el.classList.toggle('dim', el.dataset.id !== game.id));
  document.getElementById('wheel-status').hidden = true;
  document.getElementById('wheel-stop').hidden = true;
  document.getElementById('wheel-result-name').textContent = game.name;
  document.getElementById('wheel-result').hidden = false;
  document.querySelector('[data-action="wheel-start-all"]')?.focus();
}

function renderGameInProgress() {
  const g = state.current;
  g.participants = g.participants.filter((id) => kidById(id));

  app.innerHTML = `
    <section class="screen fit">
      <div class="game-head">
        <div>
          <h1 class="game-name">${esc(g.name)}</h1>
          <p class="hint">Tippe auf eine Medaille oder auf − und +.</p>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="cancel-game">Abbrechen</button>
          <button class="btn primary big" data-action="finish-game">Spiel fertig</button>
        </div>
      </div>

      <div class="participants">
        ${g.participants.map((id) => {
          const k = kidById(id);
          const pts = g.results[id] || 0;
          const medal = g.medals[id];
          return `
            <div class="player-card ${medal ? 'place-' + medal : ''}" style="${kidStyle(k)}">
              <div class="player-top">
                <span class="player-avatar">${k.avatar}</span>
                <span class="player-name">${esc(k.name)}</span>
                <span class="player-points">${pts}<small>${ptsLabel(pts)}</small></span>
              </div>
              <div class="player-controls">
                <div class="medal-row">
                  ${[1, 2, 3].map((p) => `
                    <button class="medal-btn ${medal === p ? 'on' : ''}" data-action="medal" data-id="${id}" data-place="${p}"
                      title="${place(p)} Platz: ${pointsText(state.points[p])}" aria-label="${place(p)} Platz für ${esc(k.name)}">${MEDALS[p]}</button>`).join('')}
                </div>
                <div class="adjust-row">
                  <button class="round-btn" data-action="adjust" data-id="${id}" data-delta="-1" ${pts <= 0 ? 'disabled' : ''} aria-label="${esc(k.name)} einen Punkt wegnehmen">−</button>
                  <button class="round-btn" data-action="adjust" data-id="${id}" data-delta="1" aria-label="${esc(k.name)} einen Punkt geben">+</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </section>`;
}

function startGame() {
  const errorEl = document.getElementById('game-error');
  const game = draft.gameId && gameById(draft.gameId);
  if (!game) {
    errorEl.textContent = 'Such zuerst ein Spiel aus.';
    errorEl.hidden = false;
    return;
  }
  if (!draft.participants.length) {
    errorEl.textContent = 'Wähle mindestens ein Kind aus.';
    errorEl.hidden = false;
    return;
  }
  beginGame(game, draft.participants);
}

function beginGame(game, participantIds) {
  // Keep players in the same order as the setup list.
  const participants = state.kids.map((k) => k.id).filter((id) => participantIds.includes(id));
  state.current = {
    gameId: game.id,
    name: game.name,
    participants,
    results: Object.fromEntries(participants.map((id) => [id, 0])),
    medals: {},
  };
  draft = null;
  saveState();
  go('game');
}

function finishGame() {
  const g = state.current;
  const awarded = g.participants.some((id) => g.results[id] > 0);
  if (!awarded && !confirm('In diesem Spiel hat niemand Punkte bekommen. Trotzdem speichern?')) return;
  const game = { ...g, id: uid(), playedAt: new Date().toISOString() };
  state.games.push(game);
  state.current = null;
  // Count the round for the wheel (falls back to the name for games started before gameId existed).
  const listGame = gameById(g.gameId) || state.gameList.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
  if (listGame) {
    listGame.played = (listGame.played || 0) + 1;
    normalizeRounds();
  }
  saveState();
  go(awarded ? 'podium/' + game.id : 'scores');
}

// ---------- Podium screen ----------
function renderPodium(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) {
    location.replace('#/scores');
    return;
  }

  // Kids with points who rank 1st–3rd stand on the podium (ties share a step);
  // everyone else stands on the ground, alternating left/right so the
  // better-placed kids are closest to the podium.
  const results = ranked(game.results, game.participants);
  const onPodium = (r) => r.points > 0 && r.rank <= 3;
  const steps = { 1: [], 2: [], 3: [] };
  results.filter(onPodium).forEach((r) => steps[r.rank].push(r));
  const left = [];
  const right = [];
  results.filter((r) => !onPodium(r)).forEach((r, i) => (i % 2 === 0 ? left : right).push(r));
  left.reverse();

  const kidHtml = (r, onGround) => `
    <div class="podium-kid" style="${kidStyle(r.kid)}">
      <span class="podium-avatar">${r.kid.avatar}</span>
      <span class="podium-name">${esc(r.kid.name)}</span>
      <span class="podium-points">${onGround ? place(r.rank) + ' Platz' : pointsText(r.points)}</span>
    </div>`;
  const stepHtml = (p) => `
    <div class="step step-${p}">
      <div class="step-kids">${steps[p].map((r) => kidHtml(r, false)).join('')}</div>
      <div class="step-block">${p}</div>
    </div>`;

  app.innerHTML = `
    <section class="screen fit podium-screen">
      <h1>${esc(game.name)}</h1>

      <div class="stage" id="stage">
        <div class="ground-group left">${left.map((r) => kidHtml(r, true)).join('')}</div>
        <div class="podium">${stepHtml(2)}${stepHtml(1)}${stepHtml(3)}</div>
        <div class="ground-group right">${right.map((r) => kidHtml(r, true)).join('')}</div>
      </div>

      <div class="actions center">
        ${newGameButtons()}
        <button class="btn primary big" data-action="go-scores">Zum Punktestand</button>
      </div>
    </section>`;

  const reveal = () => {
    document.getElementById('stage')?.classList.add('reveal');
    confetti();
  };
  if (steps[1].length) showWinnerPop(steps[1].map((r) => r.kid), reveal);
  else reveal();
}

// Big "Sieger <name>" announcement; calls onDone when it goes away (timeout or click).
function showWinnerPop(winners, onDone) {
  const pop = document.createElement('div');
  pop.className = 'winner-pop';
  pop.setAttribute('role', 'status');
  pop.innerHTML = `
    <div class="winner-pop-text">
      <span class="winner-label">Sieger</span>
      <span class="winner-names">
        ${winners.map((k) => `<span class="winner-name" style="${kidStyle(k)}">${esc(k.name)}</span>`).join('<span class="winner-and">und</span>')}
      </span>
    </div>`;

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    pop.classList.add('leaving');
    setTimeout(() => pop.remove(), 500);
    onDone();
  };
  pop.addEventListener('click', dismiss);
  setTimeout(dismiss, 3000);
  document.body.appendChild(pop);
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
    s.style.fontSize = 1 + Math.random() * 1.4 + 'rem';
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
    // Kids
    case 'count-inc':
      if (state.kids.length < MAX_KIDS) { addKid(); saveState(); renderSetup(); }
      document.querySelector('.kid-row:last-child .name-input')?.focus();
      break;
    case 'count-dec': {
      const last = state.kids[state.kids.length - 1];
      if (state.kids.length <= MIN_KIDS) break;
      const label = last.name.trim() || 'das letzte Kind';
      if (kidHasPoints(last.id) && !confirm(`${label} entfernen? Die Punkte gehen dann verloren.`)) break;
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
      if (confirm('Neue Party starten? Alle Kinder, Spiele und Punkte werden gelöscht. Die Spieleliste bleibt.')) {
        // Keep the game list and points, but start the wheel's round counts from 0.
        state = { ...defaultState(), gameList: state.gameList.map((g) => ({ ...g, played: 0 })), points: state.points };
        draft = null;
        saveState();
        go('setup');
      }
      break;

    // Game list
    case 'toggle-game': {
      const g = gameById(id);
      if (g) {
        g.active = !g.active;
        normalizeRounds(); // switching off the last unplayed game can complete the session
        saveState();
        renderGameList();
        document.querySelector(`[data-action="toggle-game"][data-id="${id}"]`)?.focus();
      }
      break;
    }
    case 'delete-list-game': {
      const g = gameById(id);
      if (g && confirm(`„${g.name}“ aus der Liste löschen?`)) {
        state.gameList = state.gameList.filter((x) => x.id !== id);
        normalizeRounds();
        saveState();
        renderGameList();
      }
      break;
    }

    // Scores / podium
    case 'go-scores':
      go('scores');
      break;
    case 'go-game':
      go('game');
      break;
    case 'go-wheel':
      go('wheel');
      break;

    // Wheel
    case 'wheel-stop':
      pressWheelStop();
      break;
    case 'wheel-start-all': {
      const g = wheel && gameById(wheel.winnerId);
      if (g) beginGame(g, state.kids.map((k) => k.id));
      break;
    }
    case 'wheel-choose-kids': {
      const g = wheel && gameById(wheel.winnerId);
      if (g) {
        draft = { gameId: g.id, participants: state.kids.map((k) => k.id) };
        go('game');
      }
      break;
    }
    case 'delete-game': {
      const g = state.games.find((x) => x.id === id);
      if (g && confirm(`„${g.name}“ und die Punkte davon löschen?`)) {
        state.games = state.games.filter((x) => x.id !== id);
        saveState();
        renderScores();
      }
      break;
    }

    // New game
    case 'pick-game':
      draft.gameId = id;
      renderNewGame();
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
      const p = Number(el.dataset.place);
      if (g.medals[id] === p) {
        delete g.medals[id];
        g.results[id] = 0;
      } else {
        g.medals[id] = p;
        g.results[id] = state.points[p];
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
      if (confirm(`„${state.current.name}“ abbrechen? Die Punkte aus diesem Spiel werden nicht gespeichert.`)) {
        state.current = null;
        saveState();
        go('scores');
      }
      break;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'add-game') {
    e.preventDefault();
    addGameToList();
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
  } else if (t.id === 'new-game') {
    document.getElementById('games-error').hidden = true;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.classList.contains('name-input')) {
    const inputs = [...document.querySelectorAll('.name-input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else finishSetup();
  }
});

render();
