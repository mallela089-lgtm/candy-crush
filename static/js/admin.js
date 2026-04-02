/* global fetch */
(() => {
  "use strict";

  const el = {
    cfgGrid: document.getElementById("cfg-grid"),
    cfgCandy: document.getElementById("cfg-candy"),
    cfgBaseScore: document.getElementById("cfg-base-score"),
    cfgComboBonus: document.getElementById("cfg-combo-bonus"),
    cfgCascadeBonus: document.getElementById("cfg-cascade-bonus"),
    cfgMaxMult: document.getElementById("cfg-max-mult"),
    btnSaveConfig: document.getElementById("btn-save-config"),
    cfgMsg: document.getElementById("cfg-msg"),

    statsTotalPlays: document.getElementById("stats-total-plays"),
    statsTableBody: document.getElementById("stats-table-body"),
    btnResetLevels: document.getElementById("btn-reset-levels"),

    formCreateLevel: document.getElementById("form-create-level"),
    createLevelNumber: document.getElementById("create-level-number"),
    createTimeLimit: document.getElementById("create-time-limit"),
    createTargetScore: document.getElementById("create-target-score"),
    createObjectiveClear: document.getElementById("create-objective-clear"),
    createDifficulty: document.getElementById("create-difficulty"),
    createBlockerCount: document.getElementById("create-blocker-count"),
    createLockedCount: document.getElementById("create-locked-count"),
    createLockedHealth: document.getElementById("create-locked-health"),
    createPatternSeed: document.getElementById("create-pattern-seed"),
    createMsg: document.getElementById("create-msg"),

    editLevelId: document.getElementById("edit-level-id"),
    editTimeLimit: document.getElementById("edit-time-limit"),
    editTargetScore: document.getElementById("edit-target-score"),
    editObjectiveClear: document.getElementById("edit-objective-clear"),
    editDifficulty: document.getElementById("edit-difficulty"),
    editBlockerCount: document.getElementById("edit-blocker-count"),
    editLockedCount: document.getElementById("edit-locked-count"),
    editLockedHealth: document.getElementById("edit-locked-health"),
    editPatternSeed: document.getElementById("edit-pattern-seed"),
    btnSaveLevel: document.getElementById("btn-save-level"),
    btnDeleteLevel: document.getElementById("btn-delete-level"),
    editMsg: document.getElementById("edit-msg"),

    levelsTableBody: document.getElementById("levels-table-body"),
  };

  async function api(path, options = {}) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function loadConfig() {
    const data = await api("/admin/api/config", { method: "GET" });
    const cfg = data.config || {};
    el.cfgGrid.value = cfg.grid_size ?? 8;
    el.cfgCandy.value = cfg.candy_types ?? 5;
    el.cfgBaseScore.value = cfg.scoring?.base_score_per_candy ?? 10;
    el.cfgComboBonus.value = cfg.scoring?.combo_bonus_per_combo ?? 15;
    el.cfgCascadeBonus.value = cfg.scoring?.cascade_bonus_per_cascade ?? 25;
    el.cfgMaxMult.value = cfg.scoring?.max_combo_multiplier ?? 6;
  }

  function showCfgMsg(msg) {
    el.cfgMsg.textContent = msg;
    setTimeout(() => {
      el.cfgMsg.textContent = "";
    }, 2500);
  }

  async function saveConfig() {
    try {
      const scoring = {
        base_score_per_candy: parseInt(el.cfgBaseScore.value, 10) || 10,
        combo_bonus_per_combo: parseInt(el.cfgComboBonus.value, 10) || 15,
        cascade_bonus_per_cascade: parseInt(el.cfgCascadeBonus.value, 10) || 25,
        max_combo_multiplier: parseInt(el.cfgMaxMult.value, 10) || 6,
      };

      await api("/admin/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grid_size: parseInt(el.cfgGrid.value, 10) || 8,
          candy_types: parseInt(el.cfgCandy.value, 10) || 5,
          scoring_rules_json: JSON.stringify(scoring),
          base_score_per_candy: scoring.base_score_per_candy,
          combo_bonus_per_combo: scoring.combo_bonus_per_combo,
          cascade_bonus_per_cascade: scoring.cascade_bonus_per_cascade,
          max_combo_multiplier: scoring.max_combo_multiplier,
        }),
      });

      showCfgMsg("Config saved.");
      await loadLevelsTable();
      await loadStats();
    } catch (err) {
      showCfgMsg(`Error: ${err.message}`);
    }
  }

  async function loadLevelsTable() {
    const data = await api("/admin/api/levels", { method: "GET" });
    const levels = data.levels || [];

    el.levelsTableBody.innerHTML = "";
    for (const lvl of levels) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${lvl.level_number ?? ""}</td>
        <td>${lvl.time_limit_seconds ?? ""}</td>
        <td>${lvl.target_score ?? ""}</td>
        <td>${lvl.objective_clear ?? ""}</td>
        <td>
          <button class="btn btn-sm btn-outline-light" data-edit-id="${lvl.id}">Edit</button>
        </td>
      `;
      const btn = tr.querySelector("button[data-edit-id]");
      btn.addEventListener("click", async () => {
        const level = await api(`/admin/api/levels/${lvl.id}`, { method: "GET" });
        populateEditForm(level.level);
      });
      el.levelsTableBody.appendChild(tr);
    }
  }

  function populateEditForm(lvl) {
    el.editLevelId.value = lvl.id;
    el.editTimeLimit.value = lvl.time_limit_seconds;
    el.editTargetScore.value = lvl.target_score;
    el.editObjectiveClear.value = lvl.objective_clear;
    el.editDifficulty.value = lvl.difficulty;
    el.editBlockerCount.value = lvl.blocker_count;
    el.editLockedCount.value = lvl.locked_candy_count;
    el.editLockedHealth.value = lvl.locked_candy_health;
    el.editPatternSeed.value = lvl.pattern_seed;
    el.editMsg.textContent = "";
  }

  function showEditMsg(msg) {
    el.editMsg.textContent = msg;
    setTimeout(() => {
      el.editMsg.textContent = "";
    }, 2500);
  }

  async function createLevel(e) {
    e.preventDefault();
    const payload = {
      level_number: parseInt(el.createLevelNumber.value, 10) || 1,
      time_limit_seconds: parseInt(el.createTimeLimit.value, 10) || 60,
      target_score: parseInt(el.createTargetScore.value, 10) || 0,
      objective_clear: parseInt(el.createObjectiveClear.value, 10) || 0,
      difficulty: parseInt(el.createDifficulty.value, 10) || 1,
      blocker_count: parseInt(el.createBlockerCount.value, 10) || 0,
      locked_candy_count: parseInt(el.createLockedCount.value, 10) || 0,
      locked_candy_health: parseInt(el.createLockedHealth.value, 10) || 2,
      pattern_seed: parseInt(el.createPatternSeed.value, 10) || 0,
    };

    try {
      el.createMsg.textContent = "";
      await api("/admin/api/levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      el.createMsg.textContent = "Level created.";
      await loadLevelsTable();
      await loadStats();
    } catch (err) {
      el.createMsg.textContent = `Error: ${err.message}`;
    }
  }

  async function saveEditedLevel() {
    const levelId = parseInt(el.editLevelId.value, 10);
    if (!levelId) return;

    const payload = {
      time_limit_seconds: parseInt(el.editTimeLimit.value, 10),
      target_score: parseInt(el.editTargetScore.value, 10),
      objective_clear: parseInt(el.editObjectiveClear.value, 10),
      difficulty: parseInt(el.editDifficulty.value, 10),
      blocker_count: parseInt(el.editBlockerCount.value, 10),
      locked_candy_count: parseInt(el.editLockedCount.value, 10),
      locked_candy_health: parseInt(el.editLockedHealth.value, 10),
      pattern_seed: parseInt(el.editPatternSeed.value, 10),
    };

    try {
      await api(`/admin/api/levels/${levelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showEditMsg("Level updated.");
      await loadLevelsTable();
      await loadStats();
    } catch (err) {
      showEditMsg(`Error: ${err.message}`);
    }
  }

  async function deleteEditedLevel() {
    const levelId = parseInt(el.editLevelId.value, 10);
    if (!levelId) return;
    if (!confirm("Delete this level?")) return;

    try {
      await api(`/admin/api/levels/${levelId}`, { method: "DELETE" });
      showEditMsg("Level deleted.");
      await loadLevelsTable();
      await loadStats();
    } catch (err) {
      showEditMsg(`Error: ${err.message}`);
    }
  }

  async function loadStats() {
    const data = await api("/admin/api/stats", { method: "GET" });
    const total = data.total_plays ?? 0;
    el.statsTotalPlays.textContent = String(total);

    el.statsTableBody.innerHTML = "";
    const levels = data.completion_rate_by_level || [];
    for (const item of levels) {
      const completionRate = item.completion_rate === null ? "—" : `${Math.round(item.completion_rate * 100)}%`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.level_number}</td>
        <td>${item.attempts}</td>
        <td>${item.completions}</td>
        <td>${completionRate}</td>
      `;
      el.statsTableBody.appendChild(tr);
    }
  }

  async function resetLevels() {
    if (!confirm("Reset levels (re-seed default 100 levels)? Stats are kept.")) return;
    try {
      await api("/admin/api/reset", { method: "POST" });
      await loadLevelsTable();
      await loadStats();
      showCfgMsg("Levels reset.");
    } catch (err) {
      showCfgMsg(`Error: ${err.message}`);
    }
  }

  // Bindings
  el.btnSaveConfig.addEventListener("click", saveConfig);
  el.btnResetLevels.addEventListener("click", resetLevels);
  el.formCreateLevel.addEventListener("submit", createLevel);
  el.btnSaveLevel.addEventListener("click", saveEditedLevel);
  el.btnDeleteLevel.addEventListener("click", deleteEditedLevel);

  // Boot
  loadConfig()
    .then(() => loadLevelsTable())
    .then(() => loadStats())
    .catch((err) => {
      console.error(err);
      showCfgMsg(`Error: ${err.message}`);
    });
})();

