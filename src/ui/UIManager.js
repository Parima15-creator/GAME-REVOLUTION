// ==========================================================================
// REFLEXRUN 3D - USER INTERFACE & HUD MANAGER
// ==========================================================================

export class UIManager {
  constructor() {
    // HUD Elements
    this.hud = document.getElementById('hud');
    this.distanceEl = document.getElementById('hud-distance');
    this.speedEl = document.getElementById('hud-speed');
    this.comboEl = document.getElementById('hud-combo');
    this.comboFill = document.getElementById('combo-fill');
    this.scoreEl = document.getElementById('hud-score');
    this.bestEl = document.getElementById('hud-best');
    this.caloriesEl = document.getElementById('hud-calories');
    this.bpmEl = document.getElementById('hud-bpm');
    this.heartsEl = document.getElementById('health-hearts');
    this.shieldEl = document.getElementById('shield-indicator');
    this.shieldTimeEl = document.getElementById('shield-countdown');

    // Action Prompts
    this.promptContainer = document.getElementById('action-prompt');
    this.promptIcon = document.getElementById('prompt-icon');
    this.promptText = document.getElementById('prompt-text');
    this.promptSubtext = document.getElementById('prompt-subtext');
    this.feedbackEl = document.getElementById('floating-feedback');

    // Rep Counters
    this.countJumps = document.getElementById('count-jumps');
    this.countSquats = document.getElementById('count-squats');
    this.countPunches = document.getElementById('count-punches');
    this.countSteps = document.getElementById('count-steps');

    this.chipJumps = document.getElementById('rep-jumps');
    this.chipSquats = document.getElementById('rep-squats');
    this.chipPunches = document.getElementById('rep-punches');
    this.chipSteps = document.getElementById('rep-steps');

    // Screen VFX Overlays
    this.damageVignette = document.getElementById('vignette-damage');
    this.speedVignette = document.getElementById('vignette-speed');
    this.chaseVignette = document.getElementById('vignette-chase');
    this.hitFlash = document.getElementById('hit-flash');

    // Rear-view (beast) HUD
    this.rearPanel = document.getElementById('rear-panel');
    this.chaseDistanceEl = document.getElementById('chase-distance');
    this.chaseFillEl = document.getElementById('chase-fill');
    this.mirrorEl = document.getElementById('rear-mirror');

    // Modals
    this.calibrationModal = document.getElementById('calibration-modal');
    this.pauseModal = document.getElementById('pause-modal');
    this.summaryModal = document.getElementById('summary-modal');
    this.tutorialModal = document.getElementById('tutorial-modal');
    this.settingsModal = document.getElementById('settings-modal');

    // Summary Elements
    this.sumGrade = document.getElementById('summary-grade');
    this.sumMessage = document.getElementById('summary-message');
    this.sumScore = document.getElementById('sum-score');
    this.sumBest = document.getElementById('sum-best');
    this.sumCalories = document.getElementById('sum-calories');
    this.sumDistance = document.getElementById('sum-distance');
    this.sumMaxCombo = document.getElementById('sum-max-combo');
    this.sumTime = document.getElementById('sum-time');
    this.sumJumps = document.getElementById('sum-jumps');
    this.sumSquats = document.getElementById('sum-squats');
    this.sumPunches = document.getElementById('sum-punches');
    this.sumSteps = document.getElementById('sum-steps');

    // PIP
    this.pipBox = document.getElementById('webcam-pip');
    this.pipActionTag = document.getElementById('pip-action-tag');
    this.pipIndicator = document.getElementById('pip-status-dot');

    this.feedbackTimeout = null;
    this.promptTimeout = null;
  }

  showHud(show = true) {
    if (show) {
      this.hud.classList.remove('hidden');
    } else {
      this.hud.classList.add('hidden');
    }
  }

