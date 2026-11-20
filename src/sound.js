'use strict';

// Sound effects, synthesized with the Web Audio API: no sound files, works offline.
// The audio context is created on the first sound, which always follows a button
// press or key press, so browsers allow it to play.
const Sound = (() => {
  const STORAGE_KEY = 'birthday-battle-sound';
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (e) { /* storage unavailable */ }

  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let out = null; // while set, new sounds go to this gain node instead of master (so they can be cut off)

  function audio() {
    if (!enabled) return null;
    // Before the first click or key press the browser wouldn't play it anyway;
    // skip it rather than queue it up to play late.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One note with a quick fade in and out; optional pitch slide.
  function tone({ freq, type = 'sine', start = 0, dur = 0.15, vol = 0.4, slideTo = null }) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(out || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // A short burst of filtered noise (clicks, thuds).
  function noise({ start = 0, dur = 0.04, vol = 0.3, freq = 2500 }) {
    const c = audio();
    if (!c) return;
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + start;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(out || master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // A little melody: [frequency, ...] played one after another.
  function melody(freqs, { type = 'triangle', step = 0.09, vol = 0.3, start = 0 } = {}) {
    freqs.forEach((freq, i) => tone({ freq, type, start: start + i * step, dur: step * 1.8, vol }));
  }

  const C5 = 523, E5 = 659, G5 = 784, C6 = 1047, E6 = 1319, G4 = 392;
  let lastTick = 0;

  // ---- Intro music: an 8-bar party loop (C – Am – F – G), 140 BPM in eighth notes ----
  const midi = (m) => 440 * 2 ** ((m - 69) / 12);
  const STEP = 60 / 140 / 2; // one eighth note, in seconds
  const BASS = [48, 45, 41, 43, 48, 45, 41, 43]; // chord roots per bar
  const TUNE = [ // melody, one MIDI note per eighth (0 = rest)
    [79, 0, 79, 76, 84, 0, 79, 0],
    [81, 0, 81, 76, 84, 0, 81, 0],
    [77, 81, 84, 81, 86, 84, 81, 77],
    [79, 0, 83, 0, 86, 0, 83, 79],
    [79, 0, 79, 76, 84, 0, 88, 0],
    [86, 84, 81, 0, 84, 0, 81, 0],
    [77, 81, 84, 86, 88, 86, 84, 81],
    [83, 0, 86, 0, 84, 0, 0, 0],
  ];
  let music = null; // { bus, step, next, timer } while playing

  function musicStep(i, start) {
    const bar = Math.floor(i / 8) % TUNE.length;
    const s = i % 8;
    // Drums: kick on 1 and 3, snare on 2 and 4 (a fill at the end of the loop), hi-hat on every eighth.
    if (s === 0 || s === 4) tone({ freq: 130, type: 'sine', start, dur: 0.22, vol: 0.55, slideTo: 45 });
    if (s === 2 || s === 6 || (bar === TUNE.length - 1 && s >= 4)) noise({ start, dur: 0.12, vol: 0.18, freq: 1800 });
    noise({ start, dur: 0.03, vol: s % 2 ? 0.04 : 0.07, freq: 8000 });
    // Bass: bouncing between the root and its octave.
    const bass = midi(BASS[bar] + (s % 2 ? 12 : 0));
    tone({ freq: bass, type: 'triangle', start, dur: STEP * 0.85, vol: 0.28 });
    tone({ freq: bass, type: 'square', start, dur: STEP * 0.6, vol: 0.04 });
    // Melody: held until the next note.
    const note = TUNE[bar][s];
    if (note) {
      let rests = 0;
      while (s + rests + 1 < 8 && !TUNE[bar][s + rests + 1]) rests++;
      const dur = Math.min(0.7, STEP * (1 + rests) * 0.9);
      tone({ freq: midi(note), type: 'triangle', start, dur, vol: 0.2 });
      tone({ freq: midi(note), type: 'square', start, dur: dur * 0.8, vol: 0.035 });
    }
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      if (!enabled) this.musicStop(0.1);
      try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
      if (enabled) this.click();
      return enabled;
    },

    // Any button press.
    click() { tone({ freq: 620, type: 'triangle', dur: 0.07, vol: 0.3, slideTo: 900 }); },
    // A slice passing the wheel's pointer (at most one every 25 ms, so fast spins rattle).
    tick() {
      const now = performance.now();
      if (now - lastTick < 25) return;
      lastTick = now;
      noise({ dur: 0.025, vol: 0.35, freq: 3200 });
      tone({ freq: 1700, type: 'square', dur: 0.02, vol: 0.05 });
    },
    // "Stopp!" pressed: a brake thud.
    brake() {
      tone({ freq: 220, type: 'triangle', dur: 0.25, vol: 0.5, slideTo: 90 });
      noise({ dur: 0.12, vol: 0.25, freq: 700 });
    },
    // The wheel has picked a game.
    picked() { melody([C5, E5, G5, C6], { step: 0.085, vol: 0.3 }); },
    // Big "Sieger" announcement.
    fanfare() {
      melody([G4, C5, E5, G5], { type: 'square', step: 0.11, vol: 0.12 });
      tone({ freq: C6, type: 'square', start: 0.46, dur: 0.7, vol: 0.14 });
      tone({ freq: G5, type: 'triangle', start: 0.46, dur: 0.7, vol: 0.2 });
      tone({ freq: E5, type: 'triangle', start: 0.46, dur: 0.7, vol: 0.2 });
    },
    // The podium steps rising (3rd, 2nd, 1st), timed with the CSS animation.
    podium() {
      [0, 0.4, 0.8].forEach((start, i) => tone({ freq: 260 + i * 90, type: 'sine', start, dur: 0.5, vol: 0.22, slideTo: 520 + i * 180 }));
      melody([E6], { start: 1.3, step: 0.1, vol: 0.18 });
    },
    // Something worked: bonus "Geschafft!".
    success() { melody([E5, G5, C6, E6], { step: 0.075, vol: 0.3 }); },
    // Something didn't work out: a soft, friendly "oh".
    oh() {
      tone({ freq: 440, type: 'sine', dur: 0.28, vol: 0.22, slideTo: 400 });
      tone({ freq: 392, type: 'sine', start: 0.24, dur: 0.45, vol: 0.2, slideTo: 330 });
    },
    // A new kid's turn on the round screen: "ding-dong".
    turn() {
      tone({ freq: G5, type: 'sine', dur: 0.35, vol: 0.3 });
      tone({ freq: E5, type: 'sine', start: 0.22, dur: 0.5, vol: 0.3 });
    },
    // Intro music: starts after `delay` seconds and loops until musicStop().
    // Notes are scheduled a little ahead of time so the beat stays steady.
    get musicPlaying() { return !!music; },
    musicStart(delay = 0) {
      this.musicStop(0);
      const c = audio();
      if (!c) return;
      const bus = c.createGain();
      bus.connect(master);
      music = { bus, step: 0, next: c.currentTime + delay + 0.05, timer: null };
      const m = music;
      const pump = () => {
        if (music !== m || !enabled) return;
        out = bus;
        while (m.next < c.currentTime + 0.3) {
          musicStep(m.step++, m.next - c.currentTime);
          m.next += STEP;
        }
        out = null;
      };
      pump();
      m.timer = setInterval(pump, 80);
    },
    // Fade the music out over `fade` seconds.
    musicStop(fade = 0.6) {
      if (!music) return;
      const { bus, timer } = music;
      music = null;
      clearInterval(timer);
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + Math.max(fade, 0.03));
      setTimeout(() => bus.disconnect(), (fade + 0.4) * 1000);
    },

    // Intro effects, timed with the CSS animation: drum roll, a slam when the
    // title words crash together (1.6 s, where the music starts), pops as the avatars burst out.
    // Returns a function that cuts it off (when the intro is skipped).
    intro() {
      const c = audio();
      if (!c) return () => {};
      const bus = c.createGain();
      bus.connect(master);
      out = bus;
      for (let t = 0, gap = 0.11; t < 1.55; t += gap, gap = Math.max(0.035, gap * 0.9)) {
        noise({ start: t, dur: 0.06, vol: 0.1 + t * 0.12, freq: 900 });
      }
      tone({ freq: 150, type: 'sine', start: 1.6, dur: 0.6, vol: 0.7, slideTo: 45 });
      noise({ start: 1.6, dur: 0.35, vol: 0.45, freq: 400 });
      noise({ start: 1.6, dur: 0.6, vol: 0.15, freq: 5500 });
      for (let i = 0; i < 8; i++) {
        tone({ freq: 700 + i * 110, type: 'sine', start: 1.95 + i * 0.05, dur: 0.08, vol: 0.12, slideTo: 1200 + i * 110 });
      }
      out = null;
      return () => {
        const now = c.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0, now + 0.08);
        setTimeout(() => bus.disconnect(), 200);
      };
    },
    // The game timer ran out: a loud alarm (three bursts of fast beeps), louder
    // than the other sounds on purpose, so it is heard over a noisy party.
    alarm() {
      const c = audio();
      if (!c) return;
      const loud = c.createGain();
      loud.gain.value = 0.9;
      loud.connect(c.destination); // bypasses the master volume
      out = loud;
      for (let burst = 0; burst < 3; burst++) {
        for (let i = 0; i < 4; i++) {
          const start = burst * 0.7 + i * 0.12;
          tone({ freq: i % 2 ? 1175 : 880, type: 'square', start, dur: 0.1, vol: 0.5 });
        }
      }
      out = null;
      setTimeout(() => loud.disconnect(), 2500);
    },
    // The hourglass is turned over (timer reset): a quick rising swish.
    flip() {
      tone({ freq: 300, type: 'triangle', dur: 0.5, vol: 0.25, slideTo: 900 });
      noise({ dur: 0.45, vol: 0.12, freq: 1500 });
    },
    // Teams re-drawn: a quick shuffle of ticks.
    shuffle() {
      for (let i = 0; i < 7; i++) noise({ start: i * 0.045, dur: 0.03, vol: 0.25, freq: 1800 + i * 300 });
    },
  };
})();
