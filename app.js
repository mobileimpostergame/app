"use strict";

const GROQ_API_KEY = "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";
const GROQ_MODEL = "llama-3.1-8b-instant";

const STORAGE_KEY = "the-imposter-game-settings-v1";
const RECENT_WORDS_KEY = "the-imposter-game-recent-words-v1";
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 100;
const GROQ_REQUEST_TIMEOUT_MS = 12000;

const SYSTEM_PROMPT = [
  "You generate content for a mobile social deduction party game.",
  "Return only valid JSON. Do not include markdown, comments, code fences, or explanation text.",
  "Use this exact JSON shape: {\"category\":\"...\",\"secret_word\":\"...\",\"imposter_clue\":\"...\",\"alt_clues\":[\"...\",\"...\"]}.",
  "Make the round fun, social, casual, and easy for normal friends at a party.",
  "Category must be everyday and playful, such as food, animals, movies, TV, music, brands, holidays, places, jobs, sports, objects, celebrities, games, apps, drinks, school, fashion, or hobbies.",
  "Avoid hard, nerdy, academic, historical, scientific, classical, obscure, political, or old-fashioned topics.",
  "Do not use categories like Historical Event, Scientist, Classical Musician, Philosophy, Ancient History, War, Literature, Chemistry, Physics, or Biology.",
  "Secret word must be common, modern, instantly understandable, and easy to talk about without specialist knowledge.",
  "Avoid obscure people, old classical figures, dates, technical terms, and school-test answers.",
  "Imposter clue must be a single word related to the secret word.",
  "The clue must be subtle, natural, believable, and slightly misleading to make other people think they aren't imposter.",
  "The clue must not be the secret word, a synonym that gives it away, lazy, generic, or NPC basic.",
  "Keep all values concise. Proper nouns are allowed only if most people would know them."
].join(" ");

const defaultPlayers = ["Player 1", "Player 2", "Player 3, "Player 4"].map((name) => ({
  id: createId(),
  name
}));

const defaultSettings = {
  imposterMode: "fixed",
  fixedCount: 1,
  rangeMin: 0,
  rangeMax: 2,
  showCategoryToImposter: true,
  showHintToImposter: true,
  impostersKnowEachOther: true
};

const state = {
  screen: "home",
  players: defaultPlayers,
  settings: { ...defaultSettings },
  round: null,
  selectedPlayerId: null,
  revealOpened: false,
  loading: {
    attempt: 0,
    failed: false,
    message: "Preparing the room",
    startedAt: 0,
    error: ""
  },
  loadingRunId: 0,
  finalTyped: "",
  finalTyping: false,
  typingRunId: 0
};

const app = document.querySelector("#app");
let loadingTickerId = 0;

hydrateSettings();
clampImposterSettings();
render();
registerServiceWorker();

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case "show-home":
      cancelLoading();
      state.round = null;
      setScreen("home");
      break;
    case "show-players-editor":
      setScreen("players-editor");
      break;
    case "show-imposters":
      setScreen("imposters");
      break;
    case "back":
      goBack();
      break;
    case "toggle":
      toggleSetting(target.dataset.setting);
      break;
    case "add-player":
      addPlayer();
      break;
    case "remove-player":
      removePlayer(id);
      break;
    case "remove-last-player":
      removePlayer(state.players[state.players.length - 1]?.id);
      break;
    case "set-imposter-mode":
      setImposterMode(target.dataset.mode);
      break;
    case "step":
      stepSetting(target.dataset.setting, Number(target.dataset.delta));
      break;
    case "start-game":
      startGame();
      break;
    case "cancel-loading":
      cancelLoading();
      state.round = null;
      setScreen("home");
      break;
    case "open-player":
      openPlayerReveal(id);
      break;
    case "open-reveal":
      revealCurrentPlayer();
      break;
    case "got-it":
      completeCurrentReveal();
      break;
    case "reveal-results":
      revealFinalResults();
      break;
    case "play-again":
      startGame();
      break;
    case "edit-settings":
      state.round = null;
      setScreen("home");
      break;
    default:
      break;
  }
});

app.addEventListener("pointerdown", (event) => {
  const target = event.target.closest("[data-action='open-reveal']");
  if (!target || state.revealOpened) return;
  event.preventDefault();
  revealCurrentPlayer();
});

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-player-input]");
  if (!input) return;
  const player = state.players.find((item) => item.id === input.dataset.id);
  if (!player) return;
  player.name = cleanName(input.value);
  saveSettings();
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const input = event.target.closest("[data-player-input]");
  if (input) input.blur();
});

function hydrateSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.players) && saved.players.length >= MIN_PLAYERS) {
      state.players = saved.players
        .slice(0, MAX_PLAYERS)
        .map((player, index) => ({
          id: typeof player.id === "string" ? player.id : createId(),
          name: cleanName(player.name || `Player ${index + 1}`) || `Player ${index + 1}`
        }));
    }
    if (saved.settings && typeof saved.settings === "object") {
      state.settings = { ...defaultSettings, ...saved.settings };
    }
  } catch {
    state.players = defaultPlayers;
    state.settings = { ...defaultSettings };
  }
}

function saveSettings() {
  const payload = {
    players: state.players,
    settings: state.settings
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function render() {
  const screen = state.screen;
  if (screen === "home") app.innerHTML = renderHome();
  if (screen === "players-editor") app.innerHTML = renderPlayersEditor();
  if (screen === "imposters") app.innerHTML = renderImposters();
  if (screen === "loading") app.innerHTML = renderLoading();
  if (screen === "players") app.innerHTML = renderPlayersRound();
  if (screen === "reveal") app.innerHTML = renderReveal();
  if (screen === "final") app.innerHTML = renderFinalSplash();
  if (screen === "result") app.innerHTML = renderResult();
}

function setScreen(screen) {
  state.screen = screen;
  render();
  requestAnimationFrame(() => {
    app.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo(0, 0);
  });
}

function goBack() {
  if (state.screen === "players-editor" || state.screen === "imposters") {
    clampImposterSettings();
    saveSettings();
    setScreen("home");
    return;
  }
  if (state.screen === "players") {
    state.round = null;
    setScreen("home");
    return;
  }
  if (state.screen === "reveal") {
    if (state.revealOpened) {
      completeCurrentReveal();
    } else {
      state.selectedPlayerId = null;
      setScreen("players");
    }
    return;
  }
  if (state.screen === "final") {
    setScreen("players");
    return;
  }
  if (state.screen === "result") {
    setScreen("final");
  }
}

function renderHome() {
  const imposterSummary = getImposterSummary();
  return `
    <section class="screen home-screen">
      <header class="app-header">
        <div class="brand-lockup">
          <div class="logo-mark" aria-hidden="true">
            <span class="logo-dot one"></span>
            <span class="logo-dot two"></span>
            <span class="logo-dot three"></span>
          </div>
          <h1 class="title-small">Imposter</h1>
        </div>
      </header>

      <div class="stats-grid">
        <button class="stat-card" type="button" data-action="show-players-editor">
          <span class="setting-icon">${icon("users")}</span>
          <span class="stat-label">How many players?</span>
          <span class="stat-value">${state.players.length}</span>
        </button>
        <button class="stat-card" type="button" data-action="show-imposters">
          <span class="setting-icon">${icon("userSearch")}</span>
          <span class="stat-label">How many imposters?</span>
          <span class="stat-value">${escapeHtml(imposterSummary.short)}</span>
        </button>
      </div>

      <h2 class="section-title"><span class="tiny-icon">${icon("category")}</span>Round Setup</h2>
      <div class="settings-card">
        ${renderToggleRow("eye", "Show Category to Imposter", "showCategoryToImposter")}
        ${renderToggleRow("bulb", "Show Hint to Imposter", "showHintToImposter")}
        ${renderToggleRow("team", "Imposters Know Each Other", "impostersKnowEachOther")}
      </div>

      <button class="button home-action" type="button" data-action="start-game">Start Game</button>
    </section>
  `;
}

function renderToggleRow(iconName, label, setting) {
  const on = Boolean(state.settings[setting]);
  return `
    <div class="settings-row">
      <span class="tiny-icon">${icon(iconName)}</span>
      <div class="row-main">
        <h3>${escapeHtml(label)}</h3>
      </div>
      <button class="toggle ${on ? "on" : ""}" type="button" role="switch" aria-checked="${on}" data-action="toggle" data-setting="${setting}">
        <span class="sr-only">${escapeHtml(label)}</span>
      </button>
    </div>
  `;
}

function renderPlayersEditor() {
  return `
    <section class="screen">
      <header class="app-header center-title">
        <button class="nav-button" type="button" aria-label="Back" data-action="back">${icon("back")}</button>
        <h1 class="title-small">Player Names</h1>
        <span class="nav-spacer"></span>
      </header>

      <div class="editor-summary glow">
        <span class="summary-icon">${icon("users")}</span>
        <div class="summary-copy">
          <h2>${state.players.length} Players</h2>
          <p>${MIN_PLAYERS}-${MAX_PLAYERS}</p>
        </div>
      </div>

      <div class="player-list">
        ${state.players.map(renderPlayerRow).join("")}
      </div>

      <div class="editor-actions">
        <button class="outline-button red" type="button" data-action="remove-last-player" ${state.players.length <= MIN_PLAYERS ? "disabled" : ""}>
          ${icon("minusUser")} Remove
        </button>
        <button class="outline-button" type="button" data-action="add-player" ${state.players.length >= MAX_PLAYERS ? "disabled" : ""}>
          ${icon("plusUser")} Add
        </button>
      </div>
    </section>
  `;
}

function renderPlayerRow(player, index) {
  return `
    <div class="player-row">
      <span class="avatar-small">${escapeHtml(initialFor(player.name))}</span>
      <input
        class="player-input"
        data-player-input
        data-id="${escapeHtml(player.id)}"
        value="${escapeHtml(player.name)}"
        maxlength="22"
        spellcheck="false"
        autocomplete="off"
        aria-label="Player ${index + 1} name"
      />
      <span class="player-index">#${index + 1}</span>
      <button class="delete-button" type="button" aria-label="Remove ${escapeHtml(player.name)}" data-action="remove-player" data-id="${escapeHtml(player.id)}" ${state.players.length <= MIN_PLAYERS ? "disabled" : ""}>
        ${icon("x")}
      </button>
    </div>
  `;
}

function renderImposters() {
  const mode = state.settings.imposterMode;
  return `
    <section class="screen">
      <header class="app-header center-title">
        <button class="nav-button" type="button" aria-label="Back" data-action="back">${icon("back")}</button>
        <h1 class="title-small">Imposter Count</h1>
        <span class="nav-spacer"></span>
      </header>

      <h2 class="title-medium">How many imposters?</h2>
      <p class="subtext">${escapeHtml(getImposterSummary().detail)}</p>

      <div class="segmented">
        ${renderSegment("fixed", "Fixed")}
        ${renderSegment("range", "Range")}
        ${renderSegment("chaos", "Chaos")}
      </div>

      <div class="count-panel">
        ${mode === "fixed" ? renderCountStepper("fixedCount", "Fixed imposters", "Always use this many imposters.") : ""}
        ${mode === "range" ? renderRangePanel() : ""}
        ${mode === "chaos" ? renderChaosPanel() : ""}
      </div>

      <p class="empty-note">The selected count is resolved when the round starts, then hidden until the final reveal.</p>
    </section>
  `;
}

function renderSegment(mode, label) {
  const active = state.settings.imposterMode === mode;
  return `
    <button class="segment ${active ? "active" : ""}" type="button" data-action="set-imposter-mode" data-mode="${mode}">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderCountStepper(setting, title, text) {
  const value = state.settings[setting];
  return `
    <div class="count-row">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
      <div class="stepper">
        <button class="step-button" type="button" data-action="step" data-setting="${setting}" data-delta="-1" aria-label="Decrease">${icon("minus")}</button>
        <span class="step-number">${value}</span>
        <button class="step-button" type="button" data-action="step" data-setting="${setting}" data-delta="1" aria-label="Increase">${icon("plus")}</button>
      </div>
    </div>
  `;
}

function renderRangePanel() {
  return `
    ${renderCountStepper("rangeMin", "Minimum", "Lowest possible imposters, including no one.")}
    ${renderCountStepper("rangeMax", "Maximum", "Highest possible imposters.")}
  `;
}

function renderChaosPanel() {
  return `
    <div class="count-row">
      <div>
        <h3>Chaos mode</h3>
        <p>It could be any number of imposters. It could be no one, or it could be anyone.</p>
      </div>
    </div>
  `;
}

function renderLoading() {
  const message = getLoadingMessage();
  return `
    <section class="loading-screen">
      <div class="loading-orb" aria-hidden="true"></div>
      <h1>Finding a fresh secret</h1>
      <p>Groq is generating a new category, word, and imposter clue for this round.</p>
      <div class="loading-status">
        <span class="loading-dots" data-loading-status>${escapeHtml(message)}</span>
        ${state.loading.error ? `<p style="margin-top: 10px;">${escapeHtml(state.loading.error)}</p>` : ""}
      </div>
      <button class="button secondary" type="button" data-action="cancel-loading">Cancel</button>
    </section>
  `;
}

function getLoadingMessage() {
  const attempt = state.loading.attempt || 1;
  if (state.loading.failed) return `Failed, re-attempting. Attempt ${attempt}`;
  const elapsed = state.loading.startedAt ? Math.floor((Date.now() - state.loading.startedAt) / 1000) : 0;
  if (elapsed < 4) return `Asking Groq. Attempt ${attempt}`;
  if (elapsed < 9) return `Still waiting on Groq. ${elapsed}s`;
  return `Taking longer than usual. Retrying soon. ${elapsed}s`;
}

function renderPlayersRound() {
  if (!state.round) return renderMissingRound();
  const revealed = new Set(state.round.revealedIds);
  return `
    <section class="screen">
      <header class="app-header">
        <button class="nav-button" type="button" aria-label="Back" data-action="back">${icon("back")}</button>
        <span class="nav-spacer"></span>
      </header>
      <h1 class="title-medium">Players</h1>
      <p class="subtext">Tap your name to reveal your word, then pass the device to the next player.</p>
      <div class="players-grid">
        ${state.players.map((player) => renderRoundPlayerCard(player, revealed.has(player.id))).join("")}
      </div>
    </section>
  `;
}

function renderRoundPlayerCard(player, isRevealed) {
  return `
    <button
      class="player-card ${isRevealed ? "revealed" : ""}"
      type="button"
      data-action="${isRevealed ? "" : "open-player"}"
      data-id="${escapeHtml(player.id)}"
      ${isRevealed ? "disabled" : ""}
      aria-label="${escapeHtml(player.name)} ${isRevealed ? "revealed" : "waiting"}"
    >
      ${isRevealed ? `<span class="lock-chip">${icon("lock")} Viewed</span>` : ""}
      <span class="avatar-large">${escapeHtml(initialFor(player.name))}</span>
      <span class="player-name">${escapeHtml(player.name)}</span>
    </button>
  `;
}

function renderReveal() {
  if (!state.round) return renderMissingRound();
  const player = getSelectedPlayer();
  if (!player) return renderMissingRound();
  const isImposter = state.round.imposterIds.includes(player.id);
  const categoryLabel = getRevealCategoryLabel(isImposter);
  const revealedClass = state.revealOpened ? (isImposter ? "imposter burst" : "word burst") : "ready";
  const showGotIt = state.revealOpened;
  const roleClass = state.revealOpened ? (isImposter ? "is-imposter" : "is-word") : "is-hidden";

  return `
    <section class="screen center-screen reveal-screen ${roleClass}">
      <header class="app-header">
        <button class="nav-button" type="button" aria-label="Back" data-action="back">${icon("back")}</button>
        <span class="nav-spacer"></span>
      </header>

      <div class="reveal-layout">
        <div class="reveal-center">
          <p class="word-for">The word for <span class="accent-text">${escapeHtml(player.name)}</span></p>
          <h1 class="category-title">Category: ${escapeHtml(categoryLabel)}</h1>

          <button class="reveal-card ${revealedClass}" type="button" data-action="${state.revealOpened ? "" : "open-reveal"}" ${state.revealOpened ? "disabled" : ""} aria-label="Tap the box to reveal">
            ${state.revealOpened ? "" : revealIdleArt()}
            ${state.revealOpened && isImposter ? `<span class="imposter-word">Imposter</span>` : ""}
            ${state.revealOpened && !isImposter ? `<span class="revealed-word">${escapeHtml(state.round.secretWord)}</span>` : ""}
          </button>

          ${state.revealOpened ? "" : `<div class="tap-hint">${icon("tap")} Tap the box to reveal</div>`}
          ${state.revealOpened && isImposter ? renderImposterBubbles(player) : ""}
          ${showGotIt ? `<button class="button reveal-got-it" type="button" data-action="got-it">Got it!</button>` : ""}
        </div>
      </div>
    </section>
  `;
}

function renderImposterBubbles(player) {
  const bubbles = [];
  if (state.settings.showHintToImposter) {
    bubbles.push(`
      <div class="info-bubble">
        <p class="bubble-label gold">${icon("bulb")} Your Clue</p>
        <p class="bubble-value">${escapeHtml(state.round.imposterClue)}</p>
        <p class="bubble-note">Use this in the first round to blend in.</p>
      </div>
    `);
  }
  if (state.settings.impostersKnowEachOther) {
    const teammates = state.round.imposterIds
      .filter((id) => id !== player.id)
      .map((id) => state.players.find((item) => item.id === id)?.name)
      .filter(Boolean);
    bubbles.push(`
      <div class="info-bubble">
        <p class="bubble-label">${icon("team")} Your Teammates</p>
        <p class="bubble-value">${escapeHtml(teammates.length ? teammates.join(", ") : "Just You")}</p>
      </div>
    `);
  }
  if (!bubbles.length) return "";
  return `<div class="reveal-bubbles">${bubbles.join("")}</div>`;
}

function renderFinalSplash() {
  if (!state.round) return renderMissingRound();
  const direction = state.round.direction;
  const starter = state.players.find((player) => player.id === state.round.starterId)?.name || "Someone";
  return `
    <section class="screen final-screen">
      <header class="app-header">
        <button class="nav-button" type="button" aria-label="Back" data-action="back">${icon("back")}</button>
        <span class="nav-spacer"></span>
      </header>
      <h1 class="title-medium">Voting Phase</h1>
      <p class="subtext">Time to discuss, accuse, and decide who is staring a little too hard.</p>

      <div class="final-card-list">
        ${renderPhaseCard("person", "Starting Player", `${starter} starts the round`, "blue", 1)}
        ${renderPhaseCard("team", "Vote Time", "Each player says a word related to the secret twice.", "purple", 2)}
        ${renderPhaseCard("rotate", "Group Discussion", `Go ${direction}. Each player says one related word.`, "gold", 3)}
        ${renderPhaseCard("eye", "Reveal Phase", "Vote first, then reveal the result here.", "red", 4)}
      </div>

      <button class="button danger final-action" type="button" data-action="reveal-results">Reveal Results</button>
    </section>
  `;
}

function renderPhaseCard(iconName, title, text, tone, number) {
  return `
    <div class="phase-card ${tone}">
      <span class="phase-icon">${icon(iconName)}<span class="phase-badge">${number}</span></span>
      <div class="phase-copy">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    </div>
  `;
}

function renderResult() {
  if (!state.round) return renderMissingRound();
  const done = !state.finalTyping;
  const typed = state.finalTyped || "";
  return `
    <section class="modal-shell">
      <div class="result-modal">
        <p class="result-eyebrow">The table goes quiet</p>
        <h1>${getResultTitle()}</h1>
        <div class="typed-names">
          <span>${escapeHtml(typed)}${state.finalTyping ? `<span class="cursor">|</span>` : ""}</span>
        </div>
        ${done ? `
          <div class="secret-result">
            <span>Secret Word</span>
            <strong>${escapeHtml(state.round.secretWord)}</strong>
          </div>
          <div class="button-row">
            <button class="button secondary" type="button" data-action="edit-settings">Edit Settings</button>
            <button class="button" type="button" data-action="play-again">Play Again</button>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderMissingRound() {
  return `
    <section class="screen">
      <header class="app-header">
        <button class="nav-button" type="button" aria-label="Back" data-action="show-home">${icon("back")}</button>
      </header>
      <h1 class="title-medium">No active round</h1>
      <p class="subtext">Start a new game from settings.</p>
      <div style="margin-top: 24px;">
        <button class="button" type="button" data-action="show-home">Go Home</button>
      </div>
    </section>
  `;
}

function toggleSetting(setting) {
  if (!(setting in state.settings)) return;
  state.settings[setting] = !state.settings[setting];
  saveSettings();
  render();
}

function addPlayer() {
  if (state.players.length >= MAX_PLAYERS) return;
  const next = state.players.length + 1;
  state.players.push({ id: createId(), name: `Player ${next}` });
  clampImposterSettings();
  saveSettings();
  render();
  requestAnimationFrame(() => {
    app.scrollTo({ top: app.scrollHeight, behavior: "smooth" });
  });
}

function removePlayer(id) {
  if (!id || state.players.length <= MIN_PLAYERS) return;
  state.players = state.players.filter((player) => player.id !== id);
  clampImposterSettings();
  saveSettings();
  render();
}

function setImposterMode(mode) {
  state.settings.imposterMode = mode;
  clampImposterSettings();
  saveSettings();
  render();
}

function stepSetting(setting, delta) {
  if (!Number.isFinite(delta)) return;
  if (!(setting in state.settings)) return;
  state.settings[setting] += delta;
  clampImposterSettings();
  saveSettings();
  render();
}

function clampImposterSettings() {
  const playerCount = state.players.length;
  const maxNormal = Math.max(1, playerCount - 1);
  if (state.settings.imposterMode === "random") state.settings.imposterMode = "chaos";
  state.settings.fixedCount = clamp(Number(state.settings.fixedCount) || 1, 1, maxNormal);
  state.settings.rangeMin = clamp(toInteger(state.settings.rangeMin, 0), 0, maxNormal);
  state.settings.rangeMax = clamp(toInteger(state.settings.rangeMax, Math.max(1, state.settings.rangeMin)), 0, maxNormal);
  if (state.settings.rangeMin > state.settings.rangeMax) {
    if (state.settings.rangeMin - state.settings.rangeMax > 1) {
      state.settings.rangeMin = state.settings.rangeMax;
    } else {
      state.settings.rangeMax = state.settings.rangeMin;
    }
  }
  if (!["fixed", "range", "chaos"].includes(state.settings.imposterMode)) {
    state.settings.imposterMode = "fixed";
  }
}

function getImposterSummary() {
  const settings = state.settings;
  if (settings.imposterMode === "fixed") {
    return {
      short: String(settings.fixedCount),
      detail: `${settings.fixedCount} imposter${settings.fixedCount === 1 ? "" : "s"} every round.`
    };
  }
  if (settings.imposterMode === "range") {
    return {
      short: `${settings.rangeMin}-${settings.rangeMax}`,
      detail: `A hidden random count from ${settings.rangeMin} to ${settings.rangeMax}.`
    };
  }
  return {
    short: "Chaos",
    detail: "It could be any number of imposters. It could be no one, or it could be anyone."
  };
}

async function startGame() {
  normalizePlayerNames();
  if (state.players.length < MIN_PLAYERS) {
    setScreen("players-editor");
    return;
  }
  clampImposterSettings();
  saveSettings();

  const imposterCount = resolveImposterCount();
  const runId = ++state.loadingRunId;
  state.loading = {
    attempt: 1,
    failed: false,
    message: "Asking Groq for a fresh secret",
    error: "",
    startedAt: Date.now()
  };
  state.round = null;
  state.selectedPlayerId = null;
  state.revealOpened = false;
  setScreen("loading");
  startLoadingTicker(runId);

  let attempt = 1;
  while (state.screen === "loading" && state.loadingRunId === runId) {
    state.loading = {
      attempt,
      failed: false,
      message: attempt > 1 ? "Failed, re-attempting" : "Asking Groq for a fresh secret",
      error: attempt > 1 ? state.loading.error : "",
      startedAt: Date.now()
    };
    render();

    try {
      const content = await fetchGroqRound(attempt, imposterCount);
      if (state.loadingRunId !== runId || state.screen !== "loading") return;
      stopLoadingTicker();
      createRound(content, imposterCount);
      setScreen("players");
      return;
    } catch (error) {
      if (state.loadingRunId !== runId || state.screen !== "loading") return;
      state.loading = {
        attempt: attempt + 1,
        failed: true,
        message: "Failed, re-attempting",
        error: cleanError(error),
        startedAt: Date.now()
      };
      render();
      await wait(Math.min(4800, 900 + attempt * 850));
      attempt += 1;
    }
  }
}

function cancelLoading() {
  state.loadingRunId += 1;
  stopLoadingTicker();
}

function startLoadingTicker(runId) {
  stopLoadingTicker();
  loadingTickerId = window.setInterval(() => {
    if (state.screen !== "loading" || state.loadingRunId !== runId) {
      stopLoadingTicker();
      return;
    }
    const status = app.querySelector("[data-loading-status]");
    if (status) status.textContent = getLoadingMessage();
  }, 1000);
}

function stopLoadingTicker() {
  if (!loadingTickerId) return;
  window.clearInterval(loadingTickerId);
  loadingTickerId = 0;
}

async function fetchGroqRound(attempt, imposterCount) {
  if (!hasGroqKey()) {
    throw new Error("Groq API key is still the placeholder in app.js.");
  }

  const recentWords = getRecentWords();
  const userPrompt = [
    `Create one fresh round for ${state.players.length} players with ${imposterCount} imposters.`,
    "Return only JSON with category, secret_word, imposter_clue, and optional alt_clues.",
    "Aim for fun pub-game content, not quiz-night difficulty.",
    "Use common modern words people can joke about and describe quickly.",
    "Good category examples: snack, fast food, animal, movie, TV show, pop song, celebrity, app, holiday, place, sport, brand, job, drink, toy, game, hobby, everyday object.",
    "Avoid historical events, Renaissance-style answers, old classical musicians, science lessons, obscure literature, technical topics, and anything that feels like homework.",
    `Avoid these recent secret words: ${recentWords.length ? recentWords.join(", ") : "none"}.`,
    `Freshness seed: ${createId()}-${attempt}.`
  ].join(" ");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.95,
        top_p: 0.92,
        max_tokens: 180,
        response_format: { type: "json_object" },
        stream: false
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`No response from Groq after ${Math.round(GROQ_REQUEST_TIMEOUT_MS / 1000)} seconds. This browser may be blocking api.groq.com.`);
    }
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error("Browser could not reach Groq. This is usually network blocking before the API call.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Groq returned ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty response.");

  const parsed = parseJsonContent(content);
  const normalized = normalizeRoundContent(parsed);
  rememberWord(normalized.secretWord);
  return normalized;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Groq response was not valid JSON.");
    }
    return JSON.parse(content.slice(start, end + 1));
  }
}

function normalizeRoundContent(content) {
  const category = cleanContentValue(content.category, 32);
  const secretWord = cleanContentValue(content.secret_word, 42);
  const imposterClue = cleanContentValue(content.imposter_clue, 28);
  if (!category || !secretWord || !imposterClue) {
    throw new Error("Groq JSON was missing category, secret_word, or imposter_clue.");
  }
  if (secretWord.toLowerCase() === imposterClue.toLowerCase()) {
    throw new Error("Groq clue matched the secret word.");
  }
  return {
    category,
    secretWord,
    imposterClue
  };
}

function createRound(content, imposterCount) {
  const playerIds = state.players.map((player) => player.id);
  const imposterIds = shuffle(playerIds).slice(0, clamp(imposterCount, 0, playerIds.length));
  const starter = shuffle(playerIds)[0];
  const direction = Math.random() > 0.5 ? "clockwise" : "anti-clockwise";
  state.round = {
    id: createId(),
    category: content.category,
    secretWord: content.secretWord,
    imposterClue: content.imposterClue,
    imposterIds,
    revealedIds: [],
    starterId: starter,
    direction
  };
}

function resolveImposterCount() {
  const playerCount = state.players.length;
  const maxNormal = Math.max(1, playerCount - 1);
  const settings = state.settings;
  if (settings.imposterMode === "fixed") return clamp(settings.fixedCount, 1, maxNormal);
  if (settings.imposterMode === "range") return randomInt(settings.rangeMin, settings.rangeMax);
  return randomInt(0, playerCount);
}

function openPlayerReveal(id) {
  if (!state.round) return;
  if (state.round.revealedIds.includes(id)) return;
  state.selectedPlayerId = id;
  state.revealOpened = false;
  setScreen("reveal");
}

function revealCurrentPlayer() {
  if (state.revealOpened) return;
  state.revealOpened = true;
  render();
}

function completeCurrentReveal() {
  if (!state.round || !state.selectedPlayerId) {
    setScreen("players");
    return;
  }
  if (!state.round.revealedIds.includes(state.selectedPlayerId)) {
    state.round.revealedIds.push(state.selectedPlayerId);
  }
  state.selectedPlayerId = null;
  state.revealOpened = false;
  if (state.round.revealedIds.length >= state.players.length) {
    setScreen("final");
  } else {
    setScreen("players");
  }
}

function revealFinalResults() {
  if (!state.round) return;
  const text = getImposterNamesText();
  const runId = ++state.typingRunId;
  state.finalTyped = "";
  state.finalTyping = true;
  setScreen("result");

  let index = 0;
  const tick = () => {
    if (state.typingRunId !== runId || state.screen !== "result") return;
    index += 1;
    state.finalTyped = text.slice(0, index);
    if (index >= text.length) {
      state.finalTyping = false;
      render();
      return;
    }
    render();
    window.setTimeout(tick, text[index - 1] === "," ? 260 : 70);
  };
  window.setTimeout(tick, 520);
}

function getSelectedPlayer() {
  return state.players.find((player) => player.id === state.selectedPlayerId);
}

function getRevealCategoryLabel(isImposter) {
  if (!state.round) return "Mystery";
  if (!state.settings.showCategoryToImposter && !state.revealOpened) return "Mystery";
  if (!isImposter) return state.round.category;
  return state.settings.showCategoryToImposter ? state.round.category : "Mystery";
}

function getResultTitle() {
  if (!state.round) return "Results";
  const count = state.round.imposterIds.length;
  if (count === 0) return "There Were No Imposters";
  if (count === 1) return "The Imposter Was";
  return "The Imposters Were";
}

function getImposterNamesText() {
  if (!state.round) return "";
  if (state.round.imposterIds.length === 0) return "No one";
  return state.round.imposterIds
    .map((id) => state.players.find((player) => player.id === id)?.name)
    .filter(Boolean)
    .join(", ");
}

function normalizePlayerNames() {
  state.players = state.players.map((player, index) => ({
    ...player,
    name: cleanName(player.name) || `Player ${index + 1}`
  }));
}

function getRecentWords() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_WORDS_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, 14).filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberWord(word) {
  const recent = getRecentWords().filter((item) => item.toLowerCase() !== word.toLowerCase());
  recent.unshift(word);
  localStorage.setItem(RECENT_WORDS_KEY, JSON.stringify(recent.slice(0, 18)));
}

function hasGroqKey() {
  return Boolean(GROQ_API_KEY && !GROQ_API_KEY.includes("PASTE_") && GROQ_API_KEY.length > 20);
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .slice(0, 22)
    .trimStart();
}

function cleanContentValue(value, maxLength) {
  return String(value || "")
    .replace(/[`*_{}\[\]\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return message.length > 140 ? `${message.slice(0, 140)}...` : message;
}

function initialFor(name) {
  const trimmed = cleanName(name).trim();
  return (trimmed[0] || "?").toUpperCase();
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function randomInt(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function revealIdleArt() {
  return `
    <span class="reveal-idle-art" aria-hidden="true">
      <span class="reveal-idle-ring"></span>
      <span class="reveal-idle-mark">?</span>
    </span>
  `;
}

function sparkleField(count) {
  const colors = ["#9be8ff", "#b24dff", "#ff9ee2", "#d8ffd8", "#ffffff", "#8d74ff"];
  return `
    <span class="sparkle-field" aria-hidden="true">
      ${Array.from({ length: count }, () => {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = randomInt(3, 9);
        const x = randomInt(3, 97);
        const y = randomInt(4, 96);
        const dx = randomInt(-160, 160);
        const dy = randomInt(-150, 150);
        const speed = (randomInt(18, 42) / 10).toFixed(1);
        const delay = (randomInt(0, 24) / -10).toFixed(1);
        return `<span class="sparkle" style="--x:${x}%;--y:${y}%;--size:${size}px;--dx:${dx}px;--dy:${dy}px;--speed:${speed}s;--delay:${delay}s;--color:${color};"></span>`;
      }).join("")}
    </span>
  `;
}

function icon(name) {
  const attrs = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    back: `<svg ${attrs}><path d="m15 18-6-6 6-6"/></svg>`,
    gear: `<svg ${attrs}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z"/></svg>`,
    users: `<svg ${attrs}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>`,
    userSearch: `<svg ${attrs}><circle cx="10" cy="7" r="4"/><path d="M2 21a8 8 0 0 1 12.6-6.5"/><circle cx="17.5" cy="17.5" r="3"/><path d="m20 20 2 2"/></svg>`,
    sparkles: `<svg ${attrs}><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m5 3 .7 2.3L8 6l-2.3.7L5 9l-.7-2.3L2 6l2.3-.7L5 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>`,
    type: `<svg ${attrs}><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>`,
    question: `<svg ${attrs}><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 0 1 4.5 1.2c0 1.8-2.2 2.1-2.2 3.8"/><path d="M12 17h.01"/></svg>`,
    category: `<svg ${attrs}><path d="M4 13h7V4H4v9Z"/><path d="M13 20h7v-7h-7v7Z"/><path d="m17 4 4 7h-8l4-7Z"/><path d="M4 20h7v-5H4v5Z"/></svg>`,
    shuffle: `<svg ${attrs}><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>`,
    eye: `<svg ${attrs}><path d="M2 12s3.4-7 10-7 10 7 10 7-3.4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    bulb: `<svg ${attrs}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.1 14.7a6 6 0 1 1 7.8 0c-.6.5-.9 1.2-.9 2V17H9v-.3c0-.8-.3-1.5-.9-2Z"/></svg>`,
    team: `<svg ${attrs}><path d="M17 21v-2a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v2"/><circle cx="10" cy="8" r="4"/><path d="M21 21v-2a3 3 0 0 0-2.2-2.9"/><path d="M16 4.2a3.5 3.5 0 0 1 0 6.6"/></svg>`,
    gamepad: `<svg ${attrs}><path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M18 11h.01"/><path d="M5.5 7h13A3.5 3.5 0 0 1 22 10.5V16a3 3 0 0 1-5.1 2.1L15 16H9l-1.9 2.1A3 3 0 0 1 2 16v-5.5A3.5 3.5 0 0 1 5.5 7Z"/></svg>`,
    x: `<svg ${attrs}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    plusUser: `<svg ${attrs}><path d="M15 19a6 6 0 0 0-12 0"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>`,
    minusUser: `<svg ${attrs}><path d="M15 19a6 6 0 0 0-12 0"/><circle cx="9" cy="7" r="4"/><path d="M17 11h5"/></svg>`,
    minus: `<svg ${attrs}><path d="M5 12h14"/></svg>`,
    plus: `<svg ${attrs}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    lock: `<svg ${attrs}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
    tap: `<svg ${attrs}><path d="M9 11V5a2 2 0 1 1 4 0v6"/><path d="M13 10.5V9a2 2 0 1 1 4 0v3"/><path d="M17 12a2 2 0 1 1 4 0v2c0 4-2.5 7-7 7h-1.5a6 6 0 0 1-4.2-1.8L5 16a2 2 0 1 1 2.8-2.8L9 14.4"/></svg>`,
    person: `<svg ${attrs}><circle cx="12" cy="7" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>`,
    rotate: `<svg ${attrs}><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>`
  };
  return icons[name] || icons.sparkles;
}
