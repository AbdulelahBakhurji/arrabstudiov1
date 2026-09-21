export const MIGRATION_001_CORE = `
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workspaces (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists projects (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  description text,
  status text not null check (status in ('active', 'archived')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists agents (
  id text primary key,
  workspace_id text not null references workspaces(id),
  project_id text references projects(id),
  name text not null,
  role text not null,
  status text not null check (status in ('draft', 'active', 'paused', 'archived')),
  model_provider_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists teams (
  id text primary key,
  workspace_id text not null references workspaces(id),
  project_id text references projects(id),
  name text not null,
  purpose text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists activity (
  id text primary key,
  workspace_id text not null references workspaces(id),
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id text,
  verb text not null check (verb in ('created', 'updated', 'ran', 'completed', 'failed', 'approved', 'rejected')),
  object_type text not null,
  object_id text,
  summary text not null,
  created_at timestamptz not null
);

create index if not exists projects_workspace_idx on projects(workspace_id);
create index if not exists agents_workspace_idx on agents(workspace_id);
create index if not exists teams_workspace_idx on teams(workspace_id);
create index if not exists activity_workspace_created_idx on activity(workspace_id, created_at desc);
`;

export const MIGRATION_002_CONVERSATIONS = `
create table if not exists conversations (
  id text primary key,
  workspace_id text not null references workspaces(id),
  project_id text references projects(id),
  agent_id text references agents(id),
  team_id text references teams(id),
  title text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  created_at timestamptz not null
);

create index if not exists conversations_workspace_idx on conversations(workspace_id);
create index if not exists conversations_agent_idx on conversations(agent_id);
create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at);
`;

export const MIGRATION_003_CONNECTED_WORKFORCE = `
create table if not exists team_memberships (
  team_id text not null references teams(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  created_at timestamptz not null,
  primary key (team_id, agent_id)
);

create table if not exists connectors (
  id text primary key,
  workspace_id text not null references workspaces(id),
  provider text not null,
  status text not null check (status in ('connected', 'error')),
  account_label text,
  scopes text[] not null default '{}',
  connected_at timestamptz not null,
  last_verified_at timestamptz,
  error text,
  secret text not null
);

create table if not exists project_repo_bindings (
  project_id text primary key references projects(id) on delete cascade,
  connector_id text not null references connectors(id) on delete cascade,
  repo_full_name text not null,
  repo_url text,
  bound_at timestamptz not null
);

create table if not exists usage_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  conversation_id text references conversations(id) on delete set null,
  agent_id text references agents(id) on delete set null,
  provider_id text not null,
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null
);

create index if not exists team_memberships_agent_idx on team_memberships(agent_id);
create index if not exists connectors_workspace_idx on connectors(workspace_id);
create index if not exists usage_events_workspace_created_idx on usage_events(workspace_id, created_at desc);
`;

export const MIGRATION_004_COMMAND_CENTER = `
create table if not exists operator_profiles (
  workspace_id text primary key references workspaces(id) on delete cascade,
  display_name text not null,
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists tasks (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  title text not null,
  brief text,
  status text not null check (status in ('backlog', 'assigned', 'in_progress', 'blocked', 'done')),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_agent_id text references agents(id) on delete set null,
  team_id text references teams(id) on delete set null,
  project_id text references projects(id) on delete set null,
  due_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists tasks_workspace_status_idx on tasks(workspace_id, status);
create index if not exists tasks_assignee_idx on tasks(assignee_agent_id);
`;

export const MIGRATION_005_OPERATOR_SEATS = `
alter table operator_profiles
  add column if not exists seats text[] not null default '{}';

update operator_profiles
set seats = array[title]
where coalesce(cardinality(seats), 0) = 0
  and title is not null
  and length(trim(title)) > 0;
`;

export const MIGRATION_006_EXECUTION_DESK = `
create table if not exists knowledge_docs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  title text not null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists memories (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text references agents(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists task_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  conversation_id text references conversations(id) on delete set null,
  status text not null check (status in ('completed', 'failed', 'needs_provider')),
  summary text,
  created_at timestamptz not null
);

create index if not exists knowledge_docs_workspace_idx on knowledge_docs(workspace_id);
create index if not exists memories_agent_idx on memories(agent_id);
create index if not exists task_runs_task_idx on task_runs(task_id, created_at desc);
`;

export const MIGRATION_007_SKILLS_APPROVALS = `
create table if not exists skills (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  title text not null,
  instructions text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists approvals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('activate_agent', 'run_task')),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  title text not null,
  detail text,
  agent_id text references agents(id) on delete set null,
  task_id text references tasks(id) on delete set null,
  created_at timestamptz not null,
  resolved_at timestamptz
);

alter table task_runs drop constraint if exists task_runs_status_check;
alter table task_runs
  add constraint task_runs_status_check
  check (status in ('completed', 'failed', 'needs_provider', 'awaiting_approval'));

create index if not exists skills_agent_idx on skills(agent_id);
create index if not exists approvals_workspace_status_idx on approvals(workspace_id, status, created_at desc);
`;

