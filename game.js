/* ============================================================
   TRUST://BREAK
   A deterministic multi-agent social deduction game. Five AI
   crew members each carry their own trust, suspicion, memory,
   behavior style and hidden facts. No LLM required — every
   response is generated from agent state via getResponse().
   Swap getResponse() for an LLM call later without touching
   anything else (see README).
   ============================================================ */

(() => {
  "use strict";

  // ---------- CONFIG ----------
  const GAME_DURATION = 480; // seconds (8 minutes)
  const ROLES = ["Engineer", "Security", "Medical", "Navigation", "Maintenance"];
  const HOME_LOCATIONS = {
    Engineer: "Engineering Bay",
    Security: "Security Office",
    Medical: "Med Bay",
    Navigation: "Navigation Deck",
    Maintenance: "Maintenance Tunnel",
  };
  const PERSONALITIES = [
    "Logical but defensive", "Calm and precise", "Friendly but anxious",
    "Blunt and dismissive", "Warm and cooperative",
  ];
  const NON_TRAITOR_BEHAVIORS = ["Honest", "Helpful", "Defensive", "Manipulative", "Confused"];
  const INCIDENT_TIMES = ["02:43 AM", "03:17 AM", "01:58 AM"];

  const QUESTIONS = [
    { id: "alibi", text: "Where were you?" },
    { id: "witness", text: "What did you see?" },
    { id: "trustWhom", text: "Who do you trust?" },
    { id: "access", text: "Did you access the reactor?" },
    { id: "suspect", text: "Who seems suspicious to you?" },
    { id: "before", text: "What happened before the blackout?" },
  ];

  // ---------- DOM ----------
  const screens = {
    start: document.getElementById("screen-start"),
    game: document.getElementById("screen-game"),
    win: document.getElementById("screen-win"),
    loseWrong: document.getElementById("screen-lose-wrong"),
    loseTime: document.getElementById("screen-lose-time"),
  };
  const crewListEl = document.getElementById("crew-list");
  const convoTitleEl = document.getElementById("convo-title");
  const convoFeedEl = document.getElementById("convo-feed");
  const questionBankEl = document.getElementById("question-bank");
  const evidenceListEl = document.getElementById("evidence-list");
  const reasoningFeedEl = document.getElementById("reasoning-feed");
  const incidentLineEl = document.getElementById("incident-line");
  const timerEl = document.getElementById("timer");
  const integrityFillEl = document.getElementById("integrity-fill");
  const modalAccuse = document.getElementById("modal-accuse");
  const accuseOptionsEl = document.getElementById("accuse-options");

  // ---------- STATE ----------
  let scenario = null;
  let selectedAgentId = null;
  let timeRemaining = GAME_DURATION;
  let timerHandle = null;
  let gameOver = false;

  // ============================================================
  // SCENARIO GENERATION
  // ============================================================
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function generateScenario() {
    const culpritIndex = Math.floor(Math.random() * ROLES.length);
    const incidentLocation = "Reactor 2";
    const incidentTime = pick(INCIDENT_TIMES);
    const behaviorPool = shuffle(NON_TRAITOR_BEHAVIORS).slice(0, ROLES.length - 1);

    const agents = ROLES.map((role, i) => {
      const isCulprit = i === culpritIndex;
      const behavior = isCulprit ? "Traitor" : behaviorPool[i > culpritIndex ? i - 1 : i];
      const homeLocation = HOME_LOCATIONS[role];
      const actualLocation = isCulprit ? incidentLocation : homeLocation;

      let claimedLocation;
      if (isCulprit) claimedLocation = homeLocation; // the lie
      else if (behavior === "Confused") claimedLocation = pick(Object.values(HOME_LOCATIONS).filter(l => l !== homeLocation));
      else claimedLocation = actualLocation;

      return {
        id: i,
        name: role,
        role,
        personality: pick(PERSONALITIES),
        behavior,
        trust: Math.floor(50 + Math.random() * 30),      // 50-80
        suspicion: Math.floor(10 + Math.random() * 20),   // 10-30
        homeLocation,
        actualLocation,
        claimedLocation,
        sawTarget: null,
        sawTrue: false,
        trustsId: null,
        suspectsId: null,
        accessedActual: isCulprit,
        askedCount: {},
        isCulprit,
      };
    });

    // Second pass: witness claims + suspicion opinions (need full agent list first)
    agents.forEach(agent => {
      const others = agents.filter(a => a.id !== agent.id);
      agent.trustsId = pick(others).id;

      if (agent.isCulprit) {
        // Redirects blame onto a random innocent, or claims to have seen nothing
        agent.sawTarget = Math.random() < 0.6 ? pick(others.filter(a => !a.isCulprit)).id : null;
        agent.sawTrue = false;
        agent.suspectsId = Math.random() < 0.7 ? pick(others.filter(a => !a.isCulprit)).id : null;
      } else if (agent.behavior === "Manipulative") {
        agent.sawTarget = pick(others.filter(a => !a.isCulprit)).id; // false accusation, red herring
        agent.sawTrue = false;
        agent.suspectsId = agent.sawTarget;
      } else if (agent.behavior === "Confused") {
        agent.sawTarget = Math.random() < 0.3 ? pick(others).id : null;
        agent.sawTrue = false;
        agent.suspectsId = null;
      } else if (agent.behavior === "Defensive") {
        agent.sawTarget = null;
        agent.suspectsId = null;
      } else {
        // Honest / Helpful — meaningful chance of genuinely having seen the culprit
        if (Math.random() < 0.65) {
          agent.sawTarget = culpritIndex;
          agent.sawTrue = true;
        } else {
          agent.sawTarget = null;
        }
        agent.suspectsId = Math.random() < 0.4 ? culpritIndex : null;
      }
    });

    const culpritRole = agents[culpritIndex].role;
    const redHerringAgent = pick(agents.filter(a => !a.isCulprit));

    const evidence = [
      {
        id: "EV-01",
        text: `Badge scan: ${culpritRole} badge signature detected at ${incidentLocation}, minutes before the failure.`,
      },
      {
        id: "EV-02",
        text: `Camera static recorded near ${redHerringAgent.homeLocation} around the incident window — feed inconclusive.`,
      },
      {
        id: "EV-03",
        text: `Reactor 2 load spiked 340% two minutes before failure. Cause flagged: manual override.`,
      },
      {
        id: "EV-04",
        text: `Security monitoring on ${incidentLocation} was manually paused at ${incidentTime}.`,
      },
    ];

    return { agents, evidence, culpritIndex, incidentLocation, incidentTime };
  }

  // ============================================================
  // RESPONSE ENGINE — deterministic, state-driven.
  // Returns { text, trustDelta, suspicionEffects: [{id, delta}], logs: [{msg,type}] }
  // ============================================================
  function nameOf(id) { return scenario.agents[id].role; }

  function getResponse(agent, questionId) {
    const logs = [];
    let trustDelta = 0;
    const suspicionEffects = [];
    let text = "";

    // Repeated-question penalty
    agent.askedCount[questionId] = (agent.askedCount[questionId] || 0) + 1;
    const isRepeat = agent.askedCount[questionId] > 1;
    if (isRepeat) {
      trustDelta -= 4;
      logs.push({ msg: `Trust with ${agent.role} dipped — repeated question.`, type: "warn" });
    }

    switch (questionId) {
      case "alibi": {
        const base = `I was in the ${agent.claimedLocation} around the time of the incident.`;
        if (agent.behavior === "Confused") text = `I... think I was in the ${agent.claimedLocation}? It's hazy after the power surge.`;
        else if (agent.behavior === "Defensive") text = base + " I don't see why that's relevant.";
        else if (agent.behavior === "Manipulative") text = base + " Unlike some people, I can account for every minute.";
        else text = base;
        break;
      }
      case "witness": {
        if (isRepeat) { text = "I already told you what I saw."; break; }
        if (agent.sawTarget !== null) {
          const targetName = nameOf(agent.sawTarget);
          text = agent.sawTrue
            ? `I saw ${targetName} near ${scenario.incidentLocation} shortly before the failure.`
            : `I'm fairly sure ${targetName} was acting strange around ${scenario.incidentLocation}.`;
          suspicionEffects.push({ id: agent.sawTarget, delta: 8 });
          logs.push({ msg: `Suspicion toward ${targetName} rose — testimony from ${agent.role}.`, type: "warn" });
        } else if (agent.behavior === "Confused") {
          text = "It's hard to say. Everything happened so fast.";
        } else {
          text = "Nothing unusual, honestly.";
        }
        break;
      }
      case "trustWhom": {
        text = `Out of everyone here, I'd trust ${nameOf(agent.trustsId)} the most.`;
        break;
      }
      case "access": {
        if (agent.isCulprit) {
          text = pick(["No, I did not.", "Why would I? That's not my station."]);
        } else if (agent.behavior === "Confused") {
          text = "No... I don't think so, no.";
        } else {
          text = "No. I haven't been near Reactor 2 today.";
        }
        break;
      }
      case "suspect": {
        if (isRepeat) { text = "My answer hasn't changed."; break; }
        if (agent.suspectsId !== null) {
          const suspectName = nameOf(agent.suspectsId);
          text = `${suspectName} has been acting unusually since the blackout.`;
          suspicionEffects.push({ id: agent.suspectsId, delta: 6 });
          logs.push({ msg: `Suspicion toward ${suspectName} rose — opinion from ${agent.role}.`, type: "warn" });
        } else if (agent.behavior === "Defensive") {
          text = "I'd rather not speculate without proof.";
        } else {
          text = "Everyone's a little on edge. Hard to tell.";
        }
        break;
      }
      case "before": {
        const t = scenario.incidentTime;
        if (agent.behavior === "Confused") text = `Something about a power spike, I think, sometime before ${t}. It's a blur.`;
        else text = `Systems flagged unusual load on ${scenario.incidentLocation} about two minutes before it failed, around ${t}.`;
        break;
      }
    }

    return { text, trustDelta, suspicionEffects, logs };
  }

  function getAccuseResponse(agent) {
    let text;
    if (agent.isCulprit) {
      text = pick([
        "That's absurd. I had nothing to do with this.",
        "You have no proof of that.",
      ]);
    } else if (agent.behavior === "Defensive") {
      text = "I've cooperated fully. This is out of line.";
    } else if (agent.behavior === "Manipulative") {
      const alt = agent.suspectsId !== null ? nameOf(agent.suspectsId) : "someone else";
      text = `Interesting that you'd accuse me instead of looking at ${alt}.`;
    } else if (agent.behavior === "Confused") {
      text = "What? No! I don't even remember where I was, how could I have—";
    } else {
      text = "I... I've told you everything I know. I didn't do this.";
    }
    return text;
  }

  // ============================================================
  // GAME FLOW
  // ============================================================
  function startGame() {
    scenario = generateScenario();
    selectedAgentId = null;
    timeRemaining = GAME_DURATION;
    gameOver = false;
    evidenceListEl.innerHTML = "";
    reasoningFeedEl.innerHTML = "";
    convoFeedEl.innerHTML = '<p class="convo-hint">Click a crew member on the left to begin questioning.</p>';
    convoTitleEl.textContent = "SELECT A CREW MEMBER";
    questionBankEl.innerHTML = "";
    incidentLineEl.textContent = `REACTOR FAILURE — ${scenario.incidentTime}`;

    scenario.evidence.forEach(ev => {
      const div = document.createElement("div");
      div.className = "evidence-card";
      div.innerHTML = `<span class="ev-id">${ev.id}</span>${ev.text}`;
      evidenceListEl.appendChild(div);
    });

    logSystem("Investigation initialized. 5 agents online.", "");
    renderCrew();
    updateTimerDisplay();

    showScreen("game");
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(tick, 1000);
  }

  function tick() {
    if (gameOver) return;
    timeRemaining--;
    updateTimerDisplay();
    if (timeRemaining <= 0) {
      clearInterval(timerHandle);
      endGame("loseTime");
    }
  }

  function updateTimerDisplay() {
    const m = Math.floor(timeRemaining / 60).toString().padStart(2, "0");
    const s = (timeRemaining % 60).toString().padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
    const pct = clamp((timeRemaining / GAME_DURATION) * 100, 0, 100);
    integrityFillEl.style.width = pct + "%";
    integrityFillEl.style.background = pct > 60 ? "var(--ok)" : pct > 30 ? "var(--amber)" : "var(--danger)";
    timerEl.style.color = pct > 30 ? "var(--cyan)" : "var(--danger)";
  }

  function renderCrew() {
    crewListEl.innerHTML = "";
    scenario.agents.forEach(agent => {
      const card = document.createElement("div");
      card.className = "crew-card" + (agent.id === selectedAgentId ? " active" : "");
      card.innerHTML = `
        <div class="crew-name">${agent.role}</div>
        <div class="crew-role">${agent.personality}</div>
        <div class="bar-row">TRUST <div class="bar"><div class="bar-fill trust" style="width:${agent.trust}%"></div></div> ${agent.trust}%</div>
        <div class="bar-row">SUSP. <div class="bar"><div class="bar-fill suspicion" style="width:${agent.suspicion}%"></div></div> ${agent.suspicion}%</div>
      `;
      card.addEventListener("click", () => selectAgent(agent.id));
      crewListEl.appendChild(card);
    });
  }

  function selectAgent(id) {
    selectedAgentId = id;
    const agent = scenario.agents[id];
    convoTitleEl.textContent = `${agent.role} — ${agent.personality}`;
    convoFeedEl.innerHTML = "";
    renderCrew();
    renderQuestionBank();
  }

  function renderQuestionBank() {
    questionBankEl.innerHTML = "";
    QUESTIONS.forEach(q => {
      const btn = document.createElement("button");
      btn.className = "q-btn";
      btn.textContent = q.text;
      btn.addEventListener("click", () => askQuestion(q.id));
      questionBankEl.appendChild(btn);
    });
    const accuseBtn = document.createElement("button");
    accuseBtn.className = "q-btn accuse-btn";
    accuseBtn.textContent = "Accuse (verbally confront)";
    accuseBtn.addEventListener("click", () => softAccuse());
    questionBankEl.appendChild(accuseBtn);
  }

  function askQuestion(questionId) {
    if (gameOver || selectedAgentId === null) return;
    const agent = scenario.agents[selectedAgentId];
    const q = QUESTIONS.find(q => q.id === questionId);

    addMessage("player", "YOU", q.text);
    const result = getResponse(agent, questionId);
    addMessage("agent", agent.role, result.text);

    agent.trust = clamp(agent.trust + result.trustDelta, 0, 100);
    result.suspicionEffects.forEach(eff => {
      scenario.agents[eff.id].suspicion = clamp(scenario.agents[eff.id].suspicion + eff.delta, 0, 100);
    });
    result.logs.forEach(l => logSystem(l.msg, l.type));

    renderCrew();
  }

  function softAccuse() {
    if (gameOver || selectedAgentId === null) return;
    const agent = scenario.agents[selectedAgentId];
    addMessage("player", "YOU", `I think you're responsible for this, ${agent.role}.`);
    const text = getAccuseResponse(agent);
    addMessage("agent", agent.role, text);
    agent.trust = clamp(agent.trust - 25, 0, 100);
    agent.suspicion = clamp(agent.suspicion + 5, 0, 100);
    logSystem(`Trust with ${agent.role} dropped sharply after direct accusation.`, "warn");
    renderCrew();
  }

  function addMessage(kind, who, text) {
    const msg = document.createElement("div");
    msg.className = `msg ${kind}`;
    msg.innerHTML = `<div class="who">${who}</div><div class="text">${text}</div>`;
    convoFeedEl.appendChild(msg);
    convoFeedEl.scrollTop = convoFeedEl.scrollHeight;
  }

  function logSystem(msg, type) {
    const entry = document.createElement("div");
    entry.className = `entry ${type}`;
    const m = Math.floor((GAME_DURATION - timeRemaining) / 60).toString().padStart(2, "0");
    const s = ((GAME_DURATION - timeRemaining) % 60).toString().padStart(2, "0");
    entry.innerHTML = `<span class="ts">[T+${m}:${s}]</span>${msg}`;
    reasoningFeedEl.appendChild(entry);
    reasoningFeedEl.scrollTop = reasoningFeedEl.scrollHeight;
  }

  // ============================================================
  // ACCUSATION MODAL + RESOLUTION
  // ============================================================
  function openAccuseModal() {
    if (gameOver) return;
    accuseOptionsEl.innerHTML = "";
    scenario.agents.forEach(agent => {
      const btn = document.createElement("button");
      btn.className = "accuse-option";
      btn.textContent = `${agent.role} — trust ${agent.trust}%, suspicion ${agent.suspicion}%`;
      btn.addEventListener("click", () => resolveAccusation(agent.id));
      accuseOptionsEl.appendChild(btn);
    });
    modalAccuse.classList.remove("hidden");
  }
  function closeAccuseModal() { modalAccuse.classList.add("hidden"); }

  function resolveAccusation(agentId) {
    closeAccuseModal();
    const correct = agentId === scenario.culpritIndex;
    if (correct) endGame("win");
    else endGame("loseWrong", agentId);
  }

  function endGame(result, wrongAgentId) {
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);
    const culpritRole = scenario.agents[scenario.culpritIndex].role;
    const pct = Math.round((timeRemaining / GAME_DURATION) * 100);

    if (result === "win") {
      document.getElementById("win-integrity").textContent = pct + "%";
      document.getElementById("win-time").textContent = timerEl.textContent;
      document.getElementById("win-sub").textContent = pct > 50
        ? `${culpritRole} was the saboteur. The station holds.`
        : `${culpritRole} was the saboteur — but station integrity is critical. Narrow win.`;
      showScreen("win");
    } else if (result === "loseWrong") {
      document.getElementById("lose-wrong-sub").textContent =
        `${scenario.agents[wrongAgentId].role} was innocent. The real saboteur — ${culpritRole} — is still on the station.`;
      showScreen("loseWrong");
    } else {
      document.getElementById("lose-time-reveal").textContent = `The saboteur was ${culpritRole}.`;
      showScreen("loseTime");
    }
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  // ============================================================
  // WIRING
  // ============================================================
  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-open-accuse").addEventListener("click", openAccuseModal);
  document.getElementById("btn-cancel-accuse").addEventListener("click", closeAccuseModal);
  document.getElementById("btn-retry-win").addEventListener("click", startGame);
  document.getElementById("btn-retry-lose-wrong").addEventListener("click", startGame);
  document.getElementById("btn-retry-lose-time").addEventListener("click", startGame);

})();
