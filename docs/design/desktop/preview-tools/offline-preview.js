/* Preview-only adapter. The editable application source is unchanged.
 * All data below is fictitious and stays in memory. No API requests leave this file. */
(() => {
  function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      get length() { return values.size; },
      key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(String(key)) ?? null,
      setItem: (key, value) => { values.set(String(key), String(value)); },
      removeItem: key => { values.delete(String(key)); },
      clear: () => values.clear(),
    };
  }
  Object.defineProperty(window, 'localStorage', {value: memoryStorage({
    'arrab.locale': 'ar', 'arrab.theme': 'light', 'arrab.studioRole': 'individual',
    'arrab.account.session': 'offline-design-preview',
  })});
  Object.defineProperty(window, 'sessionStorage', {value: memoryStorage()});
  const now = new Date().toISOString();
  const stamps = {createdAt: now, updatedAt: now};
  const workspace = {id: 'design-workspace', organizationId: 'design-organization', name: 'Arrab Studio', slug: 'design', ...stamps};
  const account = {id: 'design-account', email: 'preview@example.test', displayName: 'حساب المعاينة',
    planId: 'pro', planName: 'Pro', subscriptionStatus: 'active', periodStart: now,
    periodEnd: '2030-01-01T00:00:00.000Z', connectedAt: now};
  const entitlements = {connected: true, planId: 'pro', planName: 'Pro', subscriptionStatus: 'active',
    tokenLimit: 100000, tokensUsed: 0, tokensRemaining: 100000, overLimit: false,
    periodStart: now, periodEnd: account.periodEnd};
  const accountStatus = () => ({connected: true, account, entitlements, plans: []});
  const operator = {workspaceId: workspace.id, displayName: 'حساب المعاينة', title: null, seats: [], ...stamps};
  const zeroUsage = {inputTokens: 0, outputTokens: 0, events: 0};
  const store = {agents: [{id: 'design-agent', workspaceId: workspace.id, projectId: null,
    name: 'مساعد تجريبي', role: 'تنظيم العمل', specialty: 'التخطيط', bio: 'شخصية توضيحية لمعاينة شاشة الموظف.',
    instructions: null, status: 'active', modelProviderId: null, ...stamps}],
    projects: [], teams: [], conversations: [], activity: [], connectors: [], memberships: [],
    tasks: [], knowledge: [], memories: [], skills: [], goals: [], approvals: [], 'task-runs': [], bindings: []};
  const messages = {};
  // Local simulation makes the write-while-replying and Stop controls reviewable.
  // This never contacts a provider or makes a network request.
  function previewStream(result, signal) {
    const encoder = new TextEncoder();
    let timer;
    let closed = false;
    let abort;
    const cleanup = () => {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    };
    return new Response(new ReadableStream({
      start(controller) {
        const parts = result.assistantMessage.content.match(/\S+\s*/g) ?? [];
        let index = 0;
        let partial = '';
        const event = (name, data) => controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        abort = () => {
          if (closed) return;
          closed = true;
          cleanup();
          result.assistantMessage.content = partial;
          controller.error(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) { abort(); return; }
        const step = () => {
          if (closed) return;
          if (index < parts.length) {
            partial += parts[index];
            event('token', {text: parts[index++]});
            timer = setTimeout(step, 120);
          } else {
            event('done', result);
            closed = true;
            cleanup();
            controller.close();
          }
        };
        timer = setTimeout(step, 200);
      },
      cancel() { closed = true; cleanup(); },
    }), {headers: {'Content-Type': 'text/event-stream'}});
  }
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
  const blocked = () => json({error: {code: 'DESIGN_PREVIEW', message: 'هذه معاينة تصميم محلية. هذه الخدمة تحتاج البرنامج المتصل.'}}, 400);
  window.fetch = async (input, options = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    let url;
    try { url = new URL(raw, 'https://design-preview.invalid'); } catch { return blocked(); }
    const path = url.pathname;
    const method = options.method ?? (input instanceof Request ? input.method : 'GET');
    let body = {};
    if (typeof options.body === 'string') { try { body = JSON.parse(options.body); } catch { /* no payload */ } }
    if (path === '/health') return json({status: 'ok', service: 'arrab-api', time: now});
    if (!path.startsWith('/v1/')) return blocked();
    const parts = path.slice(4).split('/');
    const [resource, id, action] = parts;
    if (resource === 'meta') return json({name: 'arrab-api', version: 'design-preview', persistence: 'memory',
      workspaceId: workspace.id, aiProviders: [], account: entitlements});
    if (path === '/v1/ai/status') return json({configured: true, providers: [], defaultModel: null});
    if (resource === 'account') {
      if (id === 'logout' || id === 'disconnect') return json({...accountStatus(), connected: false, account: null});
      if (id === 'subscribe' || id === 'auth') return blocked();
      if (id === 'connect' || id === 'sign-in') return json({account, entitlements, sessionToken: 'offline-design-preview'});
      if (method === 'PATCH') { if (body.displayName) account.displayName = body.displayName; }
      return json(accountStatus());
    }
    if (resource === 'billing' || resource === 'github') return blocked();
    if (resource === 'operator') {
      if (method === 'PUT') {
        if (body.displayName) operator.displayName = body.displayName;
        if ('title' in body) operator.title = body.title;
        if (body.addSeat && !operator.seats.includes(body.addSeat)) operator.seats.push(body.addSeat);
      }
      return json(operator);
    }
    if (resource === 'usage') return json({totals: zeroUsage, byProvider: [], recent: [], entitlements});
    if (resource === 'dashboard') return json({workspace, projects: store.projects, agents: store.agents,
      teams: store.teams, activity: store.activity, conversations: store.conversations});
    if (resource === 'reports') return json({operator, agentsByStatus: {active: store.agents.length}, teams: store.teams.length,
      tasks: {total: store.tasks.length, open: store.tasks.length, done: 0, byStatus: {}, byPriority: {}},
      usage: zeroUsage, recentActivity: [], knowledgeCount: store.knowledge.length, memoryCount: store.memories.length,
      skillCount: store.skills.length, pendingApprovals: 0, recentTaskRuns: []});
    if (resource === 'connectors') return method === 'GET' ? json({items: []}) : blocked();
    if (resource === 'agents' && action === 'conversations') return json({items: store.conversations.filter(x => x.agentId === id)});
    if (resource === 'agents' && action === 'goals') return json({items: store.goals.filter(x => x.agentId === id)});
    if (resource === 'projects' && action === 'repo') return json({item: null});
    if (resource === 'teams' && action === 'members') return json({items: store.memberships.filter(x => x.teamId === id)});
    if (resource === 'conversations' && action === 'messages' && method === 'POST') {
      const userMessage = {id: crypto.randomUUID(), conversationId: id, role: 'user', content: body.content ?? '', createdAt: new Date().toISOString()};
      const assistantMessage = {id: crypto.randomUUID(), conversationId: id, role: 'assistant',
        content: 'هذا رد تجريبي محلي لمعاينة التصميم المحسّن. يمكنك كتابة رسالتك التالية أثناء ظهوره، أو الضغط على إيقاف. جرّب أيضًا الانتقال بين الشخصي والمهني وستبقى مسودتك محفوظة أثناء التنقل. الردود الحقيقية تحتاج اتصال البرنامج بخدمته.', createdAt: new Date().toISOString()};
      messages[id] = [...(messages[id] ?? []), userMessage, assistantMessage];
      const result = {conversation: store.conversations.find(x => x.id === id), userMessage, assistantMessage, providerConfigured: false};
      if (parts[3] === 'stream') return previewStream(result, options.signal);
      return json(result);
    }
    if (resource === 'conversations' && id && method === 'GET') return json({conversation: store.conversations.find(x => x.id === id), messages: messages[id] ?? []});
    const list = store[resource];
    if (!list) return method === 'GET' ? json({items: []}) : blocked();
    if (method === 'GET') {
      if (id && id !== 'pending') return json(list.find(x => x.id === id) ?? {items: []});
      const agentId = url.searchParams.get('agentId');
      return json({items: agentId ? list.filter(x => x.agentId === agentId) : list});
    }
    if (method === 'POST' && !id) {
      const item = {id: crypto.randomUUID(), workspaceId: workspace.id, projectId: null, agentId: null, teamId: null,
        status: 'active', specialty: null, bio: null, instructions: null, modelProviderId: null,
        description: null, purpose: null, title: null, spendTier: 'low', sessionTokenBudget: null,
        priority: 'medium', brief: null, dueAt: null, assigneeAgentId: null, ...stamps, ...body};
      list.push(item);
      return json(resource === 'skills' ? {skill: item, task: null} : item);
    }
    const item = list.find(x => x.id === id);
    if ((method === 'PATCH' || method === 'PUT') && item) { Object.assign(item, body, {updatedAt: new Date().toISOString()}); return json(item); }
    if (method === 'DELETE') { const index = list.findIndex(x => x.id === id); if (index >= 0) list.splice(index, 1); return json({ok: true}); }
    return blocked();
  };
  // A separate review control exposes all routes without changing the app's UI source.
  document.addEventListener('DOMContentLoaded', () => {
    const guide = document.getElementById('design-guide');
    const opener = document.getElementById('design-guide-open');
    opener.addEventListener('click', () => guide.showModal());
    document.getElementById('design-guide-close').addEventListener('click', () => guide.close());
    guide.addEventListener('click', event => {
      const link = event.target.closest('[data-design-route]');
      if (!link) return;
      const route = link.dataset.designRoute;
      if (route === 'sign-in') localStorage.removeItem('arrab.account.session');
      else localStorage.setItem('arrab.account.session', 'offline-design-preview');
      location.hash = route === 'sign-in' ? '/individuals' : route;
      window.dispatchEvent(new Event('arrab:account'));
      guide.close();
    });
  });
})();