export const MIGRATION_008_AGENT_WORKSPACE = `
alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals
  add constraint approvals_kind_check
  check (kind in ('activate_agent', 'run_task', 'git_push'));

alter table project_repo_bindings
  add column if not exists default_branch text;
`;

export const MIGRATION_009_ACCOUNTS = `
create table if not exists studio_accounts (
  workspace_id text primary key references workspaces(id) on delete cascade,
  id text not null unique,
  email text not null,
  display_name text not null,
  password_hash text not null,
  plan_id text not null check (plan_id in ('free', 'pro', 'team', 'unlimited')),
  subscription_status text not null check (subscription_status in ('active', 'past_due', 'canceled', 'trialing')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  session_token_hash text,
  connected_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists studio_accounts_email_idx on studio_accounts (lower(email));
`;

export const MIGRATION_010_AGENT_PROFILES = `
alter table agents add column if not exists specialty text;
alter table agents add column if not exists bio text;
alter table agents add column if not exists instructions text;
`;

export const MIGRATION_011_SESSION_SPEND = `
alter table conversations
  add column if not exists spend_tier text not null default 'low';
alter table conversations
  add column if not exists session_token_budget integer;
`;

export const MIGRATION_012_GOALS_PHASE12 = `
create table if not exists goals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  conversation_id text references conversations(id) on delete set null,
  project_id text references projects(id) on delete set null,
  team_id text references teams(id) on delete set null,
  title text not null,
  detail text,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists goals_agent_status_idx on goals(agent_id, status);
create index if not exists goals_workspace_status_idx on goals(workspace_id, status, updated_at desc);
create index if not exists goals_conversation_idx on goals(conversation_id);
create index if not exists conversations_team_idx on conversations(team_id);
`;

export const MIGRATION_013_CALL_TOOL_APPROVAL = `
alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals
  add constraint approvals_kind_check
  check (kind in ('activate_agent', 'run_task', 'git_push', 'call_tool'));
`;

export const MIGRATION_014_OPERATOR_TITLE_NULLABLE = `
alter table operator_profiles
  alter column title drop not null;

alter table operator_profiles
  alter column title set default null;

update operator_profiles
set title = null
where title is not null and length(trim(title)) = 0;
`;

export const MIGRATION_015_COMPANION_STATE = `
create table if not exists companion_states (
  workspace_id text primary key references workspaces(id) on delete cascade,
  updated_at timestamptz not null,
  state jsonb not null
);
`;

export const MIGRATION_016_FAMILY_PLANS = `
alter table studio_accounts drop constraint if exists studio_accounts_plan_id_check;
alter table studio_accounts
  add constraint studio_accounts_plan_id_check
  check (plan_id in ('free', 'pro', 'family', 'family_plus', 'team', 'unlimited'));
`;

export const MIGRATION_017_ORG_WORKFORCE = `
create table if not exists org_departments (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  team_id text references teams(id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists org_departments_workspace_name_idx
  on org_departments (workspace_id, lower(name));

create table if not exists org_employees (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  department_id text references org_departments(id) on delete set null,
  email text not null,
  display_name text not null,
  title text,
  role text not null check (role in ('admin', 'manager', 'member')),
  status text not null check (status in ('active', 'disabled')),
  password_hash text not null,
  session_token_hash text,
  last_login_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists org_employees_workspace_email_idx
  on org_employees (workspace_id, lower(email));

alter table conversations
  add column if not exists owner_employee_id text references org_employees(id) on delete set null;
alter table conversations
  add column if not exists visibility text not null default 'workspace';
alter table conversations drop constraint if exists conversations_visibility_check;
alter table conversations
  add constraint conversations_visibility_check
  check (visibility in ('private', 'department', 'workspace'));

alter table tasks
  add column if not exists assignee_employee_id text references org_employees(id) on delete set null;

create index if not exists conversations_owner_employee_idx on conversations(owner_employee_id);
create index if not exists tasks_assignee_employee_idx on tasks(assignee_employee_id);
`;

export const MIGRATION_018_ORG_SECURITY = `
alter table org_employees
  add column if not exists session_expires_at timestamptz;
alter table org_employees
  add column if not exists failed_login_count integer not null default 0;
alter table org_employees
  add column if not exists locked_until timestamptz;
alter table org_employees
  add column if not exists password_changed_at timestamptz;
alter table org_employees
  add column if not exists must_change_password boolean not null default false;

create table if not exists org_security_events (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null,
  actor_employee_id text references org_employees(id) on delete set null,
  target_employee_id text references org_employees(id) on delete set null,
  detail text not null,
  ip_hash text,
  created_at timestamptz not null
);

create index if not exists org_security_events_workspace_created_idx
  on org_security_events (workspace_id, created_at desc);
`;

