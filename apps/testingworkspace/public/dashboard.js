(() => {
  const SESSION_KEY = "arrab.session";

  const state = {
    account: null,
    entitlements: null,
    plans: [],
    billingConfigured: false,
    releases: [],
    latestMacDmg: null,
    agents: [],
    projects: [],
    conversations: [],
    tasks: [],
    goals: [],
    activity: [],
    ai: null,
    meta: null,
    activeConversationId: null,
    streaming: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function session() {
    try {
      const raw =
        sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null";
      const parsed = JSON.parse(raw);
      if (!parsed?.token) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSession(payload) {
    const next = {
      token: payload.token,
      account: payload.account || null,
      at: new Date().toISOString(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    localStorage.removeItem(SESSION_KEY);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function toAuth() {
    window.location.replace("/");
  }

  async function api(path, options = {}) {
    const headers = options.body
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" };
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      clearSession();
      toAuth();
      throw new Error(payload?.error?.message || "Sign in with email and password");
    }
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || "Request failed");
    }
    return payload;
  }

  /** Bedrock returns "Operation not allowed" until the AWS account authorizes model invoke. */
  function friendlyError(message) {
    if (/operation not allowed/i.test(message)) {
      return "AWS Bedrock hasn't authorized this key to run models yet. Enable model access in the AWS console (Bedrock → Model access), then try again.";
    }
    if (/quota|402/i.test(message)) {
      return "Monthly token budget reached. Upgrade your plan to keep chatting.";
    }
    return message;
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  function setStatus(sel, message, kind) {
    const el = $(sel);
    if (!el) return;
    el.textContent = message || "";
    el.className = `${el.classList.contains("chat-status") ? "chat-status" : "form-status"}${
      kind ? ` is-${kind}` : ""
    }`;
  }

  const nf = new Intl.NumberFormat("en-US");

  function compact(n) {
    if (n === null || n === undefined) return "Unlimited";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return nf.format(n);
  }

  function when(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  /* ---------------- navigation ---------------- */

  function showView(name) {
    $$(".view").forEach((view) => {
      view.classList.toggle("is-active", view.dataset.view === name);
    });
    $$(".nav-item").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.view === name);
    });
    $$(".tab-item").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.view === name);
    });
    if (window.location.hash !== `#${name}`) {
      history.replaceState(null, "", `#${name}`);
    }
    if (name === "chat") {
      requestAnimationFrame(scrollThread);
    }
  }

  function wireNav() {
    $$(".nav-item, .tab-item").forEach((item) => {
      item.addEventListener("click", () => showView(item.dataset.view));
    });
    $$("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.goto));
    });
    window.addEventListener("hashchange", () => {
      const view = window.location.hash.replace("#", "").split("?")[0] || "overview";
      showView(view);
    });
  }

  /* ---------------- renderers ---------------- */

  function renderIdentity() {
    const name = state.account?.displayName || "Operator";
    const plan = state.account?.planName || "Free";
    $("#side-name").textContent = name;
    $("#side-plan").textContent = `${plan} plan`;
    $("#side-avatar").textContent = (name[0] || "A").toUpperCase();

    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    $("#greeting").textContent = `${part}, ${name.split(" ")[0]}`;
  }

  function renderOverview() {
    const ent = state.entitlements || {};
    const limit = ent.tokenLimit;
    const used = ent.tokensUsed || 0;

    $("#ov-plan").textContent = state.account?.planName || "Free";
    $("#ov-tokens").textContent =
      limit === null || limit === undefined
        ? `${nf.format(used)} tokens used · unlimited`
        : `${compact(used)} / ${compact(limit)} tokens this month`;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 6;
    $("#ov-meter").style.width = `${pct}%`;

    $("#ov-agents").textContent = state.agents.length;
    $("#ov-convos").textContent = state.conversations.length;
    $("#ov-tasks").textContent = state.tasks.filter((t) => t.status !== "done").length;

    const ai = state.ai || {};
    $("#ov-ai").innerHTML = [
      ["Status", ai.configured ? "Live" : "Not configured"],
      ["Provider", (ai.providers || []).join(", ") || "—"],
      ["Default model", ai.defaultModel || "—"],
      ["Region", ai.region || "—"],
      ["Models available", String((ai.models || []).length)],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
      .join("");

    const feed = $("#ov-activity");
    if (!state.activity.length) {
      feed.innerHTML = '<li class="empty">Nothing yet. Start a chat to see activity.</li>';
    } else {
      feed.innerHTML = state.activity
        .slice(0, 12)
        .map(
          (item) =>
            `<li>${escapeHtml(item.summary || item.kind || "Event")}<time>${when(
              item.createdAt,
            )}</time></li>`,
        )
        .join("");
    }
  }

  function renderAgents() {
    const list = $("#agent-list");
    if (!state.agents.length) {
      list.innerHTML =
        '<p class="empty">No employees yet. Hire your first AI teammate above.</p>';
    } else {
      list.innerHTML = state.agents
        .map(
          (agent) => `
          <article class="tile">
            <span class="badge ${agent.status === "active" ? "ok" : ""}">${escapeHtml(
              agent.status,
            )}</span>
            <h3>${escapeHtml(agent.name)}</h3>
            <p>${escapeHtml(agent.role || "")}${
              agent.specialty ? ` · ${escapeHtml(agent.specialty)}` : ""
            }</p>
            ${agent.instructions ? `<p>${escapeHtml(agent.instructions)}</p>` : ""}
            <div class="tile-actions">
              <button type="button" class="mini" data-chat-agent="${agent.id}">Chat</button>
              <button type="button" class="mini" data-del-agent="${agent.id}">Remove</button>
            </div>
          </article>`,
        )
        .join("");
    }

    const options = state.agents
      .map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`)
      .join("");

    const chatAgent = $("#chat-agent");
    const prev = chatAgent.value;
    chatAgent.innerHTML = options || '<option value="">No employees yet</option>';
    if (prev && state.agents.some((a) => a.id === prev)) chatAgent.value = prev;

    $("#task-agent").innerHTML = `<option value="">Unassigned</option>${options}`;
  }

  function renderProjects() {
    const list = $("#project-list");
    if (!state.projects.length) {
      list.innerHTML = '<p class="empty">No projects yet.</p>';
      return;
    }
    list.innerHTML = state.projects
      .map(
        (project) => `
        <article class="tile">
          <span class="badge ${project.status === "active" ? "ok" : ""}">${escapeHtml(
            project.status,
          )}</span>
          <h3>${escapeHtml(project.name)}</h3>
          <p>${escapeHtml(project.description || "No description")}</p>
        </article>`,
      )
      .join("");
  }

  function renderTasks() {
    const list = $("#task-list");
    if (!state.tasks.length) {
      list.innerHTML = '<li class="empty">No tasks yet.</li>';
      return;
    }
    list.innerHTML = state.tasks
      .map((task) => {
        const agent = state.agents.find((a) => a.id === task.assigneeAgentId);
        return `
          <li class="${task.status === "done" ? "done" : ""}">
            <div class="li-main">
              <strong>${escapeHtml(task.title)}</strong>
              <span>${escapeHtml(task.status)}${
                agent ? ` · ${escapeHtml(agent.name)}` : ""
              }${task.brief ? ` · ${escapeHtml(task.brief.slice(0, 70))}` : ""}</span>
            </div>
            <div class="li-actions">
              ${
                task.status !== "done"
                  ? `<button type="button" class="mini" data-task-done="${task.id}">Done</button>`
                  : ""
              }
              <button type="button" class="mini" data-task-del="${task.id}">Delete</button>
            </div>
          </li>`;
      })
      .join("");
  }

  function renderGoals() {
    const list = $("#goal-list");
    if (!state.goals.length) {
      list.innerHTML = '<li class="empty">No goals yet.</li>';
      return;
    }
    list.innerHTML = state.goals
      .map(
        (goal) => `
        <li class="${goal.status === "completed" ? "done" : ""}">
          <div class="li-main">
            <strong>${escapeHtml(goal.title)}</strong>
            <span>${escapeHtml(goal.status)}${
              goal.detail ? ` · ${escapeHtml(goal.detail.slice(0, 80))}` : ""
            }</span>
          </div>
          <div class="li-actions">
            ${
              goal.status === "active"
                ? `<button type="button" class="mini" data-goal-done="${goal.id}">Complete</button>`
                : ""
            }
          </div>
        </li>`,
      )
      .join("");
  }

  function formatSar(halalas) {
    if (!halalas) return "0";
    const value = halalas / 100;
    return value.toLocaleString("en-SA", {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  function formatBytes(n) {
    if (!n) return "—";
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
    if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
    return `${n} B`;
  }

  function renderPlans() {
    const current = state.account?.planId;
    const ent = state.entitlements || {};
    const used = nf.format(ent.tokensUsed || 0);
    const limit = ent.tokenLimit ? nf.format(ent.tokenLimit) : "Unlimited";
    const currentEl = $("#plan-current");
    if (currentEl) {
      currentEl.innerHTML = `
        <div>
          <span class="card-label">Current membership</span>
          <strong>${escapeHtml(state.account?.planName || "Free")}</strong>
          <p>${used} tokens used this period · ${limit} included</p>
        </div>
        <div class="meter tall"><span id="ov-meter-plan" style="width:${
          ent.tokenLimit ? Math.min(100, Math.round(((ent.tokensUsed || 0) / ent.tokenLimit) * 100)) : 6
        }%"></span></div>`;
    }

    $("#plan-list").innerHTML = (state.plans || [])
      .map((plan) => {
        const isCurrent = plan.id === current;
        const price = plan.monthlyPriceHalalas
          ? `<span class="price"><em>${formatSar(plan.monthlyPriceHalalas)}</em> <small>SAR / month</small></span>`
          : `<span class="price"><em>Free</em> <small>forever</small></span>`;
        const features = (plan.features || [])
          .map((feature) => `<li>${escapeHtml(feature)}</li>`)
          .join("");
        const cta = isCurrent
          ? '<span class="badge ok">Current plan</span>'
          : plan.monthlyPriceHalalas
            ? `<button type="button" class="cta slim" data-checkout="${plan.id}">Subscribe with Moyasar</button>`
            : `<button type="button" class="mini" data-checkout="${plan.id}">Switch to Free</button>`;
        return `
        <article class="plan-card-pro ${plan.highlight ? "is-featured" : ""} ${
          isCurrent ? "is-current" : ""
        }">
          ${plan.badge ? `<span class="plan-ribbon">${escapeHtml(plan.badge)}</span>` : ""}
          <h3>${escapeHtml(plan.name)}</h3>
          ${price}
          <p class="plan-copy">${escapeHtml(plan.description)}</p>
          <p class="plan-tokens">${compact(plan.monthlyTokenLimit)} tokens / month</p>
          <ul class="plan-features">${features}</ul>
          ${cta}
        </article>`;
      })
      .join("");
  }

  function renderReleases() {
    const hero = $("#dmg-hero");
    const list = $("#release-list");
    if (!hero || !list) return;
    const dmg = state.latestMacDmg;
    if (dmg) {
      hero.innerHTML = `
        <div class="dmg-copy">
          <span class="card-label">macOS</span>
          <h2>Arrab Studio for Mac</h2>
          <p>${escapeHtml(dmg.filename)}${dmg.version ? ` · v${escapeHtml(dmg.version)}` : ""} · ${formatBytes(
            dmg.sizeBytes,
          )}</p>
          <p class="dim">Published ${escapeHtml(when(dmg.updatedAt))}. After each update, the new .dmg replaces this file.</p>
        </div>
        <a class="cta slim dmg-btn" href="${escapeHtml(dmg.url)}" download>Download .dmg</a>`;
    } else {
      hero.innerHTML = `
        <div class="dmg-copy">
          <span class="card-label">macOS</span>
          <h2>Arrab Studio for Mac</h2>
          <p>No .dmg has been published yet. Drop the signed installer into the releases folder after the next Mac build and it appears here immediately.</p>
        </div>
        <span class="badge">Waiting for first .dmg</span>`;
    }

    if (!state.releases.length) {
      list.innerHTML = `<p class="empty-copy">No installers published yet.</p>`;
      return;
    }
    list.innerHTML = state.releases
      .map(
        (item) => `
        <a class="release-row" href="${escapeHtml(item.url)}" download>
          <div>
            <strong>${escapeHtml(item.filename)}</strong>
            <span>${escapeHtml(item.platform)} · ${escapeHtml(item.kind)}${
              item.version ? ` · v${escapeHtml(item.version)}` : ""
            } · ${formatBytes(item.sizeBytes)}</span>
          </div>
          <span class="mini">Download</span>
        </a>`,
      )
      .join("");
  }

  function renderSettings() {
    $("#profile-name").value = state.account?.displayName || "";
    $("#profile-email").value = state.account?.email || "";

    const ent = state.entitlements || {};
    $("#settings-account").innerHTML = [
      ["Email", state.account?.email || "—"],
      ["Plan", state.account?.planName || "—"],
      ["Subscription", state.account?.subscriptionStatus || "—"],
      [
        "Tokens used",
        `${nf.format(ent.tokensUsed || 0)}${
          ent.tokenLimit ? ` / ${nf.format(ent.tokenLimit)}` : " (unlimited)"
        }`,
      ],
      ["Period ends", ent.periodEnd ? new Date(ent.periodEnd).toLocaleDateString() : "—"],
      ["Connected", state.account?.connectedAt ? when(state.account.connectedAt) : "—"],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
      .join("");

    const meta = state.meta || {};
    $("#settings-workspace").innerHTML = [
      ["API", window.location.origin],
      ["Workspace", meta.workspaceId || "—"],
      ["Storage", meta.persistence || "—"],
      ["API version", meta.version || "—"],
      ["AI providers", (meta.aiProviders || []).join(", ") || "none"],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /* ---------------- chat ---------------- */

  function renderConversations() {
    const list = $("#convo-list");
    if (!state.conversations.length) {
      list.innerHTML = '<li class="empty">No conversations yet.</li>';
      return;
    }
    list.innerHTML = state.conversations
      .map((convo) => {
        const agent = state.agents.find((a) => a.id === convo.agentId);
        const label = convo.title || agent?.name || "Conversation";
        return `<li><button type="button" data-convo="${convo.id}" class="${
          convo.id === state.activeConversationId ? "is-active" : ""
        }">${escapeHtml(label)}</button></li>`;
      })
      .join("");
  }

  function bubble(role, text) {
    const el = document.createElement("div");
    el.className = `bubble ${role}`;
    el.textContent = text;
    $("#thread").appendChild(el);
    scrollThread();
    return el;
  }

  function scrollThread() {
    const thread = $("#thread");
    thread.scrollTop = thread.scrollHeight;
  }

  function clearThread() {
    $("#thread").innerHTML = "";
  }

  function showThreadEmpty() {
    clearThread();
    const empty = document.createElement("div");
    empty.className = "thread-empty";
    empty.innerHTML = `
      <img src="/assets/symbol-white.png?v=5" width="40" height="40" alt="" />
      <p>Ask anything. Your employee answers with full workspace context.</p>
      <div class="chips">
        <button type="button" class="chip">Summarize my workspace</button>
        <button type="button" class="chip">Draft a launch plan</button>
        <button type="button" class="chip">What should I do next?</button>
      </div>`;
    $("#thread").appendChild(empty);
    empty.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("#msg").value = chip.textContent;
        $("#composer").requestSubmit();
      });
    });
  }

  async function openConversation(id) {
    state.activeConversationId = id;
    renderConversations();
    $("#delete-chat").hidden = false;
    setStatus("#chat-status", "");
    try {
      const detail = await api(`/v1/conversations/${id}`);
      const agent = state.agents.find((a) => a.id === detail.conversation.agentId);
      $("#chat-title").textContent =
        detail.conversation.title || agent?.name || "Conversation";
      $("#chat-meta").textContent = agent
        ? `${agent.role || "AI employee"} · ${detail.messages.length} messages`
        : `${detail.messages.length} messages`;

      clearThread();
      const visible = detail.messages.filter((m) => m.role !== "system");
      if (!visible.length) {
        showThreadEmpty();
      } else {
        visible.forEach((message) => bubble(message.role, message.content));
      }
    } catch (error) {
      setStatus("#chat-status", error.message, "error");
    }
  }

  async function ensureAgent() {
    if (state.agents.length) {
      return $("#chat-agent").value || state.agents[0].id;
    }
    const created = await api("/v1/agents", {
      method: "POST",
      body: {
        name: "Arrab Assistant",
        role: "AI assistant",
        instructions: "Be concise, concrete, and proactive. Ask only when truly blocked.",
        status: "active",
      },
    });
    const agent = created.item || created.agent || created;
    state.agents.push(agent);
    renderAgents();
    return agent.id;
  }

  async function ensureConversation() {
    if (state.activeConversationId) return state.activeConversationId;
    const agentId = await ensureAgent();
    const created = await api("/v1/conversations", {
      method: "POST",
      body: { agentId },
    });
    const convo = created.conversation || created.item || created;
    state.conversations.unshift(convo);
    state.activeConversationId = convo.id;
    renderConversations();
    $("#delete-chat").hidden = false;
    const agent = state.agents.find((a) => a.id === agentId);
    $("#chat-title").textContent = convo.title || agent?.name || "Conversation";
    $("#chat-meta").textContent = agent?.role || "AI employee";
    return convo.id;
  }

  async function streamMessage(conversationId, content) {
    const response = await fetch(`/v1/conversations/${conversationId}/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok || !response.body) {
      throw new Error("Could not reach the AI stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let target = null;
    let text = "";
    let finished = null;

    const ensureTarget = () => {
      if (!target) {
        target = bubble("assistant", "");
        target.innerHTML = '<span class="caret"></span>';
      }
      return target;
    };

    const paint = () => {
      ensureTarget();
      target.textContent = text;
      const caret = document.createElement("span");
      caret.className = "caret";
      target.appendChild(caret);
      scrollThread();
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const lines = frame.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;

        let payload = null;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }

        if (event === "token" && payload.text) {
          text += payload.text;
          paint();
        } else if (event === "tool_start") {
          setStatus("#chat-status", `Using ${payload.name}…`);
        } else if (event === "tool") {
          setStatus("#chat-status", `${payload.name} done`);
        } else if (event === "error") {
          throw new Error(payload.message || "Stream failed");
        } else if (event === "done") {
          finished = payload;
        }
      }
    }

    if (finished) {
      const replyText =
        finished.assistantMessage?.content || text || "(no reply — provider not configured)";
      if (!target) target = bubble("assistant", "");
      target.textContent = replyText;

      if (finished.providerConfigured === false) {
        bubble("system", "AI provider is not configured on the server — message saved only.");
      }
      const usage = finished.sessionUsage;
      setStatus(
        "#chat-status",
        usage ? `${nf.format(usage.totalTokens)} tokens this session` : "",
      );
    } else if (target) {
      target.textContent = text;
    }

    return finished;
  }

  async function sendMessage(content) {
    if (state.streaming) return;
    state.streaming = true;
    $("#send").disabled = true;
    setStatus("#chat-status", "Thinking…");

    try {
      const conversationId = await ensureConversation();
      if ($("#thread").querySelector(".thread-empty")) clearThread();
      bubble("user", content);

      await streamMessage(conversationId, content);
      await refreshLight();
    } catch (error) {
      const message = friendlyError(error.message);
      setStatus("#chat-status", message, "error");
      bubble("system", message);
    } finally {
      state.streaming = false;
      $("#send").disabled = false;
    }
  }

  /* ---------------- data loading ---------------- */

  async function loadAll() {
    const sess = session();
    if (!sess?.token) {
      clearSession();
      toAuth();
      return false;
    }

    let account;
    try {
      account = await api("/v1/account/session", {
        method: "POST",
        body: { sessionToken: sess.token },
      });
    } catch {
      clearSession();
      toAuth();
      return false;
    }
    if (!account.connected) {
      clearSession();
      toAuth();
      return false;
    }
    state.account = account.account;
    state.entitlements = account.entitlements;
    state.plans = account.plans || [];

    const [dash, ai, meta, tasks, goals, activity, billing, releases] = await Promise.all([
      api("/v1/dashboard").catch(() => null),
      api("/v1/ai/status").catch(() => null),
      api("/v1/meta").catch(() => null),
      api("/v1/tasks").catch(() => ({ items: [] })),
      api("/v1/goals").catch(() => ({ items: [] })),
      api("/v1/activity").catch(() => ({ items: [] })),
      api("/v1/billing/plans").catch(() => null),
      api("/v1/releases").catch(() => null),
    ]);

    if (billing?.plans?.length) {
      state.plans = billing.plans;
      state.billingConfigured = Boolean(billing.configured);
    }
    state.releases = releases?.items || [];
    state.latestMacDmg = releases?.latestMacDmg || null;

    state.agents = dash?.agents || [];
    state.projects = dash?.projects || [];
    state.conversations = dash?.conversations || [];
    state.activity = activity?.items || dash?.activity || [];
    state.tasks = tasks?.items || [];
    state.goals = goals?.items || [];
    state.ai = ai;
    state.meta = meta;

    renderIdentity();
    renderOverview();
    renderAgents();
    renderProjects();
    renderTasks();
    renderGoals();
    renderPlans();
    renderReleases();
    renderSettings();
    renderConversations();
    return true;
  }

  async function refreshLight() {
    const [account, convos, activity] = await Promise.all([
      api("/v1/account").catch(() => null),
      api("/v1/conversations").catch(() => null),
      api("/v1/activity").catch(() => null),
    ]);
    if (account?.connected) {
      state.account = account.account;
      state.entitlements = account.entitlements;
    }
    if (convos?.items) state.conversations = convos.items;
    if (activity?.items) state.activity = activity.items;
    renderIdentity();
    renderOverview();
    renderConversations();
    renderSettings();
  }

  /* ---------------- events ---------------- */

  function wireForms() {
    // chat
    $("#composer").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#msg");
      const content = input.value.trim();
      if (!content) return;
      input.value = "";
      input.style.height = "auto";
      sendMessage(content);
    });

    $("#msg").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("#composer").requestSubmit();
      }
    });

    $("#msg").addEventListener("input", (event) => {
      const el = event.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(160, el.scrollHeight)}px`;
    });

    $("#new-chat").addEventListener("click", () => {
      state.activeConversationId = null;
      $("#chat-title").textContent = "New conversation";
      $("#chat-meta").textContent = "Pick an employee and say hello";
      $("#delete-chat").hidden = true;
      renderConversations();
      showThreadEmpty();
      $("#msg").focus();
    });

    $("#convo-list").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-convo]");
      if (btn) openConversation(btn.dataset.convo);
    });

    $("#delete-chat").addEventListener("click", async () => {
      if (!state.activeConversationId) return;
      try {
        await api(`/v1/conversations/${state.activeConversationId}`, { method: "DELETE" });
        state.conversations = state.conversations.filter(
          (c) => c.id !== state.activeConversationId,
        );
        state.activeConversationId = null;
        renderConversations();
        showThreadEmpty();
        $("#delete-chat").hidden = true;
        toast("Conversation deleted");
      } catch (error) {
        setStatus("#chat-status", error.message, "error");
      }
    });

    // employees
    $("#agent-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("#agent-status", "Hiring…");
      try {
        const created = await api("/v1/agents", {
          method: "POST",
          body: {
            name: $("#agent-name").value.trim(),
            role: $("#agent-role").value.trim(),
            instructions: $("#agent-instructions").value.trim() || null,
            status: "active",
          },
        });
        const agent = created.item || created.agent || created;
        state.agents.push(agent);
        renderAgents();
        renderOverview();
        $("#agent-form").reset();
        setStatus("#agent-status", `${agent.name} joined your workforce`, "ok");
        toast("Employee hired");
      } catch (error) {
        setStatus("#agent-status", error.message, "error");
      }
    });

    $("#agent-list").addEventListener("click", async (event) => {
      const chatBtn = event.target.closest("[data-chat-agent]");
      if (chatBtn) {
        $("#chat-agent").value = chatBtn.dataset.chatAgent;
        state.activeConversationId = null;
        showView("chat");
        showThreadEmpty();
        $("#msg").focus();
        return;
      }
      const delBtn = event.target.closest("[data-del-agent]");
      if (delBtn) {
        try {
          await api(`/v1/agents/${delBtn.dataset.delAgent}`, { method: "DELETE" });
          state.agents = state.agents.filter((a) => a.id !== delBtn.dataset.delAgent);
          renderAgents();
          renderOverview();
          toast("Employee removed");
        } catch (error) {
          setStatus("#agent-status", error.message, "error");
        }
      }
    });

    // projects
    $("#project-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("#project-status", "Creating…");
      try {
        const created = await api("/v1/projects", {
          method: "POST",
          body: {
            name: $("#project-name").value.trim(),
            description: $("#project-desc").value.trim() || null,
          },
        });
        state.projects.push(created.item || created.project || created);
        renderProjects();
        $("#project-form").reset();
        setStatus("#project-status", "Project created", "ok");
        toast("Project created");
      } catch (error) {
        setStatus("#project-status", error.message, "error");
      }
    });

    // tasks
    $("#task-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("#task-status", "Adding…");
      try {
        const created = await api("/v1/tasks", {
          method: "POST",
          body: {
            title: $("#task-title").value.trim(),
            brief: $("#task-brief").value.trim() || null,
            assigneeAgentId: $("#task-agent").value || null,
          },
        });
        state.tasks.unshift(created.item || created.task || created);
        renderTasks();
        renderOverview();
        $("#task-form").reset();
        setStatus("#task-status", "Task added", "ok");
      } catch (error) {
        setStatus("#task-status", error.message, "error");
      }
    });

    $("#task-list").addEventListener("click", async (event) => {
      const doneBtn = event.target.closest("[data-task-done]");
      const delBtn = event.target.closest("[data-task-del]");
      try {
        if (doneBtn) {
          await api(`/v1/tasks/${doneBtn.dataset.taskDone}`, {
            method: "PATCH",
            body: { status: "done" },
          });
          const task = state.tasks.find((t) => t.id === doneBtn.dataset.taskDone);
          if (task) task.status = "done";
          renderTasks();
          renderOverview();
        } else if (delBtn) {
          await api(`/v1/tasks/${delBtn.dataset.taskDel}`, { method: "DELETE" });
          state.tasks = state.tasks.filter((t) => t.id !== delBtn.dataset.taskDel);
          renderTasks();
          renderOverview();
        }
      } catch (error) {
        setStatus("#task-status", error.message, "error");
      }
    });

    // goals
    $("#goal-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("#goal-status", "Saving…");
      try {
        const created = await api("/v1/goals", {
          method: "POST",
          body: {
            title: $("#goal-title").value.trim(),
            detail: $("#goal-detail").value.trim() || null,
          },
        });
        state.goals.unshift(created.item || created.goal || created);
        renderGoals();
        $("#goal-form").reset();
        setStatus("#goal-status", "Goal set", "ok");
      } catch (error) {
        setStatus("#goal-status", error.message, "error");
      }
    });

    $("#goal-list").addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-goal-done]");
      if (!btn) return;
      try {
        await api(`/v1/goals/${btn.dataset.goalDone}`, {
          method: "PATCH",
          body: { status: "completed" },
        });
        const goal = state.goals.find((g) => g.id === btn.dataset.goalDone);
        if (goal) goal.status = "completed";
        renderGoals();
      } catch (error) {
        setStatus("#goal-status", error.message, "error");
      }
    });

    // plans
    $("#plan-list").addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-checkout]");
      if (!btn) return;
      const planId = btn.dataset.checkout;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Opening Moyasar…";
      setStatus("#redeem-status", "Creating a Moyasar invoice…");
      try {
        const result = await api("/v1/billing/checkout", {
          method: "POST",
          body: { planId },
        });
        if (!result.checkoutUrl) {
          const refreshed = await api("/v1/account");
          state.account = refreshed.account;
          state.entitlements = refreshed.entitlements;
          renderIdentity();
          renderOverview();
          renderPlans();
          renderSettings();
          setStatus("#redeem-status", `Now on ${state.account.planName}`, "ok");
          toast(`${state.account.planName} is active`);
          return;
        }
        window.location.assign(result.checkoutUrl);
      } catch (error) {
        setStatus("#redeem-status", error.message, "error");
        btn.disabled = false;
        btn.textContent = original;
      }
    });

    // settings
    $("#profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("#profile-status", "Saving…");
      try {
        const result = await api("/v1/account", {
          method: "PATCH",
          body: { displayName: $("#profile-name").value.trim() },
        });
        state.account = result.account || state.account;
        state.entitlements = result.entitlements || state.entitlements;
        renderIdentity();
        renderSettings();
        setStatus("#profile-status", "Profile saved", "ok");
        toast("Profile saved");
      } catch (error) {
        setStatus("#profile-status", error.message, "error");
      }
    });

    const signOut = () => {
      clearSession();
      toAuth();
    };
    $("#sign-out").addEventListener("click", signOut);
    $("#sign-out-2").addEventListener("click", signOut);

    $("#disconnect").addEventListener("click", async () => {
      if (!window.confirm("Disconnect this account from the workspace?")) return;
      setStatus("#danger-status", "Disconnecting…");
      try {
        await api("/v1/account/disconnect", { method: "POST" });
        clearSession();
        toAuth();
      } catch (error) {
        setStatus("#danger-status", error.message, "error");
      }
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    if (!session()?.token) {
      clearSession();
      toAuth();
      return;
    }

    wireNav();
    wireForms();

    try {
      const ok = await loadAll();
      if (!ok) return;
    } catch (error) {
      $("#boot").innerHTML = `<span>Could not load workspace: ${escapeHtml(
        error.message,
      )}</span>`;
      return;
    }

    document.body.classList.remove("booting");
    $("#boot").hidden = true;
    $("#layout").hidden = false;

    const paid = new URLSearchParams(window.location.search).get("paid");
    const invoiceId =
      new URLSearchParams(window.location.search).get("id") ||
      new URLSearchParams(window.location.search).get("invoice");
    if (paid || invoiceId) {
      if (invoiceId) {
        try {
          const confirmed = await api(`/v1/billing/confirm?id=${encodeURIComponent(invoiceId)}`);
          state.account = confirmed.account || state.account;
          state.entitlements = confirmed.entitlements || state.entitlements;
          renderIdentity();
          renderOverview();
          renderPlans();
          renderSettings();
          toast(`${state.account?.planName || "Plan"} is now active`);
        } catch (error) {
          setStatus("#redeem-status", error.message, "error");
        }
      } else {
        toast("Payment received — refreshing your plan");
      }
      history.replaceState(null, "", "/app#plans");
      showView("plans");
    } else {
      const view =
        window.location.hash.replace("#", "").split("?")[0] ||
        window.location.pathname.replace(/^\/app\/?/, "").split("/")[0] ||
        "overview";
      showView(view);
    }
    showThreadEmpty();
  }

  boot();
})();
