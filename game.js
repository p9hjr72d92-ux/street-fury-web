'use strict';
/*
 * Street Fury — version web (téléphone et ordinateur).
 * Traduction fidèle du jeu Java (src/streetfury) : mêmes règles, mêmes coups, mêmes ennemis.
 * Le jeu calcule en 480x270 et s'affiche en 960x540 (images en double définition).
 * Commandes : écran tactile (croix + X B A Y), clavier, ou manette (API Gamepad du navigateur).
 */
(() => {
  const W = 480, H = 270, RES = 2;
  const FLOOR_TOP = 160, FLOOR_BOTTOM = 262, LEVEL_END = 3100, GRAVITY = 0.32;
  const YELLOW = 'rgb(255,220,50)', ORANGE = 'rgb(255,140,40)', WHITE = '#fff';
  const FONT = 'bold 10px ui-monospace, Menlo, Consolas, "Courier New", monospace';
  const BIG_FONT = '22px Bungee, Impact, "Arial Black", sans-serif';
  const TITLE_FONT = '40px Bungee, Impact, "Arial Black", sans-serif';

  // ------------------------------------------------------------------ outils

  const rnd = { int: n => Math.floor(Math.random() * n), f: () => Math.random(), bool: () => Math.random() < 0.5 };
  const idiv = (a, b) => Math.trunc(a / b);
  const floorMod = (a, n) => ((a % n) + n) % n;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const dark = c => [Math.floor(c[0] * 0.7), Math.floor(c[1] * 0.7), Math.floor(c[2] * 0.7)];

  /** Même hachage que le Java (décor généré, identique d'une partie à l'autre). */
  function hash(i) {
    let h = Math.imul(i, 0x9E3779B1);
    h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h & 0x7fffffff;
  }

  function oval(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.1, w / 2), Math.max(0.1, h / 2), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------------------------------------------------------------------ images

  /** Jeu d'images d'un atlas : chaque image garde sa case d'origine, pieds en (largeur/2, hauteur - 4×RES). */
  class SpriteSet {
    constructor(img, frames) {
      this.img = img;
      this.frames = frames;
      const c = document.createElement('canvas'); // silhouette blanche pour le flash quand on est touché
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = WHITE;
      g.fillRect(0, 0, c.width, c.height);
      this.white = c;
    }
    width(n) { const f = this.frames[n]; return f ? idiv(f[6], RES) : 0; }
    draw(ctx, n, x, y, facing, flash) {
      const f = this.frames[n];
      if (!f) return;
      const [ax, ay, w, h, ox, oy, cw, ch] = f;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing >= 0 ? 1 / RES : -1 / RES, 1 / RES);
      ctx.drawImage(flash ? this.white : this.img, ax, ay, w, h, -idiv(cw, 2) + ox, -(ch - 4 * RES) + oy, w, h);
      ctx.restore();
    }
  }

  const S = {}; // jeux d'images chargés : hero, joueur, punk, ennemi, couteau, brute, gros, decor, bonus, effects, skyline

  // ------------------------------------------------------------------ attaques

  /** Timings en images (60/s) ; zone de frappe de offset à offset+reach devant, de zLow à zHigh en hauteur. */
  const A = (anim, startup, active, recovery, damage, reach, offset, zLow, zHigh, knockdown) =>
    ({ anim, startup, active, recovery, damage, reach, offset, zLow, zHigh, knockdown, total: startup + active + recovery });

  const P = {
    JAB: A('PUNCH', 3, 3, 8, 4, 22, 4, 24, 42, false),
    JAB2: A('PUNCH', 3, 3, 9, 5, 22, 4, 24, 42, false),
    STRONG_PUNCH: A('PUNCH', 6, 4, 17, 10, 26, 4, 24, 42, true),
    KICK: A('KICK', 5, 4, 11, 6, 22, 2, 12, 36, false),
    HIGH_KICK: A('KICK', 8, 5, 18, 12, 30, 4, 18, 50, true),
    JUMP_KICK: A('JUMPKICK', 2, 200, 0, 10, 22, 2, 0, 30, true),
    RISING: A('RISING', 4, 18, 14, 14, 26, 0, 10, 80, true),
    WAVE: A('PUNCH', 12, 1, 22, 0, 0, 0, 999, -1, false),
    PIPE_1: A('PUNCH', 4, 4, 10, 8, 32, 4, 18, 46, false),
    PIPE_2: A('PUNCH', 4, 4, 11, 9, 32, 4, 18, 46, false),
    PIPE_3: A('PUNCH', 6, 5, 18, 14, 34, 4, 18, 50, true),
  };
  const PUNCHES = [P.JAB, P.JAB2, P.STRONG_PUNCH], KICKS = [P.KICK, P.KICK, P.HIGH_KICK];
  const STAR_TIME = 480, POWER_TIME = 900;

  const E = {
    THUG_PUNCH: A('PUNCH', 14, 4, 18, 7, 18, 4, 22, 40, false),
    THUG_SMASH: A('SMASH', 20, 5, 24, 13, 24, 4, 0, 50, true),
    PUNK_KICK: A('KICK', 16, 4, 20, 8, 24, 4, 14, 40, false),
    KNIFE_SLASH: A('PUNCH', 10, 4, 16, 9, 22, 4, 22, 40, false),
    KNIFE_OVERHEAD: A('PUNCH', 15, 4, 18, 12, 20, 4, 14, 46, true),
    BRUTE_PUNCH: A('PUNCH', 22, 5, 24, 14, 20, 4, 20, 44, true),
    BOSS_PUNCH: A('UPPER', 12, 5, 16, 12, 20, 4, 16, 50, true),
    BOSS_DASH: A('DASH', 30, 34, 20, 16, 16, 0, 0, 40, true),
    FART: A('FART', 26, 30, 22, 12, 50, 8, 4, 44, true),
    BURP: A('BURP', 24, 32, 20, 8, 48, 12, 28, 62, false),
  };

  // ------------------------------------------------------------------ bonus

  const KIND = {
    APPLE: { sprite: 'apple', heal: 20, score: 0 }, BANANA: { sprite: 'banana', heal: 15, score: 0 },
    SODA: { sprite: 'soda', heal: 10, score: 0 }, PIZZA: { sprite: 'pizza', heal: 30, score: 0 },
    BURGER: { sprite: 'burger', heal: 40, score: 0 }, CHICKEN: { sprite: 'chicken', heal: 60, score: 0 },
    MEDKIT: { sprite: 'medkit', heal: 100, score: 0 }, COINS: { sprite: 'coins', heal: 0, score: 500 },
    WALLET: { sprite: 'wallet', heal: 0, score: 1000 }, CASH: { sprite: 'cash', heal: 0, score: 2000 },
    NECKLACE: { sprite: 'necklace', heal: 0, score: 3000 }, WATCH: { sprite: 'watch', heal: 0, score: 4000 },
    DIAMOND: { sprite: 'diamond', heal: 0, score: 5000 }, LIFE: { sprite: 'life', heal: 0, score: 500 },
    STAR: { sprite: 'star', heal: 0, score: 500 }, PIPE: { sprite: 'pipe', heal: 0, score: 200 },
    BAT: { sprite: 'bat', heal: 0, score: 200 }, KNIFE: { sprite: 'knife', heal: 0, score: 200 },
    KNUCKLES: { sprite: 'knuckles', heal: 0, score: 200 }, CHAIN: { sprite: 'chain', heal: 0, score: 200 },
    BOTTLE: { sprite: 'bottle', heal: 0, score: 100 }, GLOVE: { sprite: 'glove', heal: 0, score: 300 },
    SNEAKER: { sprite: 'sneaker', heal: 0, score: 300 }, SHIELD: { sprite: 'shield', heal: 0, score: 300 },
  };
  for (const k in KIND) KIND[k].id = k;

  /** Armes : rangée d'images (w_rangée_0 à 5), coups avant de casser, et les 3 coups du combo (le 3e renverse). */
  const WEAPONS = new Map([
    [KIND.KNIFE, { row: 'knife', hits: 20, combo: [A('PUNCH', 3, 3, 8, 7, 28, 4, 22, 44, false), A('PUNCH', 3, 3, 9, 8, 28, 4, 22, 44, false), A('PUNCH', 5, 4, 14, 12, 30, 4, 20, 46, true)] }],
    [KIND.BAT, { row: 'bat', hits: 10, combo: [A('PUNCH', 5, 4, 12, 11, 36, 4, 16, 50, false), A('PUNCH', 5, 4, 12, 12, 36, 4, 16, 50, false), A('PUNCH', 7, 5, 18, 17, 38, 4, 16, 52, true)] }],
    [KIND.PIPE, { row: 'pipe', hits: 15, combo: [P.PIPE_1, P.PIPE_2, P.PIPE_3] }],
    [KIND.KNUCKLES, { row: 'knuckles', hits: 25, combo: [A('PUNCH', 3, 3, 8, 7, 22, 4, 24, 42, false), A('PUNCH', 3, 3, 9, 8, 22, 4, 24, 42, false), A('PUNCH', 5, 4, 15, 13, 24, 4, 20, 50, true)] }],
    [KIND.CHAIN, { row: 'chain', hits: 15, combo: [A('PUNCH', 6, 4, 12, 8, 46, 4, 16, 48, false), A('PUNCH', 6, 4, 12, 9, 46, 4, 16, 48, false), A('PUNCH', 7, 5, 18, 13, 50, 4, 16, 50, true)] }],
    [KIND.BOTTLE, { row: 'bottle', hits: 3, combo: [A('PUNCH', 5, 4, 12, 12, 26, 4, 22, 46, false), A('PUNCH', 5, 4, 12, 12, 26, 4, 22, 46, false), A('PUNCH', 6, 4, 16, 16, 28, 4, 20, 48, true)] }],
  ]);
  const isWeapon = k => WEAPONS.has(k);
  const weaponOf = a => { for (const w of WEAPONS.values()) if (w.combo.includes(a)) return w; return null; };
  const WEAPON_NAME = { BAT: 'BATTE', KNIFE: 'COUTEAU', KNUCKLES: 'POING AMÉRICAIN', CHAIN: 'CHAÎNE', BOTTLE: 'BOUTEILLE', PIPE: 'TUYAU' };
  const LOOT = ['APPLE', 'BANANA', 'SODA', 'PIZZA', 'BURGER', 'CHICKEN', 'MEDKIT', 'COINS', 'WALLET', 'CASH', 'NECKLACE',
    'WATCH', 'DIAMOND', 'LIFE', 'STAR', 'PIPE', 'BAT', 'KNIFE', 'KNUCKLES', 'CHAIN', 'BOTTLE', 'GLOVE', 'SNEAKER', 'SHIELD'].map(k => KIND[k]);
  const LOOT_WEIGHT = [12, 10, 8, 9, 9, 6, 2, 7, 5, 4, 3, 2, 1, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2], LOOT_EMPTY = 6;

  // ------------------------------------------------------------------ entrées (tactile, clavier, manette)

  const PAD = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, START: 16, BACK: 32, LB: 256, RB: 512, A: 4096, B: 8192, X: 16384, Y: 32768, LT: 65536, RT: 131072 };

  class Input {
    constructor() {
      this.held = new Set(); this.pending = new Set(); this.pressed = new Set(); this.down = new Set();
      this.touchX = 0; this.touchY = 0;
      this.padButtons = 0; this.padPrev = 0; this.padPending = 0; this.padPressed = 0; this.padDown = 0; this.padIndex = -1;
      this.touch = false;
    }
    keyDown(code) { if (!this.held.has(code)) this.pending.add(code); this.held.add(code); }
    keyUp(code) { this.held.delete(code); }
    tap(name) { this.pending.add('T:' + name); }
    clear() { this.held.clear(); this.pending.clear(); this.touchX = this.touchY = 0; }

    /** Lit la manette (à chaque image, même pendant les gels d'impact). */
    sample() {
      this.padPrev = this.padButtons;
      this.padButtons = 0;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) if (p && p.connected) { pad = p; break; }
      this.padIndex = pad ? pad.index : -1;
      if (!pad) return;
      const b = i => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      let m = 0;
      if (b(0)) m |= PAD.A; if (b(1)) m |= PAD.B; if (b(2)) m |= PAD.X; if (b(3)) m |= PAD.Y;
      if (b(4)) m |= PAD.LB; if (b(5)) m |= PAD.RB; if (b(6)) m |= PAD.LT; if (b(7)) m |= PAD.RT;
      if (b(8)) m |= PAD.BACK; if (b(9)) m |= PAD.START;
      if (b(12) || pad.axes[1] < -0.4) m |= PAD.UP; if (b(13) || pad.axes[1] > 0.4) m |= PAD.DOWN;
      if (b(14) || pad.axes[0] < -0.4) m |= PAD.LEFT; if (b(15) || pad.axes[0] > 0.4) m |= PAD.RIGHT;
      this.padButtons = m;
      this.padPending |= m & ~this.padPrev;
    }
    /** À appeler une fois au début de chaque image de jeu. */
    poll() {
      this.pressed = this.pending; this.pending = new Set();
      this.down = new Set([...this.held, ...this.pressed]);
      this.padPressed = this.padPending; this.padPending = 0;
      this.padDown = this.padButtons | this.padPressed;
    }
    padConnected() { return this.padIndex >= 0; }
    rumble(strength, frames) {
      const ms = Math.round(frames * 1000 / 60);
      const pad = this.padIndex >= 0 && navigator.getGamepads ? navigator.getGamepads()[this.padIndex] : null;
      try {
        if (pad && pad.vibrationActuator) pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
        else if (this.touch && navigator.vibrate) navigator.vibrate(Math.min(ms, 120));
      } catch (e) { /* pas de vibration : tant pis */ }
    }
    any(set, ...codes) { for (const c of codes) if (set.has(c)) return true; return false; }
    dx() {
      const r = this.any(this.down, 'ArrowRight', 'KeyD') || (this.padDown & PAD.RIGHT) || this.touchX > 0;
      const l = this.any(this.down, 'ArrowLeft', 'KeyA', 'KeyQ') || (this.padDown & PAD.LEFT) || this.touchX < 0;
      return (r ? 1 : 0) - (l ? 1 : 0);
    }
    dy() {
      const d = this.any(this.down, 'ArrowDown', 'KeyS') || (this.padDown & PAD.DOWN) || this.touchY > 0;
      const u = this.any(this.down, 'ArrowUp', 'KeyW', 'KeyZ') || (this.padDown & PAD.UP) || this.touchY < 0;
      return (d ? 1 : 0) - (u ? 1 : 0);
    }
    punch() { return this.any(this.pressed, 'KeyJ', 'KeyX', 'T:punch') || !!(this.padPressed & PAD.X); }
    kick() { return this.any(this.pressed, 'KeyK', 'KeyC', 'T:kick') || !!(this.padPressed & PAD.B); }
    jump() { return this.any(this.pressed, 'Space', 'T:jump') || !!(this.padPressed & PAD.A); }
    grab() { return this.any(this.pressed, 'KeyG', 'T:grab'); }
    wave() { return this.any(this.pressed, 'KeyU', 'T:wave') || !!(this.padPressed & PAD.RB); }
    special() { return this.any(this.pressed, 'KeyL', 'KeyV', 'T:special') || !!(this.padPressed & (PAD.Y | PAD.RT)); }
    start() { return this.any(this.pressed, 'Enter', 'T:start') || !!(this.padPressed & (PAD.START | PAD.A)); }
    pause() { return this.any(this.pressed, 'KeyP', 'Escape', 'T:pause') || !!(this.padPressed & (PAD.START | PAD.BACK)); }
  }

  // ------------------------------------------------------------------ sons (synthétisés comme dans le jeu Java)

  const FX = ['HIT', 'HEAVY', 'WHOOSH', 'JUMP', 'LAND', 'BREAK', 'PICKUP', 'KO', 'FART', 'BURP', 'WAVE'];

  class Sound {
    constructor() { this.ctx = null; this.buf = {}; this.music = null; this.musicBuf = null; this.wantMusic = false; }
    /** Le navigateur n'autorise le son qu'après un geste : appelé au premier toucher ou à la première touche. */
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.fxGain = this.ctx.createGain(); this.fxGain.gain.value = 0.9; this.fxGain.connect(this.ctx.destination);
          this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.55; this.musicGain.connect(this.ctx.destination);
          for (const fx of FX) this.buf[fx] = this.synth(fx);
          fetch('titre.wav').then(r => r.arrayBuffer())
            .then(b => new Promise((ok, ko) => this.ctx.decodeAudioData(b, ok, ko)))
            .then(b => { this.musicBuf = b; if (this.wantMusic) this.startMusic(); })
            .catch(() => { /* musique indisponible : le jeu continue sans */ });
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    }
    play(fx) {
      if (!this.ctx || !this.buf[fx]) return;
      const s = this.ctx.createBufferSource();
      s.buffer = this.buf[fx];
      s.connect(this.fxGain);
      s.start();
    }
    playMusic() { this.wantMusic = true; this.startMusic(); }
    startMusic() {
      if (!this.ctx || !this.musicBuf || this.music) return;
      this.music = this.ctx.createBufferSource();
      this.music.buffer = this.musicBuf;
      this.music.loop = true;
      this.music.connect(this.musicGain);
      this.music.start();
    }
    setMusicVolume(v) { if (this.musicGain) this.musicGain.gain.value = v; }
    stopMusic() {
      this.wantMusic = false;
      if (this.music) { try { this.music.stop(); } catch (e) { } this.music = null; }
    }
    synth(fx) {
      const RATE = 22050;
      const dur = { HIT: 0.10, HEAVY: 0.22, WHOOSH: 0.13, JUMP: 0.12, LAND: 0.10, BREAK: 0.30, PICKUP: 0.20, KO: 0.55, FART: 0.65, BURP: 0.55, WAVE: 0.45 }[fx];
      const n = Math.floor(dur * RATE);
      const buffer = this.ctx.createBuffer(1, n, RATE);
      const out = buffer.getChannelData(0);
      let lp = 0, phase = 0;
      const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;
      for (let i = 0; i < n; i++) {
        const t = i / RATE, k = t / dur, noise = Math.random() * 2 - 1;
        let v;
        switch (fx) {
          case 'HIT': lp += (noise - lp) * 0.5; v = lp * Math.exp(-t * 45) * 0.7 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 30) * 0.5; break;
          case 'HEAVY': lp += (noise - lp) * 0.25; phase += 2 * Math.PI * (90 - 50 * k) / RATE; v = lp * Math.exp(-t * 20) * 0.8 + Math.sin(phase) * Math.exp(-t * 12) * 0.7; break;
          case 'WHOOSH': lp += (noise - lp) * (0.08 + 0.25 * k); v = lp * Math.sin(Math.PI * k) * 0.9; break;
          case 'JUMP': phase += 2 * Math.PI * (220 + 500 * k) / RATE; v = sign(Math.sin(phase)) * 0.12 * (1 - k); break;
          case 'LAND': lp += (noise - lp) * 0.15; phase += 2 * Math.PI * (70 - 30 * k) / RATE; v = (Math.sin(phase) * 0.6 + lp * 0.6) * Math.exp(-t * 25); break;
          case 'BREAK': lp += (noise - lp) * 0.6; v = lp * (Math.floor(t * 60) % 2 === 0 ? 1 : 0.4) * Math.exp(-t * 9) * 0.8; break;
          case 'PICKUP': phase += 2 * Math.PI * (k < 0.4 ? 660 : 990) / RATE; v = sign(Math.sin(phase)) * 0.13 * (1 - k * 0.6); break;
          case 'FART': {
            phase += 2 * Math.PI * (48 - 22 * k + 6 * Math.sin(t * 37)) / RATE; lp += (noise - lp) * 0.2;
            const pulse = (phase / (2 * Math.PI)) % 1 < 0.3 ? 1 : -0.35;
            v = (pulse * 0.45 + lp * 0.35) * Math.min(1, t * 30) * (1 - k * 0.7) * (0.75 + 0.25 * Math.sin(t * 90)); break;
          }
          case 'BURP': {
            phase += 2 * Math.PI * (92 - 28 * k + 7 * Math.sin(t * 70)) / RATE;
            lp += (((phase / (2 * Math.PI)) % 1) * 2 - 1 - lp) * 0.18; v = lp * 0.6 * Math.min(1, t * 25) * (1 - k); break;
          }
          case 'WAVE': {
            lp += (noise - lp) * (0.1 + 0.3 * k); phase += 2 * Math.PI * (240 + 380 * k) / RATE;
            v = (lp * 0.5 + Math.sin(phase) * (0.6 + 0.4 * Math.sin(t * 160)) * 0.3) * Math.min(1, t * 20) * (1 - k); break;
          }
          default: phase += 2 * Math.PI * (380 - 300 * k) / RATE; v = (((phase / (2 * Math.PI)) % 1) * 2 - 1) * 0.22 * (1 - k);
        }
        out[i] = clamp(v, -1, 1) * 0.98;
      }
      return buffer;
    }
  }

  // ------------------------------------------------------------------ combattants

  class Fighter {
    constructor() {
      this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
      this.facing = 1; this.hp = 0; this.maxHp = 0; this.state = 'IDLE'; this.timer = 0;
      this.invuln = 0; this.flash = 0; this.scale = 1; this.halfWidth = 9; this.height = 46; this.name = '';
      this.attack = null; this.attackTimer = 0; this.hitSet = new Set();
      this.bounced = false; this.thrown = false; this.hurtTime = 16; this.downTime = 50; this.anim = 0;
      // apparence de secours pour les persos sans atlas (notamment le boss)
      this.skin = [226, 172, 128]; this.hair = [0, 0, 0]; this.shirt = [255, 255, 255]; this.pants = [50, 80, 160];
      this.shoes = [40, 30, 30]; this.belt = [40, 30, 20]; this.headband = null;
      this.mohawk = false; this.bald = false; this.shades = false; this.beard = false; this.knife = false; this.sleeveless = true;
    }
    setState(s) { this.state = s; this.timer = 0; this.attack = null; this.attackTimer = 0; }
    canBeHit() {
      if (this.invuln > 0) return false;
      return !['AIRBORNE', 'DOWN', 'GETUP', 'DEAD', 'GRABBED'].includes(this.state);
    }
    isAttackActive() {
      const a = this.attack;
      return !!a && this.attackTimer >= a.startup && this.attackTimer < a.startup + a.active;
    }
    takeHit(g, damage, dir, knockdown) {
      this.hp = Math.max(0, this.hp - damage);
      this.flash = 8;
      this.facing = -dir;
      if (this.hp === 0 || knockdown || this.z > 0) this.launch(dir, 3.4, 1.8);
      else { this.setState('HURT'); this.vx = dir * 0.9; this.vy = 0; }
    }
    launch(dir, up, back) {
      this.setState('AIRBORNE');
      this.vz = up; this.vx = dir * back; this.vy = 0;
      this.z = Math.max(this.z, 0.5);
      this.bounced = false;
    }
    getupInvuln() { return 20; }
    updateCommon(g) {
      this.timer++; this.anim++;
      if (this.invuln > 0) this.invuln--;
      if (this.flash > 0) this.flash--;
      if (this.state === 'HURT') {
        this.vx *= 0.85; this.vy = 0;
        if (this.timer >= this.hurtTime) this.setState('IDLE');
      } else if (this.state === 'DOWN') {
        this.vx = 0; this.vy = 0;
        if (this.timer >= this.downTime) this.setState(this.hp <= 0 ? 'DEAD' : 'GETUP');
      } else if (this.state === 'GETUP' && this.timer >= 24) {
        this.setState('IDLE');
        this.invuln = this.getupInvuln();
      }
      this.physics(g);
    }
    physics(g) {
      if (this.z > 0 || this.vz > 0) {
        this.vz -= GRAVITY;
        this.z += this.vz;
        if (this.z <= 0) { this.z = 0; this.vz = 0; this.onLand(g); }
      }
      this.x += this.vx; this.y += this.vy;
      this.y = clamp(this.y, FLOOR_TOP, FLOOR_BOTTOM);
    }
    onLand(g) {
      if (this.state !== 'AIRBORNE') return;
      if (!this.bounced) {
        this.bounced = true; this.thrown = false;
        this.vz = 2.0; this.z = 0.5; this.vx *= 0.5;
        g.landImpact(this);
      } else { this.setState('DOWN'); this.vx = 0; }
    }
    sortY() { return this.y; }
    flashing() { return this.flash > 0 && (this.flash & 2) !== 0; }
    hidden(frame) {
      if (this.state === 'DEAD') return idiv(this.timer, 3) % 2 === 0;
      return this.invuln > 0 && this.state !== 'SPECIAL' && this.state !== 'GETUP' && idiv(frame, 3) % 2 === 0;
    }
    draw(ctx, camX, frame) {
      const sx = Math.round(this.x - camX), sy = Math.round(this.y);
      const sw = Math.round(24 * this.scale * Math.max(0.4, 1 - this.z / 140));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      oval(ctx, sx - idiv(sw, 2), sy - 3, sw, 6);
      if (this.hidden(frame)) return;
      const f = this.facing;
      if (this.drawSprite(ctx, sx, sy - Math.round(this.z), f)) return;
      ctx.save();
      ctx.translate(sx, sy - Math.round(this.z));
      ctx.scale(f * this.scale, this.scale);
      const pose = this.pose();
      if (pose === 'HURT') ctx.rotate(-0.22);
      else if (pose === 'FALL') { ctx.translate(0, -18); ctx.rotate(-1.15); ctx.translate(0, 18); }
      else if (pose === 'LYING') { ctx.translate(0, -8); ctx.rotate(-Math.PI / 2); }
      else if (pose === 'CROUCH') ctx.translate(0, 7);
      this.drawBody(ctx, pose);
      ctx.restore();
    }
    drawSprite() { return false; }
    pose() {
      switch (this.state) {
        case 'WALK': return 'WALK';
        case 'HURT': case 'GRABBED': return 'HURT';
        case 'AIRBORNE': return 'FALL';
        case 'DOWN': case 'DEAD': return 'LYING';
        case 'GETUP': return 'CROUCH';
        case 'JUMP': return this.attack ? this.attack.anim : 'JUMP';
        case 'ATTACK': case 'SPECIAL': return this.attackPose();
        case 'GRAB': return 'GRAB';
        case 'THROW': return this.timer < 10 ? 'THROW' : 'IDLE';
        default: return 'IDLE';
      }
    }
    attackPose() {
      const a = this.attack;
      if (!a) return 'IDLE';
      if (this.attackTimer < a.startup) return a.anim === 'SPIN' ? 'SPIN' : 'WINDUP';
      if (this.attackTimer < a.startup + a.active + idiv(a.recovery, 2)) return a.anim;
      return 'IDLE';
    }
    fill(ctx, c, x, y, w, h) {
      ctx.fillStyle = this.flashing() ? WHITE : (typeof c === 'string' ? c : rgb(c));
      ctx.fillRect(x, y, w, h);
    }
    /** Perso dessiné par le code sans atlas : pieds en (0,0), regard vers +x. */
    drawBody(ctx, pose) {
      const f = (c, x, y, w, h) => this.fill(ctx, c, x, y, w, h);
      const b = pose === 'IDLE' && idiv(this.anim, 24) % 2 === 1 ? 1 : 0;
      const s = pose === 'WALK' ? Math.sin(this.anim * 0.22) : 0;
      const skinD = dark(this.skin), pantsD = dark(this.pants);
      switch (pose) { // bras arrière
        case 'SPIN': case 'THROW': break;
        case 'PUNCH': f(skinD, -12, -31, 9, 4); break;
        case 'GRAB': case 'KNEE': f(skinD, 4, -28, 13, 4); break;
        case 'HURT': case 'FALL': case 'LYING': f(skinD, -12, -38, 4, 10); break;
        default: f(skinD, -9, -32 + b, 4, 10); f(skinD, -9, -23 + b, 4, 4);
      }
      switch (pose) { // jambes
        case 'JUMP': case 'CROUCH':
          f(pantsD, -7, -17, 6, 9); f(this.shoes, -8, -9, 7, 3); f(this.pants, 1, -19, 6, 10); f(this.pants, 4, -12, 5, 4); f(this.shoes, 3, -10, 7, 3); break;
        case 'KICK': case 'JUMPKICK':
          f(pantsD, -6, -18, 6, 15); f(this.shoes, -7, -3, 8, 3); f(this.pants, 0, -24, 20, 6); f(this.shoes, 19, -26, 4, 9); break;
        case 'KNEE': case 'DASH':
          f(pantsD, -6, -18, 6, 15); f(this.shoes, -7, -3, 8, 3); f(this.pants, 1, -26, 11, 6); f(this.pants, 7, -22, 5, 10); f(this.shoes, 6, -13, 8, 3); break;
        default: {
          const bx = Math.round(-6 - s * 4), fx = Math.round(1 + s * 4);
          f(pantsD, bx, -18, 6, 15); f(this.shoes, bx - 1, -3, 8, 3); f(this.pants, fx, -18, 6, 15); f(this.shoes, fx, -3, 8, 3);
        }
      }
      f(this.shirt, -7, -34 + b, 15, 16); f(dark(this.shirt), -7, -34 + b, 3, 16); f(this.belt, -7, -19 + b, 15, 2);
      f(this.skin, -3, -37 + b, 6, 3); f(this.skin, -5, -47 + b, 11, 11);
      if (!this.bald) { f(this.hair, -6, -49 + b, 12, 4); f(this.hair, -6, -46 + b, 4, 6); }
      if (this.mohawk) f(this.hair, -2, -54 + b, 4, 6);
      if (this.headband) { f(this.headband, -6, -46 + b, 12, 2); f(this.headband, -10, -45 + b, 4, 2); }
      if (this.shades) f([0, 0, 0], 1, -43 + b, 6, 2); else f([0, 0, 0], 3, -43 + b, 2, 2);
      if (this.beard) f(this.hair, -1, -39 + b, 7, 3);
      const sl = this.sleeveless ? this.skin : this.shirt, sk = this.skin;
      switch (pose) { // bras avant
        case 'WINDUP': f(sl, -3, -33, 5, 6); f(sk, -9, -30, 8, 4); f(sk, -13, -31, 5, 6); break;
        case 'PUNCH': f(sl, 2, -33, 6, 5); f(sk, 7, -32, 14, 4); f(sk, 20, -33, 6, 6); break;
        case 'UPPER': f(sl, 2, -34, 5, 6); f(sk, 5, -47, 5, 14); f(sk, 4, -53, 7, 7); break;
        case 'GRAB': case 'KNEE': f(sl, 2, -33, 5, 5); f(sk, 5, -31, 14, 4); f(sk, 17, -32, 4, 6); break;
        case 'THROW': f(sl, -3, -34, 6, 5); f(sk, -18, -38, 16, 4); f(sk, -22, -39, 5, 6); break;
        case 'HURT': case 'FALL': case 'LYING': f(sl, -1, -35, 5, 5); f(sk, -4, -44, 4, 10); break;
        default: f(sl, 2, -33 + b, 5, 9); f(sk, 4, -26 + b, 8, 4); f(sk, 10, -30 + b, 5, 5);
      }
    }
  }

  // ------------------------------------------------------------------ le héros

  /** Poing avant du héros sur chaque image (décalage vers l'avant, hauteur) : où tenir le tuyau ou la batte. */
  const FIST = {
    block: [9, 38], flykick: [15, 29], getup: [7, 22], hurt_0: [8, 32], hurt_1: [10, 35], jab: [28, 42], jump_0: [9, 19],
    jump_1: [18, 37], jump_2: [5, 26], knee: [17, 36], land: [2, 7], punch: [28, 43], punch_0: [13, 39], punch_ready: [12, 35],
    walk_0: [-13, 34], walk_1: [-11, 32], walk_2: [0, 32], walk_3: [-14, 32], walk_4: [17, 38], walk_5: [-14, 35],
    walk_6: [-1, 32], walk_7: [17, 37], walk_8: [-14, 32], walk_9: [-13, 34], walk_10: [1, 34], walk_11: [-12, 32],
    f00: [15, 36], f01: [34, 37], f02: [42, 37], f03: [24, 32], f05: [11, 29], f11: [8, 30], f12: [19, 26], f13: [15, 40],
    f14: [14, 42], f15: [13, 35], f20: [19, 25], f21: [20, 48], f22: [14, 51], f24: [17, 30], f25: [24, 34], f30: [38, 43],
    f32: [26, 21], f50: [15, 39], f52: [8, 45], f55: [11, 40], f63: [8, 9],
  };
  const HISTORY = 20;

  class Player extends Fighter {
    constructor(x, y) {
      super();
      this.x = x; this.y = y; this.name = 'JACK'; this.maxHp = this.hp = 100;
      this.hurtTime = 18; this.downTime = 40; this.height = 52;
      this.lives = 2; this.score = 0;
      this.connected = false; this.comboStep = 0; this.comboTimer = 0;
      this.buffered = false; this.bufferedKick = false; this.jumpAttackUsed = false; this.specialPaid = false;
      this.pendingJump = 0; this.pendingKick = 0; this.jumpAge = 99; this.kickAge = 99;
      this.airPunch = false; this.bigLanding = false; this.landTimer = 0;
      this.histX = new Array(HISTORY).fill(0); this.histY = new Array(HISTORY).fill(0); this.histPos = 0;
      this.grabbed = null; this.grabTimer = 0; this.knees = 0; this.kneeAnim = 0;
      this.weaponHits = 0; this.weaponKind = KIND.PIPE; this.starTimer = 0;
      this.powerTimer = 0; this.speedTimer = 0; this.shieldTimer = 0;
    }
    targetable() { return this.hp > 0 && this.state !== 'DEAD'; }
    getupInvuln() { return 50; }
    canBeHit() { return this.starTimer === 0 && super.canBeHit(); }

    update(g, inp) {
      if (this.comboTimer > 0) this.comboTimer--;
      if (this.landTimer > 0) this.landTimer--;
      if (this.starTimer > 0 && --this.starTimer % 5 === 0) g.sparkle(this.x, this.y, this.z);
      if (this.powerTimer > 0) this.powerTimer--;
      if (this.speedTimer > 0) this.speedTimer--;
      if (this.shieldTimer > 0) this.shieldTimer--;
      const dx = inp.dx(), dy = inp.dy();
      const pun = inp.punch(), kic = inp.kick(), jmp = inp.jump();
      const atk = pun || kic;
      this.jumpAge = jmp ? 0 : Math.min(99, this.jumpAge + 1);
      this.kickAge = kic ? 0 : Math.min(99, this.kickAge + 1);
      const spc = inp.special() || (pun && kic);
      this.histX[this.histPos] = dx; this.histY[this.histPos] = dy;
      this.histPos = (this.histPos + 1) % HISTORY;
      const dir = dx !== 0 ? dx : this.facing;
      const wave = inp.wave() || (pun && !kic && this.quarterCircle(dir));

      switch (this.state) {
        case 'IDLE': case 'WALK': {
          // Prise = saut + pied ensemble (A+B) ; un saut ou un pied seul attend 2 images l'autre bouton.
          const grabCmd = inp.grab() || (jmp && kic) || (jmp && this.pendingKick > 0) || (kic && this.pendingJump > 0);
          if (grabCmd) { this.pendingJump = this.pendingKick = 0; this.grabFront(g, dx); }
          else if (spc) this.startSpecial(g);
          else if (wave && !g.waveInFlight()) this.startWave(g, dir);
          else if (jmp) this.pendingJump = 3;
          else if (pun) this.startCombo(false);
          else if (kic) this.pendingKick = 3;
          else this.walk(g, dx, dy);
          if (this.state === 'IDLE' || this.state === 'WALK') {
            if (this.pendingJump > 0 && --this.pendingJump === 0) this.jump(g, dx);
            else if (this.pendingKick > 0 && --this.pendingKick === 0) this.startCombo(true);
          } else this.pendingJump = this.pendingKick = 0;
          break;
        }
        case 'ATTACK': {
          this.vx = 0; this.vy = 0;
          this.attackTimer++;
          if (this.attack === P.WAVE && this.attackTimer === this.attack.startup) g.fireWave(this);
          else if (this.attackTimer === this.attack.startup) g.sound('WHOOSH');
          if (atk) { this.buffered = true; this.bufferedKick = kic; }
          if (spc) this.startSpecial(g);
          else if (this.attackTimer >= this.attack.total) {
            this.comboTimer = 20;
            if (this.buffered && this.connected && this.comboStep < 2) this.beginAttack(this.move(++this.comboStep, this.bufferedKick));
            else if (this.buffered) this.beginAttack(this.move(this.comboStep = 0, this.bufferedKick));
            else this.setState('IDLE');
          }
          break;
        }
        case 'JUMP':
          if (atk && !this.attack && !this.jumpAttackUsed) {
            this.attack = P.JUMP_KICK; this.airPunch = pun && !kic; this.attackTimer = 0;
            this.hitSet.clear(); this.jumpAttackUsed = true; g.sound('WHOOSH');
          }
          if (this.attack) this.attackTimer++;
          break;
        case 'SPECIAL':
          this.vx = this.z > 0 ? this.facing * 1.2 : 0; // l'uppercut sauté avance un peu
          this.vy = 0;
          this.attackTimer++;
          if (this.attackTimer === this.attack.startup) { this.vz = 5.2; this.z = 0.5; g.sound('JUMP'); }
          if (this.attackTimer >= this.attack.total) this.setState('IDLE');
          break;
        case 'GRAB':
          this.updateGrab(g, dx, atk, inp.grab() || (jmp && kic) || (jmp && this.kickAge <= 3) || (kic && this.jumpAge <= 3));
          break;
        case 'THROW':
          this.vx = 0; this.vy = 0;
          if (this.timer >= 18) this.setState('IDLE');
          break;
        case 'HURT':
          if (spc) this.startSpecial(g);
          break;
      }
      this.updateCommon(g);
      this.x = clamp(this.x, g.camX + 12, g.camX + W - 12);
    }
    walk(g, dx, dy) {
      const speed = this.speedTimer > 0 ? 1.4 : 1;
      this.vx = dx * 1.6 * speed; this.vy = dy * 1.1 * speed;
      if (dx !== 0) this.facing = dx;
      if (dx !== 0 || dy !== 0) { if (this.state !== 'WALK') this.setState('WALK'); }
      else if (this.state !== 'IDLE') this.setState('IDLE');
      if (dx !== 0) this.tryGrab(g, dx);
    }
    jump(g, dx) {
      this.setState('JUMP');
      this.vz = 5.4; this.z = 0.5; this.vx = dx * 1.8; this.vy = 0;
      if (dx !== 0) this.facing = dx;
      this.jumpAttackUsed = false;
      g.sound('JUMP');
    }
    startCombo(kick) {
      if (this.comboTimer > 0 && this.connected && this.comboStep < 2) this.comboStep++;
      else this.comboStep = 0;
      this.beginAttack(this.move(this.comboStep, kick));
    }
    /** Geste ↓ ↘ → dans les dernières images. */
    quarterCircle(dir) {
      let step = 0;
      for (let i = 0; i < HISTORY; i++) {
        const k = (this.histPos + i) % HISTORY, hx = this.histX[k], hy = this.histY[k];
        if (step === 0 && hy > 0 && hx === 0) step = 1;
        else if (step === 1 && hy > 0 && hx === dir) step = 2;
        else if (step === 2 && hy === 0 && hx === dir) return true;
      }
      return false;
    }
    startWave(g, dir) {
      this.facing = dir;
      this.beginAttack(P.WAVE);
      this.comboStep = 0;
      g.sound('WHOOSH');
      this.histY.fill(0);
    }
    move(step, kick) { return (kick ? KICKS : this.weaponHits > 0 ? WEAPONS.get(this.weaponKind).combo : PUNCHES)[step]; }
    damageFor(a) {
      let d = a.damage;
      if (this.powerTimer > 0) d = idiv(d * 3 + 1, 2);
      return d;
    }
    beginAttack(a) {
      this.setState('ATTACK');
      this.attack = a; this.attackTimer = 0; this.hitSet.clear();
      this.connected = false; this.buffered = false; this.vx = 0; this.vy = 0;
    }
    startSpecial(g) {
      this.releaseGrab();
      this.setState('SPECIAL');
      this.attack = P.RISING; this.attackTimer = 0; this.hitSet.clear();
      this.invuln = this.attack.total; this.specialPaid = false;
      this.vx = this.vy = this.z = this.vz = 0;
      g.sound('WHOOSH');
    }
    onHit(g) {
      this.connected = true;
      if (this.weaponHits > 0 && WEAPONS.get(this.weaponKind).combo.includes(this.attack) && --this.weaponHits === 0) g.weaponBroke(this);
      if (this.state === 'SPECIAL' && !this.specialPaid) { this.specialPaid = true; this.hp = Math.max(1, this.hp - 6); }
    }
    tryGrab(g, dx) {
      for (const e of g.enemies) {
        if (!e.canBeGrabbed()) continue;
        const ddx = (e.x - this.x) * dx;
        if (ddx > 0 && ddx < 20 * e.scale && Math.abs(e.y - this.y) < 6) { this.grab(e, dx); return; }
      }
    }
    grabFront(g, dx) {
      const front = dx !== 0 ? dx : this.facing;
      let best = null, bestScore = Infinity;
      for (const e of g.enemies) {
        if (!e.canBeGrabbed() || Math.abs(e.y - this.y) >= 9) continue;
        const d = (e.x - this.x) * front;
        const inFront = d > 0 && d < 32 * e.scale, behind = d <= 0 && d > -22 * e.scale;
        if (!inFront && !behind) continue;
        const score = Math.abs(d) + (behind ? 20 : 0);
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (best) this.grab(best, best.x >= this.x ? 1 : -1);
    }
    grab(e, dir) {
      this.setState('GRAB');
      this.grabbed = e; e.grabbedBy = this;
      e.setState('GRABBED'); e.vx = e.vy = 0; e.z = 0;
      this.facing = dir; e.facing = -dir;
      this.grabTimer = 0; this.knees = 0; this.kneeAnim = 0; this.vx = this.vy = 0;
    }
    updateGrab(g, dx, atk, grabCmd) {
      this.vx = 0; this.vy = 0;
      const e = this.grabbed;
      if (!e || e.state !== 'GRABBED') { this.grabbed = null; this.setState('IDLE'); return; }
      this.grabTimer++;
      if (this.kneeAnim > 0) this.kneeAnim--;
      e.x = this.x + this.facing * 17 * Math.max(1, e.scale * 0.9);
      e.y = this.y - 0.5;
      if (grabCmd) this.throwEnemy(g, dx !== 0 ? dx : this.facing);
      else if (atk && this.kneeAnim === 0) {
        if (dx === -this.facing) this.throwEnemy(g, -this.facing);
        else if (this.knees >= 3) this.throwEnemy(g, this.facing);
        else this.knee(g, e);
      } else if (this.grabTimer > 110) { this.releaseGrab(); this.setState('IDLE'); }
    }
    knee(g, e) {
      this.kneeAnim = 12; this.knees++;
      e.hp = Math.max(0, e.hp - 5); e.flash = 8;
      g.hitFx(e.x - this.facing * 4, e.y, 16, false);
      g.addScore(50); g.showEnemy(e);
      if (e.hp === 0) {
        e.grabbedBy = null; e.launch(this.facing, 3.5, 2);
        this.grabbed = null; this.setState('IDLE'); g.enemyDamaged(e);
      }
    }
    throwEnemy(g, dir) {
      const e = this.grabbed;
      this.facing = dir;
      e.grabbedBy = null;
      e.hp = Math.max(0, e.hp - 12);
      e.launch(dir, 4.6, 3.6);
      e.z = 18; e.thrown = true; e.x = this.x + dir * 10;
      this.grabbed = null;
      this.setState('THROW');
      g.sound('HEAVY'); g.addScore(200); g.showEnemy(e); g.enemyDamaged(e);
    }
    releaseGrab() {
      if (this.grabbed) {
        if (this.grabbed.state === 'GRABBED') this.grabbed.setState('IDLE');
        this.grabbed.grabbedBy = null;
        this.grabbed = null;
      }
    }
    takeHit(g, damage, dir, knockdown) {
      this.releaseGrab();
      if (this.shieldTimer > 0) damage = idiv(damage + 1, 2);
      super.takeHit(g, damage, dir, knockdown);
      if (this.weaponHits > 0 && this.state === 'AIRBORNE') { g.dropWeapon(this.x, this.y, this.weaponKind); this.weaponHits = 0; }
    }
    onLand(g) {
      if (this.state === 'JUMP') {
        this.setState('IDLE'); this.vx = 0;
        this.bigLanding = this.invuln > 60;
        this.landTimer = this.bigLanding ? 24 : 6;
        g.dust(this.x, this.y);
      } else super.onLand(g);
    }
    respawn(atX) {
      this.hp = this.maxHp; this.x = atX; this.y = (FLOOR_TOP + FLOOR_BOTTOM) / 2; this.z = 110;
      this.vx = this.vy = this.vz = 0;
      this.setState('JUMP');
      this.jumpAttackUsed = true; this.invuln = 150; this.comboStep = 0;
      this.starTimer = this.powerTimer = this.speedTimer = this.shieldTimer = 0;
    }
    drawSprite(ctx, sx, sy, f) {
      if (this.starTimer > 0 && (this.starTimer > 90 || idiv(this.starTimer, 4) % 2 === 0)) { // halo doré
        const a = 110 + Math.trunc(50 * Math.sin(this.anim * 0.4));
        ctx.fillStyle = `rgba(255,200,40,${a / 2 / 255})`; oval(ctx, sx - 24, sy - 64, 48, 72);
        ctx.fillStyle = `rgba(255,235,120,${a / 255})`; oval(ctx, sx - 17, sy - 58, 34, 62);
      }
      const frame = this.heroFrame();
      S.hero.draw(ctx, frame, sx, sy, f, this.flashing());
      if (this.weaponHits > 0) this.drawWeapon(ctx, sx, sy, f, frame);
      return true;
    }
    /** Arme dans le poing quand l'image ne la montre pas déjà : tuyau ou batte dessinés, les autres en icône. */
    drawWeapon(ctx, sx, sy, f, frame) {
      if (frame.startsWith('w_')) return;
      const p = FIST[frame];
      if (!p) return;
      if (this.weaponKind !== KIND.PIPE && this.weaponKind !== KIND.BAT) {
        S.bonus.draw(ctx, this.weaponKind.sprite, sx + f * p[0], sy - p[1] + 8, f, false);
        return;
      }
      let angle = -1.15;
      if (['jab', 'punch', 'f02', 'f30', 'f12'].includes(frame)) angle = 0;
      else if (['f01', 'f03', 'f25'].includes(frame)) angle = -0.35;
      else if (['punch_ready', 'f20', 'f24', 'f11'].includes(frame)) angle = -2.4;
      else if (['f21', 'f22'].includes(frame)) angle = -1.7;
      else if (['land', 'getup', 'f63', 'f32'].includes(frame)) angle = -0.3;
      ctx.save();
      ctx.translate(sx + f * p[0], sy - p[1]);
      ctx.scale(f, 1);
      ctx.rotate(angle);
      if (this.weaponKind === KIND.BAT) {
        ctx.fillStyle = 'rgb(70,40,20)'; ctx.fillRect(-4, -1.8, 12, 3.6); oval(ctx, 6, -3, 18, 6);
        ctx.fillStyle = 'rgb(150,95,50)'; ctx.fillRect(-3, -1.2, 11, 2.4); oval(ctx, 7, -2.3, 16, 4.6);
        ctx.fillStyle = 'rgb(200,145,90)'; ctx.fillRect(9, -1.8, 12, 1);
      } else {
        ctx.fillStyle = 'rgb(35,35,42)'; ctx.fillRect(-4, -2, 25, 4);
        ctx.fillStyle = 'rgb(150,155,168)'; ctx.fillRect(-3, -1.5, 23, 3);
        ctx.fillStyle = 'rgb(220,225,235)'; ctx.fillRect(-3, -1.5, 23, 1);
        ctx.fillStyle = 'rgb(95,62,40)'; ctx.fillRect(-3, -1.5, 6, 3);
      }
      ctx.restore();
    }
    /** Image du héros selon l'action : élan (avant s), impact (pendant a), retour (début puis fin de r). */
    heroFrame() {
      const at = this.attack, t = this.attackTimer;
      const s = at ? at.startup : 0, a = at ? at.active : 0, r = at ? at.recovery : 0;
      const hit = !!at && t >= s && t < s + a, back = !!at && t >= s + a && t < s + a + idiv(r, 2);
      const landing = () => this.bigLanding ? 'f63' : 'f05';
      switch (this.state) {
        case 'IDLE':
          if (this.landTimer > 0) return landing();
          if (this.weaponHits > 0) return 'w_' + WEAPONS.get(this.weaponKind).row + (idiv(this.anim, 24) % 2 === 0 ? '_0' : '_5');
          return 'idle_' + idiv(this.anim, 9) % 8; // garde qui respire : les 8 poses en boucle
        case 'WALK': return this.landTimer > 0 ? landing() : 'walk_' + idiv(this.anim, 4) % 12;
        case 'JUMP': return at ? (this.airPunch ? 'f54' : 'flykick') : this.vz > 1.5 ? 'jump_1' : 'jump_2';
        case 'ATTACK':
          if (at === P.WAVE) {
            if (t < s) return t < idiv(s, 2) ? 'wave_4' : 'wave_5';
            if (t < s + 6) return 'wave_0';
            return t < s + 12 ? 'wave_1' : t < s + 18 ? 'wave_2' : 'wave_3';
          }
          { // coup avec une arme : sa rangée (élan 1-2, coup tendu 3, retour 4, garde 5)
            const w = weaponOf(at);
            if (w) {
              if (this.weaponHits <= 0) return t < s ? 'f01' : hit ? 'f02' : back ? 'f03' : 'f00'; // cassée en plein coup
              if (t < s) return 'w_' + w.row + (t < idiv(s, 2) ? '_1' : '_2');
              return 'w_' + w.row + (hit ? '_3' : back ? '_4' : '_5');
            }
          }
          // jabs : garde, bras tendu (gardé un peu après l'impact), garde ; punch : bras armé, direct, garde
          if (at === P.JAB || at === P.JAB2) return t < s ? 'punch_0' : hit || t < s + a + idiv(r, 4) ? 'jab' : back ? 'punch_0' : 'punch_5';
          if (at === P.STRONG_PUNCH) return t < s ? 'punch_ready' : hit || t < s + a + idiv(r, 3) ? 'punch' : 'punch_5';
          if (at === P.KICK) return t < s ? 'f52' : hit ? 'f55' : back ? 'f52' : 'f50';
          if (t < s) return t < idiv(s, 2) ? 'f51' : 'spin_2';
          return hit || t < s + a + idiv(r, 3) ? 'spin_3' : back ? 'spin_4' : 'f50';
        case 'SPECIAL':
          if (t < s) return t < idiv(s, 2) ? 'f41' : 'f42';
          if (t < s + a) return t < s + 3 ? 'f43' : 'rise_3';
          return this.z > 1 ? 'f45' : 'f63';
        case 'HURT': case 'GRABBED': return this.timer < 8 ? 'hurt_1' : 'hurt_0';
        case 'AIRBORNE': return this.bounced ? 'down' : 'fall';
        case 'DOWN': case 'DEAD': return 'down';
        case 'GETUP': return this.timer < 12 ? 'getup' : 'f05';
        case 'GRAB': return this.kneeAnim > 4 ? 'knee' : 'punch_ready';
        case 'THROW': return this.timer < 10 ? 'f30' : 'f00';
        default: return 'f00';
      }
    }
  }

  // ------------------------------------------------------------------ ennemis

  const TYPE = {
    PUNK: { hp: 30, speed: 0.9, score: 400 }, THUG: { hp: 38, speed: 0.8, score: 500 }, KNIFE: { hp: 24, speed: 1.3, score: 500 },
    BRUTE: { hp: 85, speed: 0.6, score: 1000 }, GROS: { hp: 70, speed: 0.55, score: 1500 }, BOSS: { hp: 260, speed: 1.05, score: 10000 },
  };
  for (const k in TYPE) TYPE[k].id = k;
  const NAMES = {
    PUNK: ['SPIKE', 'RICO', 'ZIGGY', 'CRASH'], THUG: ['DUKE', 'VINNIE', 'TONY', 'BRUNO'], KNIFE: ['BLADE', 'SNIPS', 'RAZOR'],
    BRUTE: ['TANK', 'BULL', 'MOOSE'], GROS: ['GROS BILL', 'BOUBOULE', 'GROS MOMO'], BOSS: ['BIG MAX'],
  };
  const SKINS = [[226, 172, 128], [170, 110, 70], [120, 75, 45], [240, 200, 160]];
  const pick = a => a[rnd.int(a.length)];

  class Enemy extends Fighter {
    constructor(type, x, y) {
      super();
      this.type = type; this.x = x; this.y = y;
      this.maxHp = this.hp = type.hp;
      this.skin = pick(SKINS);
      this.name = pick(NAMES[type.id]);
      this.grabbedBy = null; this.entered = false; this.aggressive = false; this.removed = false;
      switch (type) {
        case TYPE.PUNK: this.height = 50; this.mainAttack = this.nextAttack(); break;
        case TYPE.THUG: this.height = 52; this.mainAttack = this.nextAttack(); break;
        case TYPE.KNIFE: this.height = 50; this.mainAttack = this.nextAttack(); break;
        case TYPE.BRUTE:
          this.scale = 1.35; this.bald = true; this.beard = true; this.hair = [60, 40, 20];
          this.shirt = [40, 60, 140]; this.pants = [110, 80, 50]; this.hurtTime = 12; this.mainAttack = E.BRUTE_PUNCH; break;
        case TYPE.GROS: this.hurtTime = 14; this.halfWidth = 14; this.height = 60; this.mainAttack = this.nextAttack(); break;
        default:
          this.scale = 1.25; this.skin = [210, 160, 120]; this.shirt = [170, 25, 30]; this.pants = [25, 25, 30];
          this.hair = [235, 235, 235]; this.shades = true; this.hurtTime = 12; this.downTime = 40; this.mainAttack = E.BOSS_PUNCH;
      }
      this.cooldown = 40 + rnd.int(40);
      this.newHover();
    }
    /** Attaque suivante : chaque ennemi alterne entre deux coups. */
    nextAttack() {
      switch (this.type) {
        case TYPE.PUNK: return rnd.int(3) === 0 ? E.PUNK_KICK : E.THUG_PUNCH;
        case TYPE.THUG: return rnd.int(3) === 0 ? E.THUG_SMASH : E.THUG_PUNCH;
        case TYPE.KNIFE: return rnd.int(3) === 0 ? E.KNIFE_OVERHEAD : E.KNIFE_SLASH;
        case TYPE.GROS: return rnd.bool() ? E.FART : E.BURP;
        default: return this.mainAttack;
      }
    }
    canBeGrabbed() {
      return this.type !== TYPE.BOSS && this.type !== TYPE.GROS && this.entered && this.hp > 0 && this.z <= 0
        && (this.state === 'IDLE' || this.state === 'WALK' || this.state === 'HURT');
    }
    update(g) {
      if (this.state === 'GRABBED') { this.timer++; this.anim++; if (this.flash > 0) this.flash--; return; }
      if (this.state === 'IDLE' || this.state === 'WALK') this.think(g);
      else if (this.state === 'ATTACK') {
        const at = this.attack;
        this.attackTimer++;
        if (this.attackTimer === at.startup) g.sound(at === E.FART ? 'FART' : at === E.BURP ? 'BURP' : 'WHOOSH');
        if (at === E.THUG_SMASH && this.attackTimer === at.startup + 2) g.landImpact(this);
        this.vx = at === E.BOSS_DASH && this.isAttackActive() ? this.facing * 4.2 : 0;
        this.vy = 0;
        if (this.attackTimer >= at.total) {
          this.setState('IDLE');
          this.cooldown = this.nextCooldown();
          this.mainAttack = this.nextAttack();
        }
      }
      this.updateCommon(g);
      if (this.state === 'DEAD' && this.timer > 45) this.removed = true;
      const minX = g.camX + 10, maxX = g.camX + W - 10;
      if (!this.entered && this.x > minX && this.x < maxX) this.entered = true;
      if (this.entered) this.x = clamp(this.x, minX, maxX);
    }
    think(g) {
      const p = g.player;
      if (this.cooldown > 0) this.cooldown--;
      if (--this.wanderTimer <= 0) this.newHover();
      if (!p.targetable()) { this.vx = this.vy = 0; if (this.state !== 'IDLE') this.setState('IDLE'); return; }
      const side = this.x < p.x ? -1 : 1;
      let tx, ty;
      if (this.aggressive) { tx = p.x + side * this.engage() * 0.85; ty = p.y; }
      else { tx = p.x + side * this.hoverDist; ty = p.y + this.hoverY; }
      tx = clamp(tx, g.camX + 20, g.camX + W - 20);
      const dx = tx - this.x, dy = ty - this.y;
      const mx = Math.abs(dx) > 3 ? Math.sign(dx) : 0, my = Math.abs(dy) > 2 ? Math.sign(dy) : 0;
      this.vx = mx * this.type.speed; this.vy = my * this.type.speed * 0.7;
      if (mx !== 0 || my !== 0) { if (this.state !== 'WALK') this.setState('WALK'); }
      else if (this.state !== 'IDLE') this.setState('IDLE');
      this.facing = p.x >= this.x ? 1 : -1;
      const adx = Math.abs(p.x - this.x), ady = Math.abs(p.y - this.y);
      if (this.cooldown > 0 || p.z > 30) return;
      if (this.aggressive && ady < 6 && adx < this.engage()) this.startAttack(g, this.mainAttack);
      else if (this.type === TYPE.BOSS && ady < 8 && adx > 80 && rnd.int(50) === 0) this.startAttack(g, E.BOSS_DASH);
    }
    engage() { return (this.mainAttack.offset + this.mainAttack.reach) * this.scale + 4; }
    startAttack(g, a) {
      this.setState('ATTACK');
      this.attack = a; this.attackTimer = 0; this.hitSet.clear();
      this.vx = this.vy = 0;
      this.facing = g.player.x >= this.x ? 1 : -1;
    }
    nextCooldown() {
      switch (this.type) {
        case TYPE.KNIFE: return 35 + rnd.int(40);
        case TYPE.BRUTE: return 60 + rnd.int(60);
        case TYPE.GROS: return 70 + rnd.int(60);
        case TYPE.BOSS: return 30 + rnd.int(40);
        default: return 50 + rnd.int(50);
      }
    }
    newHover() { this.hoverDist = 60 + rnd.int(50); this.hoverY = -25 + rnd.int(51); this.wanderTimer = 90 + rnd.int(120); }
    takeHit(g, damage, dir, kd) {
      super.takeHit(g, damage, dir, kd);
      this.cooldown = Math.max(this.cooldown, 25 + rnd.int(25));
    }
    gasAttack() { return this.attack === E.FART || this.attack === E.BURP; }
    drawSprite(ctx, sx, sy, f) {
      const set = { PUNK: S.punk, THUG: S.ennemi, KNIFE: S.couteau, BRUTE: S.brute, GROS: S.gros }[this.type.id];
      if (!set) return false;
      set.draw(ctx, this.frameName(), sx, sy, f, this.flashing());
      return true;
    }
    /** Phase d'une attaque en 6 étapes : 1-2 élan, 3 impact, 4-5 retour. */
    step6() {
      const at = this.attack, t = this.attackTimer, s = at.startup, a = at.active, r = at.recovery;
      if (t < s) return t < idiv(s * 2, 3) ? 1 : 2;
      if (t < s + a) return 3;
      return t < s + a + idiv(r, 2) ? 4 : 5;
    }
    frameName() {
      const st = this.state, at = this.attack, t = this.attackTimer;
      switch (this.type) {
        case TYPE.PUNK:
          if (st === 'IDLE') return idiv(this.anim, 16) % 2 === 0 ? 'punch_0' : 'punch_5';
          if (st === 'WALK') return 'walk_' + idiv(this.anim, 7) % 6;
          if (st === 'ATTACK') return (at === E.PUNK_KICK ? 'kick_' : 'punch_') + this.step6();
          if (st === 'HURT' || st === 'GRABBED' || st === 'GETUP') return 'punch_4';
          if (st === 'AIRBORNE') return this.bounced ? 'down' : this.vz > 0 ? 'fall_0' : 'fall_1';
          if (st === 'DOWN' || st === 'DEAD') return 'down';
          return 'punch_0';
        case TYPE.THUG:
          if (st === 'IDLE') return idiv(this.anim, 16) % 2 === 0 ? 'idle' : 'punch_0';
          if (st === 'WALK') return 'walk_' + idiv(this.anim, 7) % 6;
          if (st === 'ATTACK') {
            if (at === E.THUG_SMASH) {
              const s = at.startup, a = at.active, r = at.recovery;
              if (t < s) return 'smash_' + Math.min(2, idiv(t * 3, s));
              if (t < s + a) return 'smash_3';
              return t < s + a + idiv(r, 2) ? 'smash_4' : 'smash_5';
            }
            return 'punch_' + this.step6();
          }
          if (st === 'HURT' || st === 'GRABBED' || st === 'GETUP') return 'hurt';
          if (st === 'AIRBORNE') return this.bounced ? 'down' : this.vz > 0 ? 'fall_0' : 'fall_1';
          if (st === 'DOWN' || st === 'DEAD') return 'down';
          return 'idle';
        case TYPE.KNIFE:
          if (st === 'IDLE') return idiv(this.anim, 18) % 2 === 0 ? 'idle' : 'stab_0';
          if (st === 'WALK') return 'walk_' + idiv(this.anim, 6) % 6;
          if (st === 'ATTACK') {
            const s = at.startup, a = at.active, r = at.recovery, over = at === E.KNIFE_OVERHEAD, m = over ? 'slash_' : 'stab_';
            if (t < s) return m + (t < idiv(s, 2) ? 1 : over ? 2 : 1);
            if (t < s + a) return m + (over ? 3 : t < s + idiv(a, 2) ? 2 : 3);
            return m + (t < s + a + idiv(r, 2) ? 4 : 5);
          }
          if (st === 'HURT' || st === 'GRABBED') return this.timer < 8 ? 'hurt_0' : 'hurt_1';
          if (st === 'AIRBORNE') return this.bounced ? 'down' : 'fall';
          if (st === 'DOWN' || st === 'DEAD') return 'down';
          if (st === 'GETUP') return 'getup';
          return 'idle';
        case TYPE.BRUTE:
          if (st === 'IDLE') return idiv(this.anim, 18) % 2 === 0 ? 'idle' : 'punch_0';
          if (st === 'WALK') return 'walk_' + idiv(this.anim, 8) % 6;
          if (st === 'ATTACK') return 'punch_' + this.step6();
          if (st === 'HURT' || st === 'GRABBED') return this.timer < idiv(this.hurtTime, 2) ? 'hurt_0' : 'hurt_1';
          if (st === 'AIRBORNE') return this.bounced ? 'down' : 'fall';
          if (st === 'DOWN' || st === 'DEAD') return 'down';
          if (st === 'GETUP') return 'getup';
          return 'idle';
        default: { // le gros
          if (st === 'IDLE') return this.aggressive ? 'guard_' + idiv(this.anim, 10) % 5 : 'idle_' + idiv(this.anim, 14) % 3;
          if (st === 'WALK') return 'walk_' + idiv(this.anim, 6) % 8;
          if (st === 'ATTACK') {
            const s = at.startup, a = at.active;
            if (at === E.FART) { if (t < s) return 'fart_0'; if (t < s + a) return 'fart_' + (1 + Math.min(2, idiv(t - s, 10))); return 'fart_4'; }
            if (t < s) return t < idiv(s, 2) ? 'burp_0' : 'burp_1';
            if (t < s + a) return 'burp_' + (2 + Math.min(3, idiv(t - s, 8)));
            return 'burp_6';
          }
          if (st === 'HURT' || st === 'GRABBED') return this.timer < idiv(this.hurtTime, 2) ? 'hurt_1' : 'hurt_2';
          if (st === 'AIRBORNE') return this.bounced ? 'hurt_4' : 'hurt_3';
          if (st === 'DOWN') return this.hp > 0 ? 'hurt_4' : this.timer < 12 ? 'ko_1' : 'ko_2';
          if (st === 'DEAD') return 'ko_2';
          if (st === 'GETUP') return this.timer < 12 ? 'hurt_5' : 'hurt_6';
          return 'idle_0';
        }
      }
    }
  }

  // ------------------------------------------------------------------ objets, bonus, ondes, particules

  class Barrel {
    constructor(x, y, kind, content) {
      this.x = x; this.y = y; this.kind = kind; this.content = content || null;
      this.hp = kind === 'crate' ? 1 : 2; this.flash = 0; this.removed = false;
      this.halfWidth = Math.max(8, S.decor.width(kind) / 2 - 1);
    }
    debrisColor() { return this.kind === 'crate' ? 'rgb(150,100,55)' : this.kind === 'trash' ? 'rgb(120,120,125)' : 'rgb(40,80,150)'; }
    update() { if (this.flash > 0) this.flash--; }
    sortY() { return this.y; }
    draw(ctx, camX) {
      const sx = Math.round(this.x - camX), sy = Math.round(this.y), hw = Math.round(this.halfWidth);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      oval(ctx, sx - hw - 2, sy - 3, hw * 2 + 4, 6);
      S.decor.draw(ctx, this.kind, sx, sy + 1, 1, this.flash > 0 && (this.flash & 2) !== 0);
    }
  }

  class Item {
    constructor(x, y, kind) { this.x = x; this.y = y; this.kind = kind; this.age = 0; this.removed = false; }
    sortY() { return this.y - 1; }
    draw(ctx, camX) {
      const sx = Math.round(this.x - camX), sy = Math.round(this.y);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      oval(ctx, sx - 8, sy - 2, 16, 4);
      const b = idiv(this.age, 12) % 2;
      const rare = this.kind === KIND.LIFE || this.kind === KIND.STAR || this.kind === KIND.DIAMOND;
      S.bonus.draw(ctx, this.kind.sprite, sx, sy - 1 - b, 1, rare && idiv(this.age, 6) % 8 === 0);
    }
  }

  class Projectile {
    constructor(x, y, z, dir) { this.x = x; this.y = y; this.z = z; this.dir = dir; this.age = 0; this.removed = false; }
    update() { this.x += this.dir * 4.2; this.age++; }
    sortY() { return this.y + 0.5; }
    draw(ctx, camX) {
      const sx = Math.round(this.x - camX), sy = Math.round(this.y);
      ctx.fillStyle = 'rgba(80,170,255,0.2)';
      oval(ctx, sx - 14, sy - 3, 28, 6);
      S.joueur.draw(ctx, 'wave', sx, Math.round(sy - this.z) + 10, this.dir, idiv(this.age, 3) % 4 === 0);
    }
  }
  const WAVE_DAMAGE = 14, WAVE_HW = 12, WAVE_HH = 10;

  class Particle {
    constructor(kind, x, y, z, life) { Object.assign(this, { kind, x, y, z, life, maxLife: life, vx: 0, vy: 0, vz: 0, facing: 1, color: null, text: '' }); }
    static spark(x, y, z, heavy = false) { return new Particle(heavy ? 'HEAVY' : 'SPARK', x, y, z, heavy ? 16 : 12); }
    static dust(x, y, vx) { const p = new Particle('DUST', x, y, 1, 22); p.vx = vx; p.vz = 0.2; return p; }
    static puff(x, y, z, c, life) {
      const p = new Particle('DUST', x, y, z, life + rnd.int(20));
      p.vx = (rnd.f() - 0.5) * 1.6; p.vz = 0.3 + rnd.f() * 0.4; p.color = c; return p;
    }
    static gas(x, y, z) { return Particle.puff(x, y, z, [200, 215, 90], 35); }
    static energyImpact(x, y, z, dir) { const p = new Particle('ENERGY', x, y, z, 18); p.facing = dir; return p; }
    static debris(x, y, z, c) {
      const p = new Particle('DEBRIS', x, y, z, 40 + rnd.int(20));
      p.vx = (rnd.f() - 0.5) * 4; p.vy = (rnd.f() - 0.5) * 1.5; p.vz = 2 + rnd.f() * 3; p.color = c; return p;
    }
    static text(x, y, z, s, c) { const p = new Particle('TEXT', x, y, z, 50); p.vz = 0.8; p.text = s; p.color = c; return p; }
    update() {
      this.life--;
      this.x += this.vx; this.y += this.vy; this.z += this.vz;
      if (this.kind === 'DEBRIS') {
        this.vz -= 0.3;
        if (this.z < 0) { this.z = 0; this.vz = -this.vz * 0.4; this.vx *= 0.6; this.vy *= 0.6; }
      } else if (this.kind === 'DUST') this.vx *= 0.9;
      else if (this.kind === 'TEXT') this.vz *= 0.95;
      return this.life > 0;
    }
    draw(ctx, camX) {
      const sx = Math.round(this.x - camX), sy = Math.round(this.y - this.z), t = 1 - this.life / this.maxLife;
      if (S.effects) {
        const row = this.kind === 'SPARK' ? 'hit' : this.kind === 'HEAVY' ? 'heavy' : this.kind === 'ENERGY' ? 'slash' : this.kind === 'DUST' && !this.color ? 'dust' : null;
        const phase = Math.min(5, idiv((this.maxLife - this.life) * 6, this.maxLife));
        const frame = row && `${row}_${phase}`;
        if (frame && S.effects.frames[frame]) {
          S.effects.draw(ctx, frame, sx, this.kind === 'DUST' ? sy : sy + 36, this.facing, false);
          return;
        }
      }
      if (this.kind === 'SPARK' || this.kind === 'HEAVY' || this.kind === 'ENERGY') {
        const r = Math.round(5 + t * 10), d = Math.round(r * 0.6);
        ctx.strokeStyle = t < 0.4 ? WHITE : this.kind === 'ENERGY' ? 'rgb(120,200,255)' : 'rgb(255,210,60)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy); ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r);
        ctx.moveTo(sx - d, sy - d); ctx.lineTo(sx + d, sy + d); ctx.moveTo(sx - d, sy + d); ctx.lineTo(sx + d, sy - d);
        ctx.stroke();
        const c = Math.round((1 - t) * 6);
        ctx.fillStyle = WHITE;
        if (c > 0) oval(ctx, sx - c, sy - c, c * 2, c * 2);
      } else if (this.kind === 'DUST') {
        const r = Math.round(3 + t * 7), c = this.color || [210, 200, 180];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(1 - t) * 150 / 255})`;
        oval(ctx, sx - r, sy - idiv(r, 2), r * 2, r);
      } else if (this.kind === 'DEBRIS') {
        ctx.fillStyle = this.color;
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
      } else {
        ctx.font = FONT;
        const w = ctx.measureText(this.text).width;
        ctx.fillStyle = '#000'; ctx.fillText(this.text, sx - w / 2 + 1, sy + 1);
        ctx.fillStyle = this.color; ctx.fillText(this.text, sx - w / 2, sy);
      }
    }
  }

  // ------------------------------------------------------------------ décor

  const FACADES = ['facade_0', 'facade_1', 'facade_2', 'facade_3'];
  const PROPS = ['fence', 'fence', 'dumpster', 'dumpster', 'dumpster_open', 'vending', 'payphone', 'tires', 'trash', 'trash', 'hydrant', 'cone'];
  const FACADE_COUNT = 24, PROP_SPACING = 96, LAMP_SPACING = 256;

  class Background {
    constructor() {
      this.facades = [];
      let x = 0, previous = '';
      for (let i = 0; i < FACADE_COUNT; i++) {
        const block = idiv(i, 4), step = 1 + 2 * (hash(block * 7 + 1) % 2);
        let name = FACADES[(hash(block * 13 + 7) + (i % 4) * step) % 4];
        if (name === previous) name = FACADES[(hash(block * 13 + 7) + 2) % 4];
        const w = S.decor.width(name);
        this.facades.push({ name, x, w });
        x += w - 2;
        previous = name;
        const h = hash(i * 29 + 13);
        if (i === 1 || h % 5 < 2) { // terrain vague : on y voit New York jusqu'en bas
          const lw = 90 + (h >> 5) % 80;
          this.facades.push({ name: null, x: x + 2, w: lw });
          x += lw + 2;
          previous = '';
        }
      }
      this.cycle = x;
    }
    draw(ctx, camX) {
      // Panorama de New York, défilement très lent ; miroir une fois sur deux (écran titre sans fin)
      const sw = S.skyline.width('skyline'), off = camX * 0.035, first = Math.floor(off / sw);
      for (let k = first; k <= first + idiv(W, sw) + 1; k++) {
        const sx = Math.round(k * sw - off);
        S.skyline.draw(ctx, 'skyline', sx + idiv(sw, 2), 194, (k & 1) === 0 ? 1 : -1, false);
      }
      this.drawFacades(ctx, camX);
      this.drawGround(ctx, camX);
      this.drawProps(ctx, camX);
    }
    drawFacades(ctx, camX) {
      const off = floorMod(Math.trunc(camX), this.cycle), fenceW = S.decor.width('fence');
      for (let pass = 0; pass < 2; pass++)
        for (let k = 0; k <= 1; k++)
          this.facades.forEach((fc, i) => {
            const sx = fc.x - off + k * this.cycle;
            if (sx > W || sx + fc.w < 0) return;
            const h = hash(i * 11 + 4);
            if (!fc.name) {
              if (pass === 0) return;
              ctx.fillStyle = 'rgba(10,8,20,0.59)';
              ctx.fillRect(sx, 140, fc.w, 10);
              if (h % 2 === 0)
                for (let fx = sx; fx < sx + fc.w - 10; fx += fenceW)
                  S.decor.draw(ctx, 'fence', Math.min(fx + idiv(fenceW, 2), sx + fc.w - idiv(fenceW, 2)), 151, 1, false);
              return;
            }
            if (pass === 0 && h % 3 === 0) S.decor.draw(ctx, 'water_tower', sx + idiv(fc.w, 4) + (h >> 4) % idiv(fc.w, 2), 60, 1, false);
            if (pass === 1) S.decor.draw(ctx, fc.name, sx + idiv(fc.w, 2), 150, 1, false);
          });
    }
    drawGround(ctx, camX) {
      ctx.fillStyle = 'rgb(58,56,66)';
      ctx.fillRect(-20, 181, W + 40, H - 181 + 20);
      ctx.fillStyle = 'rgb(70,68,80)';
      for (let k = 0; k < 160; k++) {
        const h = hash(k + 5000), sx = floorMod(h % 1024 - Math.trunc(camX), 1024);
        if (sx < W) ctx.fillRect(sx, 183 + (h >> 10) % 85, 2, 1);
      }
      ctx.fillStyle = 'rgb(200,190,120)';
      const off2 = floorMod(Math.trunc(camX), 64);
      for (let x = -off2; x < W; x += 64) ctx.fillRect(x, 228, 30, 3);
      // trottoir en vieilles dalles et bordure
      const sw = S.decor.width('slab');
      let first = Math.floor(camX / sw) - 1;
      for (let k = first; k <= first + idiv(W, sw) + 2; k++) {
        const h = hash(k * 5 + 1), sx = Math.round(k * sw - camX);
        S.decor.draw(ctx, 'slab', sx + idiv(sw, 2), 172, (h & 1) === 0 ? 1 : -1, false);
        if (h % 3 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(sx, 150, sw, 22); }
        ctx.fillStyle = 'rgba(30,28,32,0.67)'; ctx.fillRect(sx, 150, 1, 22);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.27)'; ctx.fillRect(-20, 150, W + 40, 2);
      const cw = S.decor.width('curb');
      first = Math.floor(camX / cw) - 1;
      for (let k = first; k <= first + idiv(W, cw) + 2; k++) {
        const sx = Math.round(k * cw - camX);
        S.decor.draw(ctx, 'curb', sx + idiv(cw, 2), 184, 1, false);
        ctx.fillStyle = 'rgba(30,28,32,0.67)'; ctx.fillRect(sx, 172, 1, 12);
      }
      // grilles d'égout et détritus
      first = Math.floor(camX / 160) - 1;
      for (let k = first; k <= first + idiv(W, 160) + 2; k++) {
        const h = hash(k * 17 + 11), sx = Math.round(k * 160 + h % 100 - camX);
        if (h % 5 === 0) S.decor.draw(ctx, 'grate', sx, 200 + (h >> 7) % 50, 1, false);
        else if (h % 5 === 1) S.decor.draw(ctx, 'debris', sx, 185 + (h >> 7) % 75, (h & 2) === 0 ? 1 : -1, false);
      }
    }
    drawProps(ctx, camX) {
      const first = Math.floor(camX / PROP_SPACING) - 1;
      for (let k = first; k <= first + idiv(W, PROP_SPACING) + 2; k++) {
        const h = hash(k * 31 + 5);
        if (h % 100 < 55) continue;
        const wx = k * PROP_SPACING + 30 + (h >> 8) % 30, lampDist = floorMod(wx - 64, LAMP_SPACING);
        if (lampDist < 40 || lampDist > LAMP_SPACING - 40) continue;
        S.decor.draw(ctx, PROPS[(h >> 12) % PROPS.length], Math.round(wx - camX), 156, (h >> 4) % 2 === 0 ? 1 : -1, false);
      }
      const firstLamp = Math.floor((camX - 64) / LAMP_SPACING);
      for (let k = firstLamp; k <= firstLamp + 3; k++) {
        const lx = Math.round(k * LAMP_SPACING + 64 - camX);
        ctx.fillStyle = 'rgba(255,220,140,0.12)';
        oval(ctx, lx - 3, 62, 44, 30);
        oval(ctx, lx - 6, 150, 50, 14);
        S.decor.draw(ctx, 'lamp', lx, 162, 1, false);
      }
    }
  }

  // ------------------------------------------------------------------ niveau

  const sp = (type, delay, left) => ({ type: TYPE[type], delay, left });
  const WAVES = [
    { camX: 220, spawns: [sp('PUNK', 0, false), sp('PUNK', 50, true), sp('PUNK', 140, false)] },
    { camX: 680, spawns: [sp('GROS', 0, false), sp('THUG', 30, true), sp('KNIFE', 160, true)] },
    { camX: 1140, spawns: [sp('BRUTE', 0, false), sp('PUNK', 60, true), sp('GROS', 160, false), sp('THUG', 220, true)] },
    { camX: 1640, spawns: [sp('KNIFE', 0, false), sp('KNIFE', 20, true), sp('GROS', 90, false), sp('BRUTE', 180, true), sp('PUNK', 260, false)] },
    { camX: 2140, spawns: [sp('BRUTE', 0, false), sp('KNIFE', 40, true), sp('GROS', 140, true), sp('GROS', 220, false), sp('KNIFE', 300, false)] },
    { camX: LEVEL_END - W, spawns: [sp('BOSS', 0, false), sp('PUNK', 240, true), sp('KNIFE', 420, false), sp('THUG', 600, true)] },
  ];
  const BREAKABLES = [
    [300, 166, 'crate', 'BOTTLE'], [430, 175, 'crate'], [470, 240, 'barrel'], [620, 164, 'crate', 'PIPE'], [650, 168, 'crate'],
    [780, 215, 'trash'], [960, 200, 'crate', 'KNIFE'], [1080, 166, 'crate', 'GLOVE'], [1250, 232, 'barrel_dented'], [1400, 250, 'crate', 'KNUCKLES'],
    [1530, 165, 'crate', 'BAT'], [1700, 205, 'trash'], [1830, 166, 'crate', 'LIFE'], [1910, 180, 'crate', 'CHAIN'],
    [2060, 168, 'crate', 'SHIELD'], [2230, 236, 'barrel'], [2390, 230, 'crate', 'SNEAKER'], [2520, 165, 'crate'],
    [2550, 170, 'crate', 'STAR'], [2700, 214, 'trash'], [2820, 200, 'crate'], [2960, 167, 'crate'],
  ];

  // ------------------------------------------------------------------ le jeu

  class Game {
    constructor(canvas, input, sound) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.input = input;
      this.snd = sound;
      this.background = new Background();
      this.mode = 'TITLE';
      this.frame = 0; this.modeTimer = 0; this.hitstop = 0; this.shake = 0;
      this.titleScroll = 0; this.camX = 0;
      this.enemies = []; this.barrels = []; this.items = []; this.particles = []; this.projectiles = []; this.remains = [];
      this.banner = ''; this.bannerTimer = 0; this.lastHit = null; this.lastHitTimer = 0;
      this.padWasConnected = false; this.padMsg = ''; this.padMsgTimer = 0; this.titleMusic = false;
      this.hiScore = 20000;
      try { this.hiScore = Math.max(20000, parseInt(localStorage.getItem('streetfury-hi') || '0', 10) || 0); } catch (e) { }
      this.player = new Player(110, 215);
    }
    saveHi() {
      this.hiScore = Math.max(this.hiScore, this.player.score);
      try { localStorage.setItem('streetfury-hi', String(this.hiScore)); } catch (e) { }
    }
    update() {
      this.frame++;
      this.input.sample();
      this.checkPad();
      if (this.padMsgTimer > 0) this.padMsgTimer--;
      this.updateMusic();
      if (this.mode === 'PLAYING' && this.hitstop > 0) { // gel d'impact
        this.hitstop--;
        if (this.shake > 0) this.shake--;
        this.updateParticles();
        return;
      }
      this.input.poll();
      switch (this.mode) {
        case 'TITLE':
          this.titleScroll += 0.6;
          if (this.input.start()) this.newGame();
          break;
        case 'PLAYING':
          if (this.input.pause()) this.mode = 'PAUSED'; else this.updatePlaying();
          break;
        case 'PAUSED':
          if (this.input.pause() || this.input.start()) this.mode = 'PLAYING';
          break;
        default:
          this.modeTimer++;
          this.updateParticles();
          if (this.modeTimer > 60 && this.input.start()) this.mode = 'TITLE';
      }
    }
    /** Musique en boucle tout le temps (titre et partie), un peu moins forte pendant la partie. */
    updateMusic() {
      if (!this.titleMusic) { this.titleMusic = true; this.snd.playMusic(); }
      this.snd.setMusicVolume(this.mode === 'TITLE' ? 0.55 : 0.35);
    }
    checkPad() {
      const c = this.input.padConnected();
      if (c === this.padWasConnected) return;
      this.padWasConnected = c;
      this.padMsg = c ? 'MANETTE CONNECTÉE' : 'MANETTE DÉCONNECTÉE';
      this.padMsgTimer = 150;
      if (!c && this.mode === 'PLAYING') this.mode = 'PAUSED';
      if (c) this.input.rumble(0.4, 12);
    }
    newGame() {
      this.enemies = []; this.items = []; this.particles = []; this.projectiles = []; this.remains = [];
      this.player = new Player(110, 215);
      this.camX = 0;
      this.waveIndex = this.waveTimer = this.spawned = this.goTimer = this.clearTimer = this.hitstop = this.shake = 0;
      this.waveActive = false; this.lastHit = null; this.lastHitTimer = 0;
      this.barrels = BREAKABLES.map(b => new Barrel(b[0], b[1], b[2], b[3] ? KIND[b[3]] : null));
      this.showBanner('STAGE 1 - DOWNTOWN', 150);
      this.mode = 'PLAYING';
      this.modeTimer = 0;
    }
    updatePlaying() {
      if (this.shake > 0) this.shake--;
      if (this.bannerTimer > 0) this.bannerTimer--;
      if (this.goTimer > 0) this.goTimer--;
      if (this.lastHitTimer > 0) this.lastHitTimer--;
      this.updateParticles();
      this.player.update(this, this.input);
      for (const e of this.enemies) e.update(this);
      for (const b of this.barrels) b.update();
      if (this.frame % 20 === 0) this.assignAggressors();
      this.resolveAttack(this.player, this.enemies, true);
      for (const e of this.enemies) this.resolveAttack(e, [this.player], false);
      this.resolveThrows();
      this.updateProjectiles();
      this.separateEnemies();
      this.updateItems();
      this.enemies = this.enemies.filter(e => {
        if (!e.removed) return true;
        this.addScore(e.type.score);
        this.particles.push(Particle.text(e.x, e.y, 50, '+' + e.type.score, YELLOW));
        return false;
      });
      this.barrels = this.barrels.filter(b => !b.removed);
      this.items = this.items.filter(i => !i.removed);
      this.updateCamera();
      this.updateWaves();
      this.checkPlayerDeath();
    }
    updateParticles() { this.particles = this.particles.filter(p => p.update()); }
    assignAggressors() {
      const ready = [];
      for (const e of this.enemies) {
        e.aggressive = false;
        if (e.hp > 0 && e.state !== 'DOWN' && e.state !== 'AIRBORNE' && e.state !== 'GETUP') ready.push(e);
      }
      const p = this.player;
      const score = e => e.type === TYPE.BOSS ? -1 : Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 2;
      ready.sort((a, b) => score(a) - score(b));
      for (let i = 0; i < Math.min(2, ready.length); i++) ready[i].aggressive = true;
    }
    resolveAttack(a, targets, hitsProps) {
      if (!a.isAttackActive()) return;
      const at = a.attack, sc = a.scale;
      const hx1 = a.x + a.facing * at.offset * sc, hx2 = a.x + a.facing * (at.offset + at.reach) * sc;
      const minX = Math.min(hx1, hx2), maxX = Math.max(hx1, hx2);
      const z1 = a.z + at.zLow * sc, z2 = a.z + at.zHigh * sc;
      for (const t of targets) {
        if (t === a || !t.canBeHit() || a.hitSet.has(t)) continue;
        if (Math.abs(t.y - a.y) > 9) continue;
        const hw = t.halfWidth * t.scale, top = t.z + t.height * t.scale;
        if (t.x + hw < minX || t.x - hw > maxX || top < z1 || t.z > z2) continue;
        a.hitSet.add(t);
        const dir = at.offset < 0 ? (t.x >= a.x ? 1 : -1) : a.facing;
        const damage = a instanceof Player ? a.damageFor(at) : at.damage;
        t.takeHit(this, damage, dir, at.knockdown);
        const zc = (Math.max(z1, t.z) + Math.min(z2, top)) / 2;
        if (a instanceof Enemy && a.gasAttack()) this.gasFx(t.x, t.y + 1, zc, at.knockdown);
        else this.hitFx(t.x - dir * 5, t.y + 1, zc, at.knockdown || t.hp === 0);
        if (a instanceof Player) {
          a.onHit(this);
          this.addScore(damage * 10);
          if (at.knockdown) this.input.rumble(0.3, 6);
        }
        if (t === this.player) this.input.rumble(at.knockdown ? 0.9 : 0.5, at.knockdown ? 18 : 8);
        if (t instanceof Enemy) { this.showEnemy(t); this.enemyDamaged(t); }
      }
      if (!hitsProps || z1 > 26) return;
      for (const b of this.barrels) {
        if (b.removed || a.hitSet.has(b)) continue;
        if (Math.abs(b.y - a.y) > 10 || b.x + b.halfWidth < minX || b.x - b.halfWidth > maxX) continue;
        a.hitSet.add(b);
        b.hp--; b.flash = 8;
        this.hitFx(b.x, b.y + 1, 14, false);
        if (a instanceof Player) a.connected = true;
        if (b.hp <= 0) this.breakBarrel(b);
      }
    }
    resolveThrows() {
      for (const e of this.enemies) {
        if (!e.thrown || e.state !== 'AIRBORNE') continue;
        for (const o of this.enemies) {
          if (o === e || !o.canBeHit() || o.z > 20) continue;
          if (Math.abs(o.y - e.y) < 10 && Math.abs(o.x - e.x) < 16) {
            const dir = e.vx >= 0 ? 1 : -1;
            o.takeHit(this, 10, dir, true);
            this.hitFx(o.x - dir * 5, o.y + 1, 20, true);
            this.addScore(100); this.showEnemy(o); this.enemyDamaged(o);
          }
        }
      }
    }
    fireWave(p) {
      this.projectiles.push(new Projectile(p.x + p.facing * 24, p.y, 27, p.facing));
      this.sound('WAVE');
      this.input.rumble(0.3, 8);
    }
    waveInFlight() { return this.projectiles.length > 0; }
    updateProjectiles() {
      for (const w of this.projectiles) {
        w.update();
        if (w.x < this.camX - 40 || w.x > this.camX + W + 40) { w.removed = true; continue; }
        for (const e of this.enemies) {
          if (!e.canBeHit() || Math.abs(e.y - w.y) > 10) continue;
          const top = e.z + e.height * e.scale;
          if (Math.abs(e.x - w.x) > WAVE_HW + e.halfWidth * e.scale) continue;
          if (w.z + WAVE_HH < e.z || w.z - WAVE_HH > top) continue;
          e.takeHit(this, WAVE_DAMAGE, w.dir, true);
          this.waveBurst(w);
          this.addScore(140); this.showEnemy(e); this.enemyDamaged(e);
          break;
        }
        if (w.removed) continue;
        for (const b of this.barrels) {
          if (!b.removed && Math.abs(b.y - w.y) < 10 && Math.abs(b.x - w.x) < WAVE_HW + b.halfWidth) {
            this.breakBarrel(b); this.waveBurst(w); break;
          }
        }
      }
      this.projectiles = this.projectiles.filter(w => !w.removed);
    }
    waveBurst(w) {
      w.removed = true;
      this.hitFx(w.x, w.y + 1, w.z, true);
      this.particles.push(Particle.energyImpact(w.x, w.y, w.z, w.dir));
    }
    separateEnemies() {
      const standing = e => e.z <= 0 && (e.state === 'IDLE' || e.state === 'WALK' || e.state === 'HURT');
      for (let i = 0; i < this.enemies.length; i++) {
        const a = this.enemies[i];
        if (!standing(a)) continue;
        for (let j = i + 1; j < this.enemies.length; j++) {
          const b = this.enemies[j];
          if (!standing(b)) continue;
          const dx = b.x - a.x;
          if (Math.abs(dx) < 12 && Math.abs(b.y - a.y) < 6) { const p = dx >= 0 ? 0.6 : -0.6; a.x -= p; b.x += p; }
        }
      }
    }
    updateItems() {
      const p = this.player;
      for (const it of this.items) {
        it.age++;
        if (it.removed || !p.targetable() || p.z > 0) continue;
        if (p.state === 'DOWN' || p.state === 'AIRBORNE' || p.state === 'GETUP') continue;
        if (Math.abs(it.x - p.x) >= 12 || Math.abs(it.y - p.y) >= 8) continue;
        if (isWeapon(it.kind) && p.weaponHits > 0) continue;
        it.removed = true;
        p.hp = Math.min(p.maxHp, p.hp + it.kind.heal);
        this.addScore(it.kind.score);
        let label, color;
        switch (it.kind) {
          case KIND.LIFE: p.lives = Math.min(9, p.lives + 1); label = '+1 VIE'; color = 'rgb(255,110,140)'; break;
          case KIND.STAR: p.starTimer = STAR_TIME; label = 'INVINCIBLE !'; color = YELLOW; break;
          case KIND.PIPE: case KIND.BAT: case KIND.KNIFE: case KIND.KNUCKLES: case KIND.CHAIN: case KIND.BOTTLE:
            p.weaponKind = it.kind; p.weaponHits = WEAPONS.get(it.kind).hits;
            label = WEAPON_NAME[it.kind.id] + ' !'; color = 'rgb(190,200,220)'; break;
          case KIND.GLOVE: p.powerTimer = POWER_TIME; label = 'FORCE x1,5 !'; color = 'rgb(255,90,70)'; break;
          case KIND.SNEAKER: p.speedTimer = POWER_TIME; label = 'VITESSE !'; color = 'rgb(110,170,255)'; break;
          case KIND.SHIELD: p.shieldTimer = POWER_TIME; label = 'BOUCLIER !'; color = 'rgb(110,170,255)'; break;
          case KIND.MEDKIT: label = 'VIE AU MAX !'; color = 'rgb(0,255,0)'; break;
          default:
            label = it.kind.heal > 0 ? '+' + it.kind.heal + ' PV' : '+' + it.kind.score;
            color = it.kind.heal > 0 ? 'rgb(0,255,0)' : YELLOW;
        }
        this.particles.push(Particle.text(it.x, it.y, 20, label, color));
        this.sound('PICKUP');
        if (it.kind === KIND.LIFE || it.kind === KIND.STAR) this.input.rumble(0.4, 15);
      }
    }
    dropWeapon(x, y, kind) {
      const side = rnd.bool() ? 1 : -1;
      this.items.push(new Item(clamp(x + side * 24, this.camX + 16, this.camX + W - 16), clamp(y, FLOOR_TOP, FLOOR_BOTTOM), kind));
      this.sound('LAND');
    }
    weaponBroke(p) {
      const k = p.weaponKind;
      const c = k === KIND.BAT ? 'rgb(150,95,50)' : k === KIND.BOTTLE ? 'rgb(70,140,60)' : 'rgb(150,155,168)';
      for (let i = 0; i < (k === KIND.BOTTLE ? 16 : 8); i++) this.particles.push(Particle.debris(p.x + p.facing * 20, p.y, 34, c));
      const feminine = k === KIND.BAT || k === KIND.CHAIN || k === KIND.BOTTLE;
      this.particles.push(Particle.text(p.x, p.y, 60, WEAPON_NAME[k.id] + (feminine ? ' CASSÉE' : ' CASSÉ'), 'rgb(190,200,220)'));
      this.sound('BREAK');
    }
    randomLoot(neverEmpty) {
      const total = LOOT_WEIGHT.reduce((a, b) => a + b, 0);
      let r = rnd.int(total + (neverEmpty ? 0 : LOOT_EMPTY));
      for (let i = 0; i < LOOT.length; i++) { if (r < LOOT_WEIGHT[i]) return LOOT[i]; r -= LOOT_WEIGHT[i]; }
      return null;
    }
    sparkle(x, y, z) {
      this.particles.push(Particle.debris(x + rnd.f() * 24 - 12, y, z + 10 + rnd.f() * 35, rnd.bool() ? YELLOW : WHITE));
    }
    breakBarrel(b) {
      b.removed = true;
      this.sound('BREAK');
      this.addScore(100);
      for (let i = 0; i < 12; i++) this.particles.push(Particle.debris(b.x, b.y, 12, b.debrisColor()));
      if (b.kind === 'crate') this.remains.push({ x: b.x, y: b.y });
      const kind = b.content || this.randomLoot(b.kind === 'crate');
      if (kind) this.items.push(new Item(b.x, b.y, kind));
    }
    updateCamera() {
      const limit = this.waveIndex < WAVES.length ? WAVES[this.waveIndex].camX : LEVEL_END - W;
      const target = this.player.x - W * 0.45;
      if (target > this.camX) this.camX = Math.min(target, this.camX + 4, limit);
    }
    updateWaves() {
      if (!this.waveActive && this.waveIndex < WAVES.length && this.camX >= WAVES[this.waveIndex].camX - 0.5) {
        this.waveActive = true; this.waveTimer = 0; this.spawned = 0; this.goTimer = 0;
        if (this.waveIndex === WAVES.length - 1) this.showBanner('!! BIG MAX !!', 120);
      }
      if (this.waveActive) {
        const spawns = WAVES[this.waveIndex].spawns;
        this.waveTimer++;
        while (this.spawned < spawns.length && spawns[this.spawned].delay <= this.waveTimer) this.spawn(spawns[this.spawned++]);
        if (this.spawned === spawns.length && this.enemies.length === 0) {
          this.waveActive = false;
          this.waveIndex++;
          if (this.waveIndex >= WAVES.length) this.clearTimer = 1; else this.goTimer = 240;
        }
      }
      if (this.clearTimer > 0 && ++this.clearTimer > 120) {
        this.addScore(this.player.hp * 50);
        this.saveHi();
        this.mode = 'CLEAR'; this.modeTimer = 0;
      }
    }
    spawn(s) {
      const y = FLOOR_TOP + 12 + rnd.f() * (FLOOR_BOTTOM - FLOOR_TOP - 24);
      const e = new Enemy(s.type, s.left ? this.camX - 30 : this.camX + W + 30, y);
      e.facing = s.left ? 1 : -1;
      this.enemies.push(e);
    }
    checkPlayerDeath() {
      const p = this.player;
      if (p.state !== 'DEAD' || p.timer < 60) return;
      if (p.lives > 0) {
        p.lives--;
        p.respawn(this.camX + W * 0.35);
        for (const e of this.enemies) if (e.hp > 0 && e.canBeHit()) e.launch(e.x < p.x ? -1 : 1, 3, 2.5);
      } else { this.saveHi(); this.mode = 'GAME_OVER'; this.modeTimer = 0; }
    }
    hitFx(x, y, z, heavy) {
      this.particles.push(Particle.spark(x, y, z, heavy));
      this.hitstop = Math.max(this.hitstop, heavy ? 7 : 4);
      if (heavy) this.shake = Math.max(this.shake, 5);
      this.sound(heavy ? 'HEAVY' : 'HIT');
    }
    gasFx(x, y, z, heavy) {
      for (let i = 0; i < 8; i++) this.particles.push(Particle.gas(x + rnd.f() * 16 - 8, y, z));
      this.hitstop = Math.max(this.hitstop, heavy ? 6 : 3);
      if (heavy) this.shake = Math.max(this.shake, 3);
      this.sound('HIT');
    }
    enemyDamaged(e) {
      if (e.hp > 0 || e.type !== TYPE.BOSS) return;
      this.hitstop = 45; this.shake = 15;
      this.sound('KO'); this.input.rumble(1, 50);
      this.showBanner('K.O. !', 150);
      for (const o of this.enemies) {
        if (o !== e && o.hp > 0) {
          o.hp = 0;
          if (o.state === 'GRABBED') this.player.releaseGrab();
          if (o.state !== 'AIRBORNE' && o.state !== 'DOWN') o.launch(o.x < this.player.x ? -1 : 1, 3.5, 2);
        }
      }
    }
    landImpact(f) { this.dust(f.x, f.y); this.shake = Math.max(this.shake, f.scale > 1.2 ? 6 : 2); this.sound('LAND'); }
    dust(x, y) { this.particles.push(Particle.dust(x, y, 0)); }
    sound(fx) { this.snd.play(fx); }
    addScore(n) { this.player.score += n; }
    showEnemy(e) { this.lastHit = e; this.lastHitTimer = 150; }
    showBanner(t, d) { this.banner = t; this.bannerTimer = d; }

    // ---------------------------------------------------------------- rendu

    render() {
      const ctx = this.ctx;
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (this.mode === 'TITLE') this.drawTitle(ctx);
      else {
        this.drawWorld(ctx);
        this.drawHud(ctx);
        const tap = this.input.touch ? 'TOUCHE L\'ÉCRAN' : 'ENTRÉE / START';
        if (this.mode === 'PAUSED') this.overlay(ctx, 'PAUSE', this.input.touch ? 'TOUCHE II POUR REPRENDRE' : 'P / ÉCHAP / START POUR REPRENDRE');
        else if (this.mode === 'GAME_OVER') this.overlay(ctx, 'GAME OVER', tap + ' : RETOUR AU TITRE');
        else if (this.mode === 'CLEAR') this.overlay(ctx, 'STAGE CLEAR !', `SCORE FINAL ${String(this.player.score).padStart(7, '0')}  -  ${tap}`);
      }
      if (this.padMsgTimer > 0) { ctx.font = FONT; this.centered(ctx, this.padMsg, 11, this.padWasConnected ? 'rgb(0,255,0)' : ORANGE); }
    }
    drawWorld(ctx) {
      const ox = this.shake > 0 ? rnd.int(this.shake * 2 + 1) - this.shake : 0;
      const oy = this.shake > 0 ? rnd.int(this.shake + 1) - idiv(this.shake, 2) : 0;
      ctx.save();
      ctx.translate(ox, oy);
      this.background.draw(ctx, this.camX);
      for (const r of this.remains) S.decor.draw(ctx, 'crate_broken', Math.round(r.x - this.camX), Math.round(r.y) + 1, 1, false);
      const list = [...this.items, ...this.barrels, ...this.enemies, ...this.projectiles, this.player];
      list.sort((a, b) => a.sortY() - b.sortY());
      for (const e of list) e.draw(ctx, this.camX, this.frame);
      for (const p of this.particles) p.draw(ctx, this.camX);
      ctx.restore();
    }
    drawHud(ctx) {
      const p = this.player;
      ctx.font = FONT;
      this.text(ctx, p.name, 8, 11, YELLOW);
      this.bar(ctx, 8, 14, 110, 7, p.hp / p.maxHp, YELLOW);
      this.text(ctx, 'x' + p.lives, 123, 21, WHITE);
      this.drawPowerUps(ctx);
      if (p.starTimer > 0) { ctx.fillStyle = YELLOW; ctx.fillRect(8, 23, Math.round(110 * p.starTimer / STAR_TIME), 2); }
      this.text(ctx, 'SCORE ' + String(p.score).padStart(7, '0'), W - 112, 11, WHITE);
      this.text(ctx, 'HI    ' + String(Math.max(this.hiScore, p.score)).padStart(7, '0'), W - 112, 21, 'rgb(255,120,120)');
      if (this.lastHit && this.lastHitTimer > 0) {
        this.text(ctx, this.lastHit.name, 8, 34, WHITE);
        this.bar(ctx, 8, 37, this.lastHit.type === TYPE.BOSS ? 220 : 110, 6, this.lastHit.hp / this.lastHit.maxHp, ORANGE);
      }
      if (this.goTimer > 0 && idiv(this.goTimer, 15) % 2 === 0) {
        ctx.font = BIG_FONT;
        this.text(ctx, 'GO', W - 84, 118, YELLOW);
        const ax = W - 40;
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.moveTo(ax + 1, 99); ctx.lineTo(ax + 21, 110); ctx.lineTo(ax + 1, 121); ctx.fill();
        ctx.fillStyle = YELLOW;
        ctx.beginPath(); ctx.moveTo(ax, 98); ctx.lineTo(ax + 20, 109); ctx.lineTo(ax, 120); ctx.fill();
      }
      if (this.bannerTimer > 0 && this.mode === 'PLAYING') {
        ctx.font = BIG_FONT;
        this.centered(ctx, this.banner, 92, WHITE, 'rgb(200,30,40)');
      }
    }
    drawPowerUps(ctx) {
      const p = this.player, sec = f => idiv(f + 59, 60) + 's', active = [];
      if (p.weaponHits > 0) active.push([p.weaponKind, p.weaponHits > 3 ? 999 : 0, 'x' + p.weaponHits]);
      if (p.starTimer > 0) active.push([KIND.STAR, p.starTimer, sec(p.starTimer)]);
      if (p.powerTimer > 0) active.push([KIND.GLOVE, p.powerTimer, sec(p.powerTimer)]);
      if (p.speedTimer > 0) active.push([KIND.SNEAKER, p.speedTimer, sec(p.speedTimer)]);
      if (p.shieldTimer > 0) active.push([KIND.SHIELD, p.shieldTimer, sec(p.shieldTimer)]);
      let x = 146;
      for (const [kind, left, txt] of active) {
        if (!(left < 120 && idiv(this.frame, 6) % 2 === 0)) {
          S.bonus.draw(ctx, kind.sprite, x + 8, 22, 1, false);
          this.text(ctx, txt, x + 18, 21, WHITE);
        }
        x += 44;
      }
    }
    drawTitle(ctx) {
      this.background.draw(ctx, this.titleScroll);
      ctx.fillStyle = 'rgba(0,0,0,0.59)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = TITLE_FONT;
      this.centered(ctx, 'STREET FURY', 78, YELLOW, 'rgb(200,30,40)');
      ctx.font = FONT;
      this.centered(ctx, 'UN BEAT\'EM ALL DANS LES RUES DE NEW YORK', 96, 'rgb(200,200,210)');
      if (idiv(this.frame, 30) % 2 === 0)
        this.centered(ctx, this.input.touch ? 'TOUCHE L\'ÉCRAN POUR JOUER' : 'APPUIE SUR ENTRÉE OU START', 126, WHITE);
      const help = this.input.touch ? [
        'CROIX ................ SE DÉPLACER',
        'X .................... COUP DE POING',
        'B .................... COUP DE PIED (3e COUP = RENVERSE)',
        'A .................... SAUTER (+ X OU B EN L\'AIR)',
        'Y .................... SPÉCIALE (COÛTE DE LA VIE)',
        'ONDE, ou ↓ ↘ → + X ... ONDE D\'ÉNERGIE',
        'PRISE, ou A+B ........ ATTRAPER, ENCORE : PROJETER',
      ] : [
        'FLÈCHES / ZQSD / WASD .... SE DÉPLACER',
        'J ou X ................... COUP DE POING',
        'K ou C ................... COUP DE PIED (3e COUP = RENVERSE)',
        'ESPACE ................... SAUTER (+ COUP EN L\'AIR)',
        'L, V ou J+K .............. SPÉCIALE (COÛTE DE LA VIE)',
        'BAS, BAS-AVANT, AVANT + J  ONDE D\'ÉNERGIE (ou U)',
        'ESPACE+K ou G ............ ATTRAPER, ENCORE : PROJETER',
        'P / ÉCHAP ................ PAUSE',
      ];
      help.forEach((line, i) => this.text(ctx, line, 92, 144 + i * 12, 'rgb(230,230,180)'));
      if (this.input.padConnected())
        this.centered(ctx, 'MANETTE : X POING  B PIED  A SAUTER  A+B PRISE  Y SPÉCIALE  RB ONDE', 246, 'rgb(0,255,0)');
      this.centered(ctx, 'HI-SCORE ' + String(this.hiScore).padStart(7, '0'), 263, 'rgb(255,120,120)');
    }
    overlay(ctx, title, sub) {
      ctx.fillStyle = 'rgba(0,0,0,0.59)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = BIG_FONT;
      this.centered(ctx, title, 120, YELLOW, 'rgb(200,30,40)');
      ctx.font = FONT;
      if (idiv(this.frame, 30) % 2 === 0 || this.mode === 'PAUSED') this.centered(ctx, sub, 150, WHITE);
    }
    text(ctx, s, x, y, c) {
      ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1);
      ctx.fillStyle = c; ctx.fillText(s, x, y);
    }
    /** Texte centré ; avec un contour, style arcade. */
    centered(ctx, s, y, c, outline) {
      const x = Math.round((W - ctx.measureText(s).width) / 2);
      if (!outline) { this.text(ctx, s, x, y, c); return; }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeText(s, x, y + 1);
      ctx.strokeStyle = outline; ctx.lineWidth = 2.5; ctx.strokeText(s, x, y);
      ctx.fillStyle = c; ctx.fillText(s, x, y);
    }
    bar(ctx, x, y, w, h, ratio, fill) {
      ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = 'rgb(120,20,20)'; ctx.fillRect(x, y, w, h);
      const fw = Math.round(w * clamp(ratio, 0, 1));
      ctx.fillStyle = fill; ctx.fillRect(x, y, fw, h);
      ctx.fillStyle = 'rgba(255,255,255,0.43)'; ctx.fillRect(x, y, fw, 2);
    }
    loading(text) {
      const ctx = this.ctx;
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.font = FONT;
      this.centered(ctx, text, H / 2, WHITE);
    }
  }

  // ------------------------------------------------------------------ démarrage, écran, commandes tactiles

  const canvas = document.getElementById('screen');
  const input = new Input();
  const sound = new Sound();

  function loadImage(src) {
    return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(src)); i.src = src; });
  }

  async function loadAssets() {
    const index = await (await fetch('atlas.json')).json();
    await Promise.all(Object.entries(index).map(async ([name, set]) => { S[name] = new SpriteSet(await loadImage(set.img), set.frames); }));
    const sky = await loadImage('skyline.png');
    S.skyline = new SpriteSet(sky, { skyline: [0, 0, sky.width, sky.height, 0, 0, sky.width, sky.height] });
    if (document.fonts && document.fonts.load) { try { await document.fonts.load('22px Bungee'); } catch (e) { } }
  }

  /** Place l'écran de jeu : en paysage il remplit l'écran, en portrait il occupe le haut et les commandes le bas. */
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, portrait = vh > vw;
    document.body.classList.toggle('portrait', portrait);
    let w = vw, h = vw * 9 / 16;
    if (!portrait && h > vh) { h = vh; w = vh * 16 / 9; }
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
  }

  function setupKeyboard() {
    const used = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Escape']);
    window.addEventListener('keydown', e => {
      sound.unlock();
      if (used.has(e.code)) e.preventDefault();
      if (!e.repeat) input.keyDown(e.code);
    });
    window.addEventListener('keyup', e => input.keyUp(e.code));
    window.addEventListener('blur', () => input.clear());
  }

  /** Croix directionnelle (8 directions) et boutons, en multi-touch. */
  function setupTouch(game) {
    const pad = document.getElementById('dpad'), knob = document.getElementById('knob');
    let padPointer = null;
    const setDir = (cx, cy) => {
      const r = pad.getBoundingClientRect();
      const x = cx - (r.left + r.width / 2), y = cy - (r.top + r.height / 2), rad = r.width / 2;
      const dead = rad * 0.28, len = Math.hypot(x, y);
      if (len < dead) { input.touchX = input.touchY = 0; }
      else {
        const ang = Math.atan2(y, x), oct = Math.round(ang / (Math.PI / 4)); // 8 secteurs
        input.touchX = [1, 1, 0, -1, -1, -1, 0, 1][(oct + 8) % 8];
        input.touchY = [0, 1, 1, 1, 0, -1, -1, -1][(oct + 8) % 8];
      }
      const k = Math.min(1, len / rad) * rad * 0.45;
      knob.style.transform = len > 0 ? `translate(${x / len * k}px, ${y / len * k}px)` : '';
    };
    pad.addEventListener('pointerdown', e => {
      e.preventDefault(); sound.unlock(); input.touch = true;
      padPointer = e.pointerId; pad.setPointerCapture(e.pointerId); setDir(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) setDir(e.clientX, e.clientY); });
    const release = e => {
      if (e.pointerId !== padPointer) return;
      padPointer = null; input.touchX = input.touchY = 0; knob.style.transform = '';
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);

    for (const btn of document.querySelectorAll('[data-b]')) {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); sound.unlock(); input.touch = true;
        input.tap(btn.dataset.b);
        btn.classList.add('on');
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { } }
      });
      const off = () => btn.classList.remove('on');
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    }
    // toucher l'image : démarrer depuis le titre, revenir au titre après la partie, reprendre après une pause
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault(); sound.unlock(); input.touch = true;
      if (game.mode !== 'PLAYING') input.tap('start');
    });
    window.addEventListener('pointerdown', () => document.body.classList.add('touched'), { once: true, passive: true });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  async function main() {
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 200));
    const g0 = canvas.getContext('2d');
    g0.setTransform(RES, 0, 0, RES, 0, 0); g0.fillStyle = '#000'; g0.fillRect(0, 0, W, H);
    g0.fillStyle = WHITE; g0.font = FONT; g0.fillText('CHARGEMENT…', W / 2 - 30, H / 2);
    try { await loadAssets(); }
    catch (e) { g0.fillStyle = '#000'; g0.fillRect(0, 0, W, H); g0.fillStyle = ORANGE; g0.fillText('IMAGES INTROUVABLES', W / 2 - 55, H / 2); return; }
    const game = new Game(canvas, input, sound);
    if (window.__SF_TEST) window.__SF = game; // page de test automatique uniquement
    input.touch = matchMedia('(pointer: coarse)').matches;
    setupKeyboard();
    setupTouch(game);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (game.mode === 'PLAYING') game.mode = 'PAUSED'; sound.stopMusic(); game.titleMusic = false; input.clear(); }
    });
    const STEP = 1000 / 60;
    let last = performance.now(), acc = 0;
    const loop = now => {
      requestAnimationFrame(loop);
      acc += Math.min(250, now - last);
      last = now;
      let n = 0;
      while (acc >= STEP && n < 5) { game.update(); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      if (n > 0) game.render();
    };
    requestAnimationFrame(loop);
  }

  main();
})();