  updateStats(stats) {
    // Distance
    this.distanceEl.innerHTML = `${Math.floor(stats.distance)} <span class="unit">M</span>`;
    this.speedEl.textContent = `${Math.floor(stats.speed * 3.6)} KM/H`;

    // Score & personal best
    if (this.scoreEl) this.scoreEl.textContent = Math.floor(stats.score).toLocaleString('en-US');
    if (this.bestEl) this.bestEl.textContent = `BEST ${Math.floor(stats.bestScore || 0).toLocaleString('en-US')}`;

    // Combo
    this.comboEl.textContent = `x${stats.comboMultiplier}`;
    this.comboFill.style.width = `${Math.min(100, stats.comboProgress * 100)}%`;

    // Calories & Heart Rate
    this.caloriesEl.innerHTML = `${stats.caloriesBurned.toFixed(1)} <span class="unit">KCAL</span>`;
    this.bpmEl.textContent = `⚡ ${Math.floor(stats.estimatedBpm)} BPM`;

    // Hearts
    const hearts = this.heartsEl.querySelectorAll('.heart');
    hearts.forEach((h, idx) => {
      if (idx < stats.lives) {
        h.classList.remove('lost');
      } else {
        h.classList.add('lost');
      }
    });
    const shieldRemaining = Math.max(0, stats.shieldRemaining || 0);
    if (this.shieldEl) {
      this.shieldEl.classList.toggle('hidden', shieldRemaining <= 0);
      this.shieldEl.classList.toggle('urgent', shieldRemaining > 0 && shieldRemaining <= 1.5);
    }
    if (this.shieldTimeEl) this.shieldTimeEl.textContent = `${shieldRemaining.toFixed(1)}s`;
    const invulnerable = (stats.invulnerabilityRemaining || 0) > 0;
    document.getElementById('vignette-invulnerable')?.classList.toggle('active', invulnerable);

    // Reps
    this.countJumps.textContent = stats.reps.jumps;
    this.countSquats.textContent = stats.reps.squats;
    this.countPunches.textContent = stats.reps.punches;
    this.countSteps.textContent = stats.reps.steps;
  }

  bumpRep(type) {
    let chip = null;
    if (type === 'jumps') chip = this.chipJumps;
    else if (type === 'squats') chip = this.chipSquats;
    else if (type === 'punches') chip = this.chipPunches;
    else if (type === 'steps') chip = this.chipSteps;

    if (chip) {
      chip.classList.add('bump');
      setTimeout(() => chip.classList.remove('bump'), 180);
    }
  }

  showActionPrompt(action, subtext = '', durationMs = 1200) {
    // Plain glyphs: emoji rendered as multicoloured stickers at 22px and clashed
    // with the HUD type. Arrows also communicate direction faster than a picture.
    const actionIcons = {
      JUMP: '↑',
      SLIDE: '↓',
      PUNCH: '✊',
      'STEP LEFT': '←',
      'STEP RIGHT': '→',
      'MOVE LEFT': '←',
      'MOVE RIGHT': '→',
      'MOVE CENTER': '↓',
      DODGE: '↔',
      RUNNING: '↑',
    };

    this.promptIcon.textContent = actionIcons[action] || '⚡';
    this.promptText.textContent = action;
    this.promptSubtext.textContent = subtext || 'REACT FAST!';

    // Side-rail cue: slides in quietly, no centre-screen banner, no pulse
    this.promptContainer.classList.add('show');
    clearTimeout(this.promptHideTimeout);
    if (durationMs > 0) {
      this.promptHideTimeout = setTimeout(() => {
        this.promptContainer.classList.remove('show');
      }, durationMs);
    }
  }

  hideActionPrompt() {
    clearTimeout(this.promptHideTimeout);
    clearTimeout(this.promptPulseTimeout);
    if (this.promptContainer) {
      this.promptContainer.classList.remove('show');
      this.promptContainer.classList.remove('pulse');
    }
  }