/** Keep chats when an agent row is removed — detach, never cascade-delete messages. */
export const MIGRATION_019_CHAT_SURVIVES_AGENT_DELETE = `
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where rel.relname = 'conversations'
    and nsp.nspname = current_schema()
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%agent_id%';
  if fk_name is not null then
    execute format('alter table conversations drop constraint %I', fk_name);
  end if;
end $$;

alter table conversations
  add constraint conversations_agent_id_fkey
  foreign key (agent_id) references agents(id) on delete set null;
`;

export const MIGRATION_020_FAMILY_HOUSEHOLD = `
create table if not exists family_members (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('parent', 'partner', 'child')),
  age_tier text check (age_tier is null or age_tier in ('tier_6_9', 'tier_10_13', 'tier_14_17')),
  color text not null default '#7C6A4E',
  pin_hash text,
  is_owner boolean not null default false,
  is_paused boolean not null default false,
  token_allowance integer not null default 0,
  tokens_used integer not null default 0,
  last_active_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists family_members_workspace_idx
  on family_members (workspace_id, display_name);

create table if not exists family_household (
  workspace_id text primary key references workspaces(id) on delete cascade,
  extra_seats integer not null default 0,
  active_member_id text,
  updated_at timestamptz not null
);

create table if not exists family_guidance (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  companion_id text not null,
  child_member_id text not null references family_members(id) on delete cascade,
  author_member_id text not null references family_members(id) on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz not null
);

create index if not exists family_guidance_companion_idx
  on family_guidance (workspace_id, companion_id, created_at desc);
`;

export const MIGRATION_021_FAMILY_MEMBER_TOKENS = `
alter table family_members
  add column if not exists token_allowance integer not null default 0;
alter table family_members
  add column if not exists tokens_used integer not null default 0;

create table if not exists family_household (
  workspace_id text primary key references workspaces(id) on delete cascade,
  extra_seats integer not null default 0,
  active_member_id text,
  updated_at timestamptz not null
);

create table if not exists family_guidance (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  companion_id text not null,
  child_member_id text not null,
  author_member_id text not null,
  author_name text not null,
  content text not null,
  created_at timestamptz not null
);

create index if not exists family_guidance_companion_idx
  on family_guidance (workspace_id, companion_id, created_at desc);
`;

export const MIGRATION_022_FAMILY_FREE_PLAN = `
alter table studio_accounts drop constraint if exists studio_accounts_plan_id_check;
alter table studio_accounts
  add constraint studio_accounts_plan_id_check
  check (plan_id in ('free', 'pro', 'family_free', 'family', 'family_plus', 'team', 'unlimited'));
`;

export const MIGRATIONS: ReadonlyArray<{ id: string; sql: string }> = [
  { id: "001_core", sql: MIGRATION_001_CORE },
  { id: "002_conversations", sql: MIGRATION_002_CONVERSATIONS },
  { id: "003_connected_workforce", sql: MIGRATION_003_CONNECTED_WORKFORCE },
  { id: "004_command_center", sql: MIGRATION_004_COMMAND_CENTER },
  { id: "005_operator_seats", sql: MIGRATION_005_OPERATOR_SEATS },
  { id: "006_execution_desk", sql: MIGRATION_006_EXECUTION_DESK },
  { id: "007_skills_approvals", sql: MIGRATION_007_SKILLS_APPROVALS },
  { id: "008_agent_workspace", sql: MIGRATION_008_AGENT_WORKSPACE },
  { id: "009_accounts", sql: MIGRATION_009_ACCOUNTS },
  { id: "010_agent_profiles", sql: MIGRATION_010_AGENT_PROFILES },
  { id: "011_session_spend", sql: MIGRATION_011_SESSION_SPEND },
  { id: "012_goals_phase12", sql: MIGRATION_012_GOALS_PHASE12 },
  { id: "013_call_tool_approval", sql: MIGRATION_013_CALL_TOOL_APPROVAL },
  { id: "014_operator_title_nullable", sql: MIGRATION_014_OPERATOR_TITLE_NULLABLE },
  { id: "015_companion_state", sql: MIGRATION_015_COMPANION_STATE },
  { id: "016_family_plans", sql: MIGRATION_016_FAMILY_PLANS },
  { id: "017_org_workforce", sql: MIGRATION_017_ORG_WORKFORCE },
  { id: "018_org_security", sql: MIGRATION_018_ORG_SECURITY },
  { id: "019_chat_survives_agent_delete", sql: MIGRATION_019_CHAT_SURVIVES_AGENT_DELETE },
  { id: "020_family_household", sql: MIGRATION_020_FAMILY_HOUSEHOLD },
  { id: "021_family_member_tokens", sql: MIGRATION_021_FAMILY_MEMBER_TOKENS },
  { id: "022_family_free_plan", sql: MIGRATION_022_FAMILY_FREE_PLAN },
];
