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
// round:    { number, turn }  number counts up all party; turn is the index into kids of the kid
//           who picks the next game. turn === kids.length means everyone has had a turn this pass.
// partyOver: true once "Party beenden" was pressed (shows the final screen)
let state = loadState();
let draft = null;  // new-game form: { gameId, participants: [kidId] }
let wheel = null;  // running wheel animation (see startWheel)
ensureKidColors();

function defaultGameList() {
  return DEFAULT_GAMES.map((name) => ({ id: uid(), name, active: true }));
}

function defaultState() {
  return {
    kids: [], gameList: defaultGameList(), games: [], current: null, points: { 1: 3, 2: 2, 3: 1 },
    round: { number: 1, turn: 0 }, partyOver: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const base = defaultState();
      // Saves from before rounds existed continue with the next round number.
      const round = saved.round || { number: (saved.games || []).length + 1, turn: 0 };
      return { ...base, ...saved, round, points: { ...base.points, ...(saved.points || {}) } };
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

// The kid whose turn it is to pick a game, or null once everyone has had a turn this pass.
const turnKid = () => state.kids[state.round.turn] || null;

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

// ---------- Groups and bonus games ----------
// A game with maxPlayers 1 is a bonus game: only the picking kid plays, for 0–2 points.
const isBonus = (g) => Number(g?.maxPlayers) === 1;
// A team game is played by everyone at once in two teams, Rot and Blau (the player limit is ignored).
const isTeam = (g) => Boolean(g?.team) && !isBonus(g);
const TEAMS = {
  red: { name: 'Team Rot', icon: '🔴', color: '#FF5D5D' },
  blue: { name: 'Team Blau', icon: '🔵', color: '#4C9BFF' },
};

// Kids drawn at random into Rot and Blau; with an odd number, one team has one more kid.
function splitTeams(ids) {
  const [red, blue] = (() => {
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const half = Math.ceil(shuffled.length / 2);
    // Randomly decide which team gets the extra kid.
    return Math.random() < 0.5 ? [shuffled.slice(0, half), shuffled.slice(half)] : [shuffled.slice(half), shuffled.slice(0, half)];
  })();
  const order = state.kids.map((k) => k.id);
  const byOrder = (a, b) => order.indexOf(a) - order.indexOf(b);
  return { red: red.sort(byOrder), blue: blue.sort(byOrder) };
}

// Team result → points per kid: winners get the 1st-place points, losers the
// 2nd-place points; a draw gives everyone the 2nd-place points.
function teamResults(teams, winner) {
  const results = {};
  ['red', 'blue'].forEach((team) => {
    const pts = winner === team ? state.points[1] : state.points[2];
    teams[team].forEach((id) => { results[id] = pts; });
  });
  return results;
}
const zeroResults = (ids) => Object.fromEntries(ids.map((id) => [id, 0]));

// "Mia, Leo und Zoe"
function joinNames(ids) {
  const names = ids.map((id) => kidById(id)?.name).filter(Boolean).map(esc);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : (names[0] || '');
}

// Sizes of the groups when `count` kids play a game for up to `max` players:
// as few groups as possible, sizes differing by at most one (10 kids, max 4 → 4, 3, 3).
function groupSizes(count, max) {
  const groups = max ? Math.max(1, Math.ceil(count / max)) : 1;
  return Array.from({ length: groups }, (_, i) => Math.floor(count / groups) + (i < count % groups ? 1 : 0));
}

// Kids drawn at random into groups (each group listed in setup order).
function splitGroups(ids, max) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const order = state.kids.map((k) => k.id);
  let at = 0;
  return groupSizes(ids.length, max).map((size) => {
    const group = shuffled.slice(at, at + size);
    at += size;
    return group.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  });
}

// "Wird in 3 Gruppen gespielt: 4, 3 und 3 Kinder"
function groupPreview(count, max) {
  const sizes = groupSizes(count, max);
  if (sizes.length < 2) return '';
  const list = `${sizes.slice(0, -1).join(', ')} und ${sizes[sizes.length - 1]}`;
  return `Wird in ${sizes.length} Gruppen gespielt: ${list} Kinder`;
}

// Points for a bonus game the kid managed: 2 if they are more than 3 points behind
// the second-to-last kid (a chance to catch up), otherwise 1.
function bonusPoints(kidId) {
  const t = totals();
  const sorted = Object.values(t).sort((a, b) => a - b);
  if (sorted.length < 2) return 1;
  return sorted[1] - (t[kidId] || 0) > 3 ? 2 : 1;
}

// ---------- Wheel weighting ----------
// Each round a game is played in the current session halves its slice of the wheel;
// the other games share the freed space. Bonus games start from a different base
// that depends on how the picking kid is doing (see bonusBase).
const wheelWeight = (g, bonusW) => (isBonus(g) ? bonusW : 1) * Math.pow(0.5, g.played || 0);

// Bonus games are half as likely as other games; as likely as an unplayed game if
// the picking kid is 2+ points behind the leader; 50% more likely if they are last
// (lowest total, ties included, and behind the leader).
function bonusBase() {
  const kid = turnKid();
  if (!kid || state.kids.length < 2) return 0.5;
  const t = totals();
  const mine = t[kid.id] || 0;
  const values = Object.values(t);
  const leader = Math.max(...values);
  if (mine === Math.min(...values) && mine < leader) return 1.5;
  if (leader - mine >= 2) return 1;
  return 0.5;
}

// Slices of the wheel in degrees, clockwise from the top: [{ game, start, end }].
function wheelSlices() {
  const active = state.gameList.filter((g) => g.active);
  const bonusW = bonusBase();
  const total = active.reduce((sum, g) => sum + wheelWeight(g, bonusW), 0);
  let angle = 0;
  return active.map((g) => {
    const sweep = (360 * wheelWeight(g, bonusW)) / total;
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
// Routes: #/setup, #/games, #/scores, #/round, #/game, #/wheel, #/final,
//         #/podium/<gameId>/<groupNo> (gameId "current" = a finished group of the running game),
//         #/bonus/<gameId> (result of a bonus game)
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
  if (!['setup', 'games', 'scores', 'round', 'game', 'wheel', 'podium', 'bonus', 'team', 'final'].includes(route)) route = ready ? 'round' : 'setup';
  if (!ready && route !== 'games') route = 'setup';
  if (currentRoute() !== route) history.replaceState(null, '', '#/' + route);

  renderNav(route, ready);
  if (route === 'setup') renderSetup();
  else if (route === 'games') renderGameList();
  else if (route === 'scores') renderScores();
  else if (route === 'podium') renderGamePodium(routeParts()[1], routeParts()[2]);
  else if (route === 'bonus') renderBonusResult(routeParts()[1]);
  else if (route === 'team') renderTeamResult(routeParts()[1]);
  else if (route === 'final') renderFinal();
  else if (route === 'round') renderRound();
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
    + link('round', gameLabel, true);
  // Rounds, picking a game, the wheel, the running game and the final screen all belong to "Spielen".
  if (['game', 'wheel', 'final'].includes(route)) nav.querySelector('[href="#/round"]')?.classList.add('active');
}

// Where "Spielen" leads right now: the running game, the final screen, or the round screen.
function playPath() {
  if (state.current) return 'game';
  if (state.partyOver) return 'final';
  return 'round';
}

// The one button that moves the party on, shown after a game and on the scoreboard.
// It is the screen's default unless `isDefault` is false (game results default to the standings).
function nextStepButton(extraClass = '', isDefault = true) {
  const attrs = `class="btn ${isDefault ? 'primary ' : ''}big ${extraClass}"${isDefault ? ' data-default' : ''}`;
  if (state.current) return `<button ${attrs} data-action="go-game">Zurück zu ${esc(state.current.name)}</button>`;
  if (state.partyOver) return `<button ${attrs} data-action="go-final">Endstand zeigen</button>`;
  return `<button ${attrs} data-action="go-round">Nächste Runde</button>`;
}

// On a game's result screen the default is to look at the total standings.
function resultButtons(extraClass = 'big') {
  return `
    ${nextStepButton(extraClass, false)}
    <button class="btn primary ${extraClass}" data-default data-action="go-scores">Zum Punktestand</button>`;
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
        <button class="btn primary big" data-default data-action="setup-done">${started ? 'Speichern und weiterspielen' : "Los geht's! 🎉"}</button>
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
      Sound.click();
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
  go(playPath());
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
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
      <p class="form-error" id="games-error" hidden></p>

      ${state.gameList.length ? `
        <ul class="game-list">
          ${state.gameList.map((g) => {
            const played = timesPlayed(g.name);
            const max = Number(g.maxPlayers) || 0;
            const options = ['<option value="">Alle</option>', '<option value="1">1 (Bonus)</option>']
              .concat(Array.from({ length: MAX_KIDS - 1 }, (_, i) => `<option value="${i + 2}">${i + 2}</option>`))
              .join('')
              .replace(`value="${max || ''}"`, `value="${max || ''}" selected`);
            return `
              <li class="game-row ${g.active ? '' : 'off'}">
                <div class="game-row-main">
                  ${g.id === renamingGameId
                    ? `<input class="text-input rename-input" type="text" maxlength="40" value="${esc(g.name)}" data-id="${g.id}" autocomplete="off" aria-label="Neuer Name für ${esc(g.name)}">`
                    : `<span class="game-row-name">${esc(g.name)}&nbsp;<button class="rename-btn" data-action="rename-game" data-id="${g.id}" title="Namen ändern" aria-label="${esc(g.name)} umbenennen">✏️</button>${isBonus(g) ? ' <span class="bonus-badge">⭐ Bonus</span>' : ''}${isTeam(g) ? ' <span class="team-badge">🔴🔵 Team</span>' : ''}</span>`}
                  <span class="game-row-meta">${played ? (played === 1 ? 'Einmal gespielt' : `${played}-mal gespielt`) : 'Noch nicht gespielt'}${g.active ? `, ${chance[g.id]} % auf dem Glücksrad` : ''}</span>
                </div>
                <label class="players-select">
                  <span>Spieler</span>
                  ${isTeam(g)
                    ? '<span class="players-fixed" title="Teamspiele spielen alle Kinder zusammen">Alle</span>'
                    : `<select class="game-max" data-id="${g.id}" aria-label="Wie viele Kinder spielen gleichzeitig ${esc(g.name)}?">${options}</select>`}
                </label>
                <button class="team-toggle ${isTeam(g) ? 'on' : ''}" data-action="toggle-team" data-id="${g.id}" aria-pressed="${isTeam(g)}"
                  title="In zwei Teams spielen" aria-label="${esc(g.name)} als Teamspiel">
                  <span class="team-toggle-dots" aria-hidden="true">🔴🔵</span>
                  <span>Team</span>
                </button>
                <button class="switch ${g.active ? 'on' : ''}" role="switch" aria-checked="${g.active}" data-action="toggle-game" data-id="${g.id}"
                  aria-label="${esc(g.name)} ${g.active ? 'ausschalten' : 'anschalten'}">
                  <span class="switch-track"><span class="switch-knob"></span></span>
                  <span class="switch-label">${g.active ? 'An' : 'Aus'}</span>
                </button>
                <button class="icon-btn" data-action="delete-list-game" data-id="${g.id}" title="Spiel löschen" aria-label="${esc(g.name)} löschen">🗑️</button>
              </li>`;
          }).join('')}
        </ul>` : '<p class="muted">Noch keine Spiele. Füge oben ein Spiel hinzu.</p>'}

      <div class="muted note">
        <p><strong>Spieler:</strong> wie viele Kinder gleichzeitig spielen. Sind es mehr Kinder, wird in Gruppen gespielt, die gleich groß ausgelost werden. Jede Gruppe bekommt ihre eigenen Punkte.</p>
        <p><strong>Team:</strong> Alle Kinder spielen zusammen, ausgelost in Team Rot und Team Blau. Das Gewinnerteam bekommt die Punkte für den 1. Platz, das andere Team die für den 2. Platz. Bei Unentschieden bekommen alle die Punkte für den 2. Platz.</p>
        <p><strong>1 (Bonus):</strong> Nur das Kind, das dran ist, spielt. Geschafft gibt 1 Punkt, oder 2 Punkte, wenn es mehr als 3 Punkte hinter dem Vorletzten liegt.</p>
        <p><strong>Glücksrad:</strong> Spiele, die aus sind, kommen nicht aufs Rad. Jedes Mal, wenn ein Spiel gespielt wurde, wird sein Feld halb so groß, bis alle Spiele einmal dran waren. Bonusspiele sind halb so oft dran, aber öfter, wenn das Kind, das dran ist, weit hinten liegt.</p>
      </div>
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

// ---------- Renaming a game in the list ----------
let renamingGameId = null; // list game whose name is being edited

function startRenameGame(id) {
  renamingGameId = id;
  renderGameList();
  const input = document.querySelector('.rename-input');
  input?.focus();
  input?.select();
}

function cancelRenameGame() {
  if (!renamingGameId) return;
  const id = renamingGameId;
  renamingGameId = null;
  renderGameList();
  document.querySelector(`.rename-btn[data-id="${id}"]`)?.focus();
}

// Saves the new name. The game's past results and a running game get the new
// name too, so "x-mal gespielt" and the history stay together.
function saveRenameGame() {
  const input = document.querySelector('.rename-input');
  const g = gameById(renamingGameId);
  if (!input || !g) return cancelRenameGame();
  const name = input.value.trim();
  if (!name || name === g.name) return cancelRenameGame();
  if (state.gameList.some((x) => x !== g && x.name.toLowerCase() === name.toLowerCase())) {
    const errorEl = document.getElementById('games-error');
    errorEl.textContent = `„${name}“ ist schon in der Liste.`;
    errorEl.hidden = false;
    input.focus();
    return;
  }
  const oldName = g.name.toLowerCase();
  const sameGame = (x) => x.gameId === g.id || (!x.gameId && x.name.toLowerCase() === oldName);
  state.games.filter(sameGame).forEach((x) => { x.name = name; });
  if (state.current && sameGame(state.current)) state.current.name = name;
  g.name = name;
  saveState();
  cancelRenameGame();
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
        ${nextStepButton()}
        <h2>Gespielt <span class="muted">${state.games.length}</span></h2>
        ${history.length ? `
          <ul class="history">
            ${history.map((g) => {
              const groups = gameGroups(g);
              let meta;
              let link = '';
              if (g.bonus) {
                const kidId = g.participants[0];
                const pts = g.results[kidId] || 0;
                meta = `<span>⭐ ${esc(kidById(kidId)?.name || '')} ${pts ? `geschafft +${pts}` : 'nicht geschafft'}</span>`;
                link = `<a class="icon-btn" href="#/bonus/${g.id}" title="Ergebnis zeigen" aria-label="Ergebnis von ${esc(g.name)} zeigen">⭐</a>`;
              } else if (g.team && g.teams) {
                meta = g.teamWinner === 'draw'
                  ? '<span>🔴🔵 Unentschieden</span>'
                  : `<span>${TEAMS[g.teamWinner].icon} ${TEAMS[g.teamWinner].name} gewinnt</span>`;
                link = `<a class="icon-btn" href="#/team/${g.id}" title="Ergebnis zeigen" aria-label="Ergebnis von ${esc(g.name)} zeigen">🏆</a>`;
              } else {
                // One podium per group: show each group's winners (groups aren't compared).
                const podium = groups.length > 1
                  ? groups.flatMap((grp) => ranked(grp.results, grp.participants).filter((r) => r.points > 0 && r.rank === 1))
                  : ranked(g.results, g.participants).filter((r) => r.points > 0).slice(0, 3);
                meta = podium.length
                  ? podium.map((r) => `<span>${MEDALS[r.rank] || ''} ${esc(r.kid.name)} +${r.points}</span>`).join('')
                  : `<span>${kidsLabel(g.participants.length)}, keine Punkte</span>`;
                if (groups.length > 1) meta = `<span>${groups.length} Gruppen</span>${meta}`;
                if (podium.length) link = `<a class="icon-btn" href="#/podium/${g.id}/1" title="Siegertreppchen zeigen" aria-label="Siegertreppchen für ${esc(g.name)} zeigen">🏆</a>`;
              }
              return `
                <li class="history-row">
                  <div class="history-main">
                    <div class="history-name">${esc(g.name)}</div>
                    <div class="history-meta">${meta}</div>
                  </div>
                  <div class="history-actions">
                    ${link}
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

// "Mia sucht das Spiel aus" under the title of the game-picking screens.
function pickerLine() {
  const kid = turnKid();
  return kid
    ? `<p class="picker-line" style="${kidStyle(kid)}"><span class="picker-avatar">${kid.avatar}</span><span><strong>${esc(kid.name)}</strong> sucht das Spiel aus</span></p>`
    : '';
}

// Picking a game is only possible from a round, when it's someone's turn.
function canPickGame() {
  return !state.current && !state.partyOver && Boolean(turnKid());
}

function renderNewGame() {
  if (!canPickGame()) {
    location.replace('#/' + playPath());
    return;
  }
  if (!draft) draft = { gameId: null, participants: state.kids.map((k) => k.id) };
  draft.participants = draft.participants.filter((id) => kidById(id));
  const choices = state.gameList.filter((g) => g.active);
  if (draft.gameId && !choices.some((g) => g.id === draft.gameId)) draft.gameId = null;
  const chosen = draft.gameId && gameById(draft.gameId);
  const preview = !chosen || isBonus(chosen) ? ''
    : isTeam(chosen) ? '🔴🔵 Teamspiel: Die Kinder werden in Team Rot und Team Blau ausgelost.'
    : groupPreview(draft.participants.length, Number(chosen.maxPlayers) || 0);

  app.innerHTML = `
    <section class="screen">
      <div class="game-head">
        <div>
          <h1 class="game-name">Neues Spiel</h1>
          ${pickerLine()}
        </div>
        <div class="head-actions">
          <p class="form-error" id="game-error" hidden></p>
          <button class="btn big" data-action="start-game">Spiel starten</button>
        </div>
      </div>

      <div class="name-card">
        <div class="pick-head">
          <h2>Was spielen wir?</h2>
          ${choices.length ? '<button class="btn primary random-btn" data-default data-action="go-wheel">🎲 Zufall</button>' : ''}
        </div>
        ${choices.length ? `
          <div class="game-tiles">
            ${choices.map((g) => `
              <button class="game-tile ${g.id === draft.gameId ? 'on' : ''}" data-action="pick-game" data-id="${g.id}" aria-pressed="${g.id === draft.gameId}">
                <span class="game-tile-name">${esc(g.name)}</span>
                ${isBonus(g) ? '<span class="bonus-badge">⭐ Bonusspiel</span>' : ''}
                ${timesPlayed(g.name) ? '<span class="game-tile-meta">Schon gespielt</span>' : ''}
              </button>`).join('')}
          </div>` : `
          <p class="muted">Gerade ist kein Spiel an.</p>
          <a class="btn" href="#/games">Spiele anschalten</a>`}
      </div>

      ${chosen && isBonus(chosen) ? bonusNote() : `
      <div class="section-head">
        <h2>Wer spielt mit? <span class="muted">${draft.participants.length} von ${state.kids.length}</span></h2>
        <div class="section-tools">
          <button class="btn small-btn" data-action="select-all">Alle</button>
          <button class="btn small-btn" data-action="select-none">Keiner</button>
        </div>
      </div>
      ${preview ? `<p class="group-preview">${preview}</p>` : ''}
      <div class="player-picker">
        ${state.kids.map((k) => `
          <button class="player-toggle ${draft.participants.includes(k.id) ? 'on' : ''}" data-action="toggle-player" data-id="${k.id}"
            style="${kidStyle(k)}" aria-pressed="${draft.participants.includes(k.id)}">
            <span class="toggle-avatar">${k.avatar}</span>
            <span class="toggle-name">${esc(k.name)}</span>
          </button>`).join('')}
      </div>`}
    </section>`;
}

// Explains a bonus game for the kid whose turn it is.
function bonusNote() {
  const kid = turnKid();
  if (!kid) return '';
  const pts = bonusPoints(kid.id);
  return `
    <div class="bonus-note" style="${kidStyle(kid)}">
      <span class="bonus-badge big">⭐ Bonusspiel: ein Sonderpreis!</span>
      <p>Nur <strong>${esc(kid.name)}</strong> spielt. Geschafft gibt ${pointsText(pts)}${pts === 2 ? ', weil du gerade weit hinten liegst' : ''}. Nicht geschafft gibt 0 Punkte.</p>
    </div>`;
}

// ---------- Wheel screen ----------
const polar = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)]; // 0° at the top, clockwise
};

function renderWheel() {
  if (!canPickGame()) {
    location.replace('#/' + playPath());
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
        font-size="${size.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${isBonus(s.game) ? '⭐ ' : ''}${esc(s.game.name)}</text>`;
    return `<g class="wheel-slice" data-id="${s.game.id}">${shape}${label}</g>`;
  }).join('');

  app.innerHTML = `
    <section class="screen fit wheel-screen">
      <div class="wheel-head">
        <h1>Glücksrad</h1>
        ${pickerLine().replace('sucht das Spiel aus', 'drückt auf Stopp')}
      </div>
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
          <p class="wheel-key-hint" id="wheel-key-hint">oder Leertaste drücken</p>
          <div class="wheel-result" id="wheel-result" hidden>
            <span class="wheel-result-label">Als Nächstes spielen wir</span>
            <span class="wheel-result-name" id="wheel-result-name"></span>
            <span class="bonus-badge big" id="wheel-bonus" hidden>⭐ Bonusspiel: ein Sonderpreis!</span>
            <span class="wheel-result-note" id="wheel-note"></span>
            <div class="wheel-result-actions">
              <button class="btn primary big" data-default data-action="wheel-start-all">Mit allen Kindern starten</button>
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
    // Tick whenever a new slice passes the pointer, like a real prize wheel.
    const local = ((360 - wheel.angle) % 360 + 360) % 360;
    const sliceIndex = wheel.slices.findIndex((s) => local >= s.start && local < s.end);
    if (sliceIndex !== wheel.lastSlice) {
      if (wheel.lastSlice !== undefined && wheel.slices.length > 1) Sound.tick();
      wheel.lastSlice = sliceIndex;
    }
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
  Sound.brake();
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
  wheel.doneAt = performance.now();
  Sound.picked();
  cancelAnimationFrame(wheel.raf);

  document.querySelectorAll('.wheel-slice').forEach((el) => el.classList.toggle('dim', el.dataset.id !== game.id));
  document.getElementById('wheel-status').hidden = true;
  document.getElementById('wheel-stop').hidden = true;
  document.getElementById('wheel-key-hint').hidden = true;
  document.getElementById('wheel-result-name').textContent = game.name;
  const note = document.getElementById('wheel-note');
  if (isBonus(game)) {
    const kid = turnKid();
    const pts = bonusPoints(kid.id);
    document.getElementById('wheel-bonus').hidden = false;
    note.textContent = `Nur ${kid.name} spielt. Geschafft gibt ${pointsText(pts)}.`;
    document.querySelector('[data-action="wheel-start-all"]').textContent = 'Bonusspiel starten';
    document.querySelector('[data-action="wheel-choose-kids"]').hidden = true;
  } else {
    note.textContent = isTeam(game)
      ? '🔴🔵 Teamspiel: Rot gegen Blau'
      : groupPreview(state.kids.length, Number(game.maxPlayers) || 0);
  }
  document.getElementById('wheel-result').hidden = false;
  document.querySelector('[data-action="wheel-start-all"]')?.focus();
}

function renderGameInProgress() {
  const g = state.current;
  g.participants = g.participants.filter((id) => kidById(id));
  if (g.bonus) {
    renderBonusInProgress();
    return;
  }
  if (g.team) {
    renderTeamInProgress();
    return;
  }
  const groups = g.groups || [g.participants];
  const index = g.groupIndex || 0;
  const multi = groups.length > 1;
  const strip = multi ? `
    <ol class="group-strip" aria-label="Gruppen">
      ${groups.map((grp, i) => `
        <li class="group-chip ${i < index ? 'done' : i === index ? 'now' : ''}">
          <span class="group-label">Gruppe ${i + 1}${i < index ? ' ✓' : ''}</span>
          <span class="group-avatars">${grp.map((id) => kidById(id)?.avatar || '').join('')}</span>
        </li>`).join('')}
    </ol>` : '';

  app.innerHTML = `
    <section class="screen fit">
      <div class="game-head">
        <div>
          <h1 class="game-name">${esc(g.name)}</h1>
          <p class="hint">${multi ? `<strong>Gruppe ${index + 1} von ${groups.length}:</strong> ${joinNames(g.participants)} ${g.participants.length === 1 ? 'spielt' : 'spielen'}. ` : ''}Tippe auf eine Medaille oder auf − und +.</p>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="cancel-game">Abbrechen</button>
          <button class="btn primary big" data-default data-action="finish-game">${multi && index < groups.length - 1 ? 'Gruppe fertig' : 'Spiel fertig'}</button>
        </div>
      </div>
      ${strip}

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

// A bonus game: only the picking kid plays, and the result is just "geschafft" or not.
function renderBonusInProgress() {
  const g = state.current;
  const kid = kidById(g.participants[0]);
  if (!kid) {
    state.current = null;
    saveState();
    location.replace('#/round');
    return;
  }
  const pts = bonusPoints(kid.id);
  app.innerHTML = `
    <section class="screen fit round-screen">
      <span class="bonus-badge big">⭐ Bonusspiel</span>
      <div class="round-number">${esc(g.name)}</div>
      <div class="round-kid" style="${kidStyle(kid)}">
        <span class="round-avatar">${kid.avatar}</span>
        <span class="round-name">${esc(kid.name)}</span>
      </div>
      <p class="round-text">${pts === 2
        ? 'Wenn du es schaffst, bekommst du 2 Punkte, weil du gerade weit hinten liegst!'
        : 'Wenn du es schaffst, bekommst du 1 Punkt.'}</p>
      <div class="round-actions">
        <button class="btn primary huge" data-default data-action="bonus-result" data-ok="1">Geschafft!</button>
        <button class="btn huge" data-action="bonus-result" data-ok="0">Nicht geschafft</button>
      </div>
      <button class="btn small-btn skip-btn" data-action="cancel-game">Abbrechen</button>
    </section>`;
}

// The two teams side by side: Rot on the left, Blau on the right.
// `results`/`winner` are given on the result screen to show points and the winner.
function teamPanels(teams, { results = null, winner = null } = {}) {
  const panel = (team) => {
    const t = TEAMS[team];
    const won = winner === team;
    return `
      <div class="team-panel team-${team} ${won ? 'won' : ''} ${winner && winner !== 'draw' && !won ? 'lost' : ''}" style="--team:${t.color}">
        <div class="team-head">
          <span class="team-name">${t.icon} ${t.name}</span>
          ${won ? '<span class="team-crown">👑 Sieger</span>' : ''}
        </div>
        <ul class="team-kids">
          ${teams[team].filter((id) => kidById(id)).map((id) => {
            const k = kidById(id);
            return `
              <li class="team-kid" style="${kidStyle(k)}">
                <span class="team-kid-avatar">${k.avatar}</span>
                <span class="team-kid-name">${esc(k.name)}</span>
                ${results ? `<span class="team-kid-points">+${results[id] || 0}</span>` : ''}
              </li>`;
          }).join('')}
        </ul>
      </div>`;
  };
  return `<div class="team-split">${panel('red')}<div class="team-vs">gegen</div>${panel('blue')}</div>`;
}

// A team game in progress: the teams, and who won. No default button on purpose:
// the winner is always a deliberate choice.
function renderTeamInProgress() {
  const g = state.current;
  ['red', 'blue'].forEach((team) => { g.teams[team] = g.teams[team].filter((id) => kidById(id)); });
  app.innerHTML = `
    <section class="screen fit">
      <div class="game-head">
        <div>
          <h1 class="game-name">${esc(g.name)}</h1>
          <p class="hint">Teamspiel: Rot gegen Blau. Wer hat gewonnen?</p>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="cancel-game">Abbrechen</button>
          <button class="btn" data-action="team-shuffle">🔀 Neu mischen</button>
        </div>
      </div>
      ${teamPanels(g.teams)}
      <div class="actions center team-actions">
        <button class="btn huge team-btn" style="--team:${TEAMS.red.color}" data-action="team-win" data-team="red">${TEAMS.red.icon} Team Rot gewinnt</button>
        <button class="btn huge" data-action="team-win" data-team="draw">Unentschieden</button>
        <button class="btn huge team-btn" style="--team:${TEAMS.blue.color}" data-action="team-win" data-team="blue">${TEAMS.blue.icon} Team Blau gewinnt</button>
      </div>
    </section>`;
}

// Result of a team game: "Sieger Team Rot", then both teams with their points.
function renderTeamResult(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game || !game.teams) {
    location.replace('#/scores');
    return;
  }
  const winner = game.teamWinner;
  app.innerHTML = `
    <section class="screen fit">
      <div class="team-result-head">
        <h1>${esc(game.name)}</h1>
        <p class="team-outcome">${winner === 'draw' ? 'Unentschieden!' : `${TEAMS[winner].icon} ${TEAMS[winner].name} hat gewonnen!`}</p>
      </div>
      ${teamPanels(game.teams, { results: game.results, winner })}
      <div class="actions center">${resultButtons()}</div>
    </section>`;
  if (winner && winner !== 'draw') {
    const t = TEAMS[winner];
    // Fanfare for the winners first; a soft "oh" only once the losing team fades.
    showWinnerPop([{ name: t.name, color: t.color }], () => {
      confetti();
      setTimeout(() => Sound.oh(), 500);
    });
  } else {
    Sound.picked();
  }
}

function startGame() {
  const errorEl = document.getElementById('game-error');
  const game = draft.gameId && gameById(draft.gameId);
  if (!game) {
    errorEl.textContent = 'Such zuerst ein Spiel aus.';
    errorEl.hidden = false;
    return;
  }
  if (!isBonus(game) && !draft.participants.length) {
    errorEl.textContent = 'Wähle mindestens ein Kind aus.';
    errorEl.hidden = false;
    return;
  }
  if (isTeam(game) && draft.participants.length < 2) {
    errorEl.textContent = 'Für ein Teamspiel braucht ihr mindestens 2 Kinder.';
    errorEl.hidden = false;
    return;
  }
  beginGame(game, draft.participants);
}

// current: { gameId, name, bonus, groups: [[kidId]], groupIndex, done: [finished groups],
//            participants/results/medals of the group playing now,
//            teams: { red, blue } and teamWinner for team games }
function beginGame(game, participantIds) {
  const bonus = isBonus(game);
  const team = isTeam(game);
  // Keep players in the same order as the setup list.
  const ordered = state.kids.map((k) => k.id).filter((id) => participantIds.includes(id));
  const groups = bonus ? [[turnKid().id]]
    : team ? [ordered]
    : splitGroups(ordered, Number(game.maxPlayers) || 0);
  state.current = {
    gameId: game.id,
    name: game.name,
    bonus,
    team,
    teams: team ? splitTeams(ordered) : null,
    groups,
    groupIndex: 0,
    done: [],
    participants: groups[0],
    results: zeroResults(groups[0]),
    medals: {},
  };
  draft = null;
  saveState();
  go('game');
}

function finishGame() {
  const g = state.current;
  if (!g.groups) Object.assign(g, { groups: [g.participants], groupIndex: 0, done: [] }); // started before groups existed
  const awarded = g.participants.some((id) => g.results[id] > 0);
  const moreGroups = g.groupIndex < g.groups.length - 1;
  if (!g.bonus && !g.team && !awarded && !confirm(`In ${moreGroups ? 'dieser Gruppe' : 'diesem Spiel'} hat niemand Punkte bekommen. Trotzdem weiter?`)) return;
  g.done.push({ participants: g.participants, results: g.results, medals: g.medals });

  // More groups to go: show this group's podium, then the next group plays.
  if (moreGroups) {
    g.groupIndex++;
    g.participants = g.groups[g.groupIndex].filter((id) => kidById(id));
    g.results = zeroResults(g.participants);
    g.medals = {};
    saveState();
    go('podium/current/' + g.done.length);
    return;
  }

  // Last group done: save the whole game. Points of all groups add up per kid.
  const results = {};
  g.done.forEach((grp) => Object.entries(grp.results).forEach(([id, pts]) => { results[id] = (results[id] || 0) + pts; }));
  const game = {
    id: uid(),
    gameId: g.gameId,
    name: g.name,
    bonus: Boolean(g.bonus),
    team: Boolean(g.team),
    teams: g.teams || null,
    teamWinner: g.teamWinner || null,
    participants: g.done.flatMap((grp) => grp.participants),
    results,
    medals: {},
    groups: g.done,
    playedAt: new Date().toISOString(),
    pickedBy: turnKid()?.id || null,
  };
  state.games.push(game);
  state.current = null;
  // The picking kid's round is done: the next kid's turn (or the end of the pass).
  state.round.number++;
  state.round.turn++;
  // Count the round for the wheel (falls back to the name for games started before gameId existed).
  const listGame = gameById(g.gameId) || state.gameList.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
  if (listGame) {
    listGame.played = (listGame.played || 0) + 1;
    normalizeRounds();
  }
  saveState();
  if (game.bonus) go('bonus/' + game.id);
  else if (game.team) go('team/' + game.id);
  else go(awarded ? `podium/${game.id}/${game.groups.length}` : 'scores');
}

// Older saved games have no groups: treat them as one group.
function gameGroups(game) {
  return game.groups || [{ participants: game.participants, results: game.results, medals: game.medals }];
}

// ---------- Round screen ----------
function renderRound() {
  if (state.current || state.partyOver) {
    location.replace('#/' + playPath());
    return;
  }
  const kid = turnKid();
  const order = state.kids.map((k, i) => {
    const status = i < state.round.turn ? 'done' : i === state.round.turn ? 'now' : 'later';
    return `
      <li class="turn-kid ${status}" style="${kidStyle(k)}" title="${esc(k.name)}">
        <span class="turn-avatar">${k.avatar}</span>
        ${status === 'done' ? '<span class="turn-check" aria-label="war schon dran">✓</span>' : ''}
      </li>`;
  }).join('');

  app.innerHTML = kid ? `
    <section class="screen fit round-screen">
      <div class="round-number">Runde ${state.round.number}</div>
      <div class="round-kid" style="${kidStyle(kid)}">
        <span class="round-avatar">${kid.avatar}</span>
        <span class="round-name">${esc(kid.name)}</span>
      </div>
      <p class="round-text">Du darfst das nächste Spiel aussuchen!</p>
      <div class="round-actions">
        <button class="btn huge" data-action="go-game">Spiel aussuchen</button>
        <button class="btn primary random-btn huge" data-default data-action="go-wheel">🎲 Zufall</button>
      </div>
      <ol class="turn-order" aria-label="Reihenfolge">${order}</ol>
      <button class="btn small-btn skip-btn" data-action="round-skip">Überspringen</button>
    </section>` : `
    <section class="screen fit round-screen">
      <div class="round-number">Alle waren dran!</div>
      <ol class="turn-order big" aria-label="Reihenfolge">${order}</ol>
      <p class="round-text">Spielen wir noch eine Runde für alle, oder ist die Party vorbei?</p>
      <div class="round-actions">
        <button class="btn primary huge" data-default data-action="round-continue">Noch eine Runde für alle</button>
        <button class="btn huge" data-action="party-finish">Party beenden</button>
      </div>
    </section>`;
  app.querySelector('[data-default]')?.focus();
  if (kid) Sound.turn();
  else Sound.picked();
}

// ---------- Podium screens ----------
function renderGamePodium(gameId, groupNo) {
  // A group of the running game just finished: the only way on is the next group.
  if (gameId === 'current') {
    const g = state.current;
    const n = Number(groupNo);
    const grp = g?.done?.[n - 1];
    if (!grp) {
      location.replace('#/' + playPath());
      return;
    }
    renderPodium(g.name, ranked(grp.results, grp.participants), `
      <button class="btn primary big" data-default data-action="go-game">Nächste Gruppe</button>`,
      `<p class="podium-sub">Gruppe ${n} von ${g.groups.length}. Als Nächstes: ${joinNames(g.participants)}</p>`);
    return;
  }

  const game = state.games.find((g) => g.id === gameId);
  if (!game) {
    location.replace('#/scores');
    return;
  }
  if (game.bonus) {
    location.replace('#/bonus/' + game.id);
    return;
  }
  const groups = gameGroups(game);
  const n = Math.min(groups.length, Math.max(1, Number(groupNo) || groups.length));
  const grp = groups[n - 1];
  const tabs = groups.length > 1 ? `
    <nav class="group-tabs" aria-label="Gruppen">
      ${groups.map((_, i) => `<a class="group-tab ${i + 1 === n ? 'on' : ''}" href="#/podium/${game.id}/${i + 1}">Gruppe ${i + 1}</a>`).join('')}
    </nav>` : '';
  renderPodium(game.name, ranked(grp.results, grp.participants), `
    ${resultButtons()}`, tabs);
}

// Result of a bonus game: one kid, "geschafft" or not.
function renderBonusResult(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  const kid = game && kidById(game.participants[0]);
  if (!kid) {
    location.replace('#/scores');
    return;
  }
  const pts = game.results[kid.id] || 0;
  app.innerHTML = `
    <section class="screen fit round-screen">
      <span class="bonus-badge big">⭐ Bonusspiel</span>
      <div class="round-number">${esc(game.name)}</div>
      <div class="round-kid" style="${kidStyle(kid)}">
        <span class="round-avatar">${kid.avatar}</span>
        <span class="round-name">${esc(kid.name)}</span>
      </div>
      <p class="bonus-outcome ${pts ? 'won' : ''}">${pts ? `Geschafft! +${pointsText(pts)}` : 'Leider nicht geschafft.'}</p>
      <div class="round-actions">
        ${resultButtons('huge')}
      </div>
    </section>`;
  if (pts) {
    confetti();
    Sound.success();
  } else {
    Sound.oh();
  }
}

// The end of the party: the same podium, with everyone's total points.
function renderFinal() {
  if (!state.partyOver) {
    location.replace('#/' + playPath());
    return;
  }
  renderPodium('Endstand', ranked(totals(), state.kids.map((k) => k.id)), `
    <button class="btn big" data-action="party-resume">Weiterspielen</button>
    <button class="btn primary big" data-default data-action="go-scores">Zum Punktestand</button>
    <button class="btn big danger" data-action="reset">Neue Party starten</button>`);
}

// Kids with points who rank 1st–3rd stand on the podium (ties share a step);
// everyone else stands on the ground, alternating left/right so the
// better-placed kids are closest to the podium.
function renderPodium(title, results, buttonsHtml, subtitleHtml = '') {
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
      <h1>${esc(title)}</h1>
      ${subtitleHtml}

      <div class="stage" id="stage">
        <div class="ground-group left">${left.map((r) => kidHtml(r, true)).join('')}</div>
        <div class="podium">${stepHtml(2)}${stepHtml(1)}${stepHtml(3)}</div>
        <div class="ground-group right">${right.map((r) => kidHtml(r, true)).join('')}</div>
      </div>

      <div class="actions center">${buttonsHtml}</div>
    </section>`;

  const reveal = () => {
    document.getElementById('stage')?.classList.add('reveal');
    confetti();
    Sound.podium();
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
  Sound.fanfare();
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

// ---------- Intro ----------
// Plays when the page opens and when the logo is clicked. It ends on a start
// screen; the next click (or space/Enter) leads to the Kinder screen. A click
// during the animation skips to the start screen.
const INTRO_READY_MS = 4000; // when the "start" prompt appears (matches the CSS timeline)
const INTRO_MUSIC_AT_MS = 1600; // the music kicks in when the title words slam together
let intro = null; // { el, ready, timers, stopSound } while the intro is showing

// The kids' own avatars circle the title; before a party, a random selection.
function introGuests() {
  if (state.kids.length) return state.kids.map((k) => ({ avatar: k.avatar, color: k.color }));
  return [...AVATARS].sort(() => Math.random() - 0.5).slice(0, 10)
    .map((avatar, i) => ({ avatar, color: KID_COLORS[i % KID_COLORS.length] }));
}

function showIntro() {
  if (intro) return;
  stopWheel();
  document.querySelector('.winner-pop')?.remove();
  const guests = introGuests();
  const ring = guests.map((g, i) => {
    const a = (i / guests.length) * 2 * Math.PI;
    const x = 50 + 43 * Math.sin(a);
    const y = 50 - 41 * Math.cos(a);
    const vars = `--kid:${g.color};--x:${x}vw;--y:${y}vh;--dx:${50 - x}vw;--dy:${50 - y}vh;--d:${(1.9 + i * 0.05).toFixed(2)}s`;
    return `<span class="intro-guest" style="${vars}" aria-hidden="true"><span>${esc(g.avatar)}</span></span>`;
  }).join('');

  const el = document.createElement('div');
  el.className = 'intro' + (guests.length > 12 ? ' crowded' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Birthday Battle');
  el.innerHTML = `
    <div class="intro-beam left"></div>
    <div class="intro-beam right"></div>
    ${ring}
    <div class="intro-center">
      <div class="intro-cake" aria-hidden="true">🎂</div>
      <h1 class="intro-title"><span class="intro-word w1">Birthday</span> <span class="intro-word w2">Battle</span></h1>
      <p class="intro-tagline">Die große Spiele-Party!</p>
      <p class="intro-start">Drück irgendwo zum Starten</p>
    </div>
    <div class="intro-flash"></div>`;
  el.addEventListener('click', advanceIntro);
  document.body.appendChild(el);

  intro = {
    el,
    ready: false,
    startedAt: performance.now(),
    stopSound: Sound.intro(),
    timers: [setTimeout(confetti, 2400), setTimeout(introReady, INTRO_READY_MS)],
  };
  Sound.musicStart(INTRO_MUSIC_AT_MS / 1000);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) introReady();
}

function introReady() {
  if (!intro || intro.ready) return;
  intro.ready = true;
  intro.el.classList.add('ready');
}

function advanceIntro() {
  if (!intro) return;
  if (!intro.ready) {
    intro.timers.forEach(clearTimeout);
    intro.stopSound();
    // Start the music now if it hadn't begun yet (or couldn't play before this first press).
    if (performance.now() - intro.startedAt < INTRO_MUSIC_AT_MS || !Sound.musicPlaying) Sound.musicStart(0);
    intro.el.classList.add('skip');
    introReady();
    return;
  }
  const { el } = intro;
  intro = null;
  Sound.musicStop(0.8);
  Sound.click();
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 450);
  go('setup');
}

document.getElementById('brand').addEventListener('click', (e) => {
  e.currentTarget.blur();
  Sound.click();
  showIntro();
});

// ---------- Sound toggle ----------
const soundToggle = document.getElementById('sound-toggle');
function renderSoundToggle() {
  soundToggle.textContent = Sound.enabled ? '🔊' : '🔇';
  soundToggle.title = Sound.enabled ? 'Ton ausschalten' : 'Ton anschalten';
  soundToggle.setAttribute('aria-label', soundToggle.title);
  soundToggle.setAttribute('aria-pressed', String(!Sound.enabled));
}
soundToggle.addEventListener('click', () => {
  Sound.toggle();
  renderSoundToggle();
  soundToggle.blur(); // keep the space bar for the screen's default button
});
renderSoundToggle();

// Buttons with a sound of their own (instead of the normal click).
const OWN_SOUND_ACTIONS = new Set(['wheel-stop', 'team-shuffle']);

// ---------- Events ----------
document.addEventListener('click', (e) => {
  const navLink = e.target.closest('.nav-link');
  if (navLink?.classList.contains('disabled')) {
    e.preventDefault();
    return;
  }
  if (navLink) Sound.click();

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id } = el.dataset;
  if (!OWN_SOUND_ACTIONS.has(action)) Sound.click();

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
    case 'rename-game':
      startRenameGame(id);
      break;
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
    case 'go-round':
      go('round');
      break;
    case 'go-final':
      go('final');
      break;

    // Rounds
    case 'round-skip': {
      const kid = turnKid();
      if (kid && confirm(`${kid.name} überspringen? Dann ist das nächste Kind dran.`)) {
        state.round.turn++;
        saveState();
        renderRound();
      }
      break;
    }
    case 'round-continue':
      state.round.turn = 0;
      saveState();
      renderRound();
      break;
    case 'party-finish':
      state.partyOver = true;
      saveState();
      go('final');
      break;
    case 'party-resume':
      state.partyOver = false;
      state.round.turn = 0;
      saveState();
      go('round');
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
    case 'team-win': {
      const g = state.current;
      if (g?.team) {
        g.teamWinner = el.dataset.team;
        g.participants = [...g.teams.red, ...g.teams.blue];
        g.results = teamResults(g.teams, g.teamWinner);
        finishGame();
      }
      break;
    }
    case 'team-shuffle': {
      const g = state.current;
      if (g?.team) {
        g.teams = splitTeams([...g.teams.red, ...g.teams.blue]);
        Sound.shuffle();
        saveState();
        renderTeamInProgress();
      }
      break;
    }
    case 'toggle-team': {
      const g = gameById(id);
      if (g) {
        g.team = !g.team;
        if (g.team && isBonus({ maxPlayers: g.maxPlayers })) g.maxPlayers = null; // a team game can't be a bonus game
        saveState();
        renderGameList();
        document.querySelector(`[data-action="toggle-team"][data-id="${id}"]`)?.focus();
      }
      break;
    }
    case 'bonus-result': {
      const g = state.current;
      const kidId = g?.participants[0];
      if (kidId) {
        g.results[kidId] = el.dataset.ok === '1' ? bonusPoints(kidId) : 0;
        finishGame();
      }
      break;
    }
    case 'cancel-game':
      if (confirm(`„${state.current.name}“ abbrechen? Die Punkte aus diesem Spiel werden nicht gespeichert.`)) {
        state.current = null;
        saveState();
        go('round'); // the same kid picks again
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('game-max')) {
    const g = gameById(e.target.dataset.id);
    if (g) {
      Sound.click();
      g.maxPlayers = e.target.value ? Number(e.target.value) : null;
      saveState();
      renderGameList();
      document.querySelector(`.game-max[data-id="${g.id}"]`)?.focus();
    }
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'add-game') {
    e.preventDefault();
    Sound.click();
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
  } else if (t.id === 'new-game' || t.classList.contains('rename-input')) {
    document.getElementById('games-error').hidden = true;
  }
});

// Leaving the rename field saves it (unless Enter/Escape already finished it).
document.addEventListener('focusout', (e) => {
  if (e.target.classList?.contains('rename-input') && renamingGameId && e.target.isConnected) saveRenameGame();
});

// ---------- Space bar = the screen's default button ----------
// Every screen marks its default button (filled yellow) with data-default; the space
// bar presses it wherever the focus is. Not while typing in a field or while the
// avatar picker is open.
const WHEEL_RESULT_SPACE_DELAY_MS = 1500; // ignore space right after "Stopp" so hammering it doesn't start the game
const isSpace = (e) => e.key === ' ' || e.code === 'Space';

function handleSpace(e) {
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.overlay')) return;
  e.preventDefault(); // also stops the focused button from being pressed natively
  if (e.repeat) return;

  // "Sieger" announcement showing: space just closes it.
  const pop = document.querySelector('.winner-pop:not(.leaving)');
  if (pop) {
    pop.click();
    return;
  }
  // Wheel: space is "Stopp" while it spins; after it stops, the start button
  // works only after a short pause.
  if (wheel) {
    if (wheel.phase !== 'done') {
      pressWheelStop();
      return;
    }
    if (performance.now() - wheel.doneAt < WHEEL_RESULT_SPACE_DELAY_MS) return;
  }
  const button = app.querySelector('[data-default]:not([disabled]):not([hidden])');
  if (button) button.click();
}

// Keep the native "press focused button on space-up" from firing as well.
document.addEventListener('keyup', (e) => {
  if (isSpace(e) && !e.target.closest?.('input, textarea, select, [contenteditable]') && !document.querySelector('.overlay')) e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  if (intro) {
    if (isSpace(e) || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) advanceIntro();
    }
    return;
  }
  if (e.target.classList?.contains('rename-input') && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Enter') saveRenameGame();
    else cancelRenameGame();
    return;
  }
  if (isSpace(e)) {
    handleSpace(e);
    return;
  }
  if (e.key !== 'Enter') return;
  if (e.target.classList.contains('name-input')) {
    const inputs = [...document.querySelectorAll('.name-input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else finishSetup();
  }
});

render();
showIntro();