  showFeedback(text, type = 'perfect') {
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `floating-feedback show ${type}`;

    clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => {
      this.feedbackEl.classList.remove('show');
    }, 650);
  }

  triggerDamageVfx() {
    this.damageVignette.style.opacity = '1';
    setTimeout(() => {
      this.damageVignette.style.opacity = '0';
    }, 300);
  }

  triggerHitFlash() {
    this.hitFlash.style.opacity = '0.9';
    setTimeout(() => {
      this.hitFlash.style.opacity = '0';
    }, 80);
  }

  updatePipTag(action) {
    if (this.pipActionTag) {
      this.pipActionTag.textContent = action;
    }
  }

  // Speed vignette: ramps up with run speed to sell the sense of velocity.
  updateSpeedVfx(intensity) {
    if (!this.speedVignette) return;
    this.speedVignette.style.opacity = String(Math.max(0, Math.min(0.65, intensity)));
  }

  // Red danger vignette driven by how close the beast is (0 far → 1 caught).
  updateChaseVfx(closeness) {
    if (!this.chaseVignette) return;
    const t = Math.max(0, Math.min(1, closeness));
    this.chaseVignette.style.opacity = String(t * t * 0.85);
  }

  // Rear-view mirror HUD: distance readout, meter fill and danger styling.
  updateChaseHud(gap) {
    const distEl = this.chaseDistanceEl;
    if (distEl) distEl.textContent = `${Math.max(0, Math.round(gap))} m`;

    const fill = this.chaseFillEl;
    if (fill) {
      // Full bar = beast far away, empty = about to be caught
      const pct = Math.max(0, Math.min(100, ((gap - 2) / 20) * 100));
      fill.style.width = `${pct}%`;
    }

    const panel = this.rearPanel;
    if (panel) {
      panel.classList.toggle('danger', gap < 7);
      panel.classList.toggle('critical', gap < 4);
    }
  }

  showModal(name) {
    this.calibrationModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.summaryModal.classList.add('hidden');
    if (this.tutorialModal) this.tutorialModal.classList.add('hidden');
    if (this.settingsModal) this.settingsModal.classList.add('hidden');

    if (name === 'calibration') this.calibrationModal.classList.remove('hidden');
    if (name === 'pause') this.pauseModal.classList.remove('hidden');
    if (name === 'summary') this.summaryModal.classList.remove('hidden');
    if (name === 'tutorial') { if (this.tutorialModal) this.tutorialModal.classList.remove('hidden'); }
    if (name === 'settings') { if (this.settingsModal) this.settingsModal.classList.remove('hidden'); }
  }

  hideAllModals() {
    this.calibrationModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.summaryModal.classList.add('hidden');
    if (this.tutorialModal) this.tutorialModal.classList.add('hidden');
    if (this.settingsModal) this.settingsModal.classList.add('hidden');
    this.hideActionPrompt();
  }

  showWorkoutSummary(stats) {
    this.showModal('summary');

    let message = 'Good workout! Keep pushing your reflexes.';

    const titleEl = document.getElementById('summary-title');
    if (titleEl) titleEl.textContent = stats.caught ? 'RUN TERMINATED' : 'RUN COMPLETE';
    if (stats.caught) {
      message = 'It lunged when you stumbled. Clear obstacles faster to keep it behind you.';
    }

    this.sumGrade.textContent = 'NEW PERSONAL BEST!';
    this.sumGrade.classList.toggle('hidden', !stats.isNewBest);
    this.sumMessage.textContent = message;
    if (this.sumScore) this.sumScore.textContent = Math.floor(stats.score).toLocaleString('en-US');
    if (this.sumBest) this.sumBest.textContent = Math.floor(stats.bestScore || 0).toLocaleString('en-US');
    this.sumCalories.textContent = stats.caloriesBurned.toFixed(1);
    this.sumDistance.textContent = `${Math.floor(stats.distance)}m`;
    this.sumMaxCombo.textContent = `x${stats.maxCombo}`;

    const mins = Math.floor(stats.elapsedSeconds / 60);
    const secs = Math.floor(stats.elapsedSeconds % 60);
    this.sumTime.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    this.sumJumps.textContent = stats.reps.jumps;
    this.sumSquats.textContent = stats.reps.squats;
    this.sumPunches.textContent = stats.reps.punches;
    this.sumSteps.textContent = stats.reps.steps;
  }

  // Show a transient "NEW BEST!" flourish on the score panel
  showNewBest() {
    if (!this.scoreEl) return;
    this.scoreEl.classList.add('new-best');
    setTimeout(() => this.scoreEl.classList.remove('new-best'), 1200);
  }
}
