# Arrab Studio — Complete Product Documentation

**Version:** 0.12.1  
**Document type:** Product & platform reference  
**Source of truth:** Running product in `apps/desktop` + shared contracts in `packages/shared`  
**Languages:** English / العربية (RTL)  
**Last aligned with codebase:** September 2026

---

## Table of contents

1. [Executive overview](#1-executive-overview)
2. [Product vision & principles](#2-product-vision--principles)
3. [Audiences & studio shells](#3-audiences--studio-shells)
4. [Subscription plans (complete catalog)](#4-subscription-plans-complete-catalog)
5. [Billing, entitlements & usage](#5-billing-entitlements--usage)
6. [Individual Studio — features](#6-individual-studio--features)
7. [Family Studio — features](#7-family-studio--features)
8. [Family Guardian (parental co-parenting system)](#8-family-guardian-parental-co-parenting-system)
9. [Organization Studio — features](#9-organization-studio--features)
10. [Companions system](#10-companions-system)
11. [Second Brain](#11-second-brain)
12. [Connectors](#12-connectors)
13. [Chat, cowork & AI runtime](#13-chat-cowork--ai-runtime)
14. [Settings, account & identity](#14-settings-account--identity)
15. [Security & privacy model](#15-security--privacy-model)
16. [Platform architecture](#16-platform-architecture)
17. [Desktop application & release](#17-desktop-application--release)
18. [Internationalization](#18-internationalization)
19. [Feature matrix by plan](#19-feature-matrix-by-plan)
20. [Glossary](#20-glossary)
21. [Appendix — redeem codes & seat packs](#21-appendix--redeem-codes--seat-packs)

---

## 1. Executive overview

**Arrab Studio** is a premium AI productivity platform for three worlds under one product:

| Audience | Who it serves | Shell |
| --- | --- | --- |
| **Individuals** | Founders, creators, solo operators | Companions suite |
| **Families** | Households with parents, partners, and kids | Companions suite + household seats + Guardian |
| **Organizations** | Teams shipping with multi-agent workforces | HQ, Workplace, Workforce, Live Office |

**Positioning:** *Build your AI workforce.*  
Arrab is not a single chatbot. It is a **studio** where people hire, guide, and work alongside AI companions (individuals/families) or AI employees and departments (organizations).

**Core differentiators**

- **Companions, not chatbots** — each companion has domain, purpose, memory, and work.
- **Second Brain** — on-device knowledge graph of decisions, sessions, and facts per person (and per family seat).
- **Family Guardian** — transparent co-parenting chaperone: companions name family rules openly; parents get digested coaching, not raw surveillance transcripts.
- **Seat-isolated credentials** — connectors (Gmail, GitHub, …) belong to a family profile, never leak across seats.
- **Organization Live Office** — departments, seats, and a spatial workforce map.
- **Desktop-first** — macOS Studio (Tauri), secrets stay on the Arrab API, bilingual EN/AR.

---

## 2. Product vision & principles

### 2.1 Vision

Give every person — solo founder, parent, child, or employee — an AI workspace that feels **warm, private, and under their control**, while giving households and companies the structure to share safely.

### 2.2 Design principles

| Principle | Meaning in product |
| --- | --- |
| **Coach, don’t spy** | Parents see Guardian decisions and coaching scripts — not full kid chat dumps by default. |
| **Least privilege** | Kids see their own companions, Brain, work, and connectors only. |
| **Transparent boundaries** | When a family rule applies, the companion *names* it kindly instead of silent blocking walls. |
| **Secrets never leave the API** | OAuth tokens and connector secrets are encrypted server-side; the desktop never stores provider secrets. |
| **Plan locks audience** | Free/Pro → Individual; Family* → Family shell; Team/Scale → Organization. |
| **Bilingual by default** | Full EN and AR (RTL) UI. |

### 2.3 What Arrab is not

- Not a generic ChatGPT wrapper with a thin skin.
- Not Screen Time-style covert filtering.
- Not an “unlimited tokens forever” SKU — every plan has a monthly token pool.

---

## 3. Audiences & studio shells

The signed-in account’s `planId` determines **audience** and **shell**.

| Plan audience | Route base | Primary nav |
| --- | --- | --- |
| `individual` | `/#/individuals/…` | Chat · Studio · Board · Brain · Work · Me · Settings |
| `family` | `/#/individuals/…` | Same as individual **+ Connectors** |
| `organization` | `/#/organizations/…` | HQ · Workplace · Chat · Brain · Workforce · Connectors · Activity · Settings |

**Note:** Family shares the individuals route shell so companions UX stays consistent; household controls live under Settings → Family and the Guardian hub.

---

## 4. Subscription plans (complete catalog)

Currency: **SAR** (Saudi Riyal). Billing interval: **month**.  
Token limits are total tokens (input + output) per billing period.

### 4.1 Individual plans

#### Free — `free`

| Field | Value |
| --- | --- |
| Price | **0 SAR / month** |
| Token pool | **100,000** (1× baseline) |
| Audience | Individual |
| Badge | — |
| Description | Start a studio, hire your first employee, and feel the product. |

**Includes**

- 1× included usage  
- 1 AI employee desk  
- Web workspace + macOS Studio  

**Best for:** Trying Arrab before committing.

---

#### Pro — `pro`

| Field | Value |
| --- | --- |
| Price | **49 SAR / month** |
| Token pool | **2,000,000** (20×) |
| Audience | Individual |
| Badge | Most chosen |
| Highlight | Yes |
| Description | Daily cowork for founders who live in Arrab. |

**Includes**

- 20× included usage  
- Unlimited employees & projects  
- Priority model routing  
- Desktop Studio + testing workspace  

**Best for:** Solo founders and power users.

---

### 4.2 Family plans

#### Family Free — `family_free`

| Field | Value |
| --- | --- |
| Price | **0 SAR / month** |
| Token pool | **100,000** shared |
| Seat limit | **6** |
| Badge | Trial |
| Description | Free family trial — share seats at home and try household companions together. |

**Includes**

- 1× shared household usage  
- Up to 6 family seats  
- Parents, partners, and kids  
- PIN profiles + parental pause  
- macOS Studio on every home Mac  

**Best for:** Trying household seats and Guardian before upgrading.

---

#### Family — `family`

| Field | Value |
| --- | --- |
| Price | **79 SAR / month** |
| Token pool | **4,000,000** shared (40×) |
| Seat limit | **6** |
| Badge | Household |
| Description | One shared studio for the household — companions, chats, and desks together. |

**Includes**

- 40× shared household usage  
- Up to 6 family seats  
- Shared companions & chat history (scoped by seat ownership rules)  
- Parental-friendly usage overview  
- macOS Studio on every home Mac  

**Best for:** Typical households.

---

#### Family Plus — `family_plus`

| Field | Value |
| --- | --- |
| Price | **129 SAR / month** |
| Token pool | **8,000,000** shared (80×) |
| Seat limit | **10** |
| Badge | Family pick |
| Highlight | Yes |
| Description | More room for larger households and heavier daily use. |

**Includes**

- 80× shared household usage  
- Up to 10 family seats  
- Priority routing for every member  
- Shared knowledge & memories  
- Priority household support  

**Best for:** Larger families / heavy daily companion use.

---

### 4.3 Organization plans

#### Team — `team`

| Field | Value |
| --- | --- |
| Price | **149 SAR / month** |
| Token pool | **10,000,000** (100×) |
| Audience | Organization |
| Description | Multi-agent studios shipping together. |

**Includes**

- 100× studio usage  
- Shared goals, tasks, and memory  
- Team chat & cowork rooms  
- Usage controls per session  
- Priority support  

---

#### Scale — `unlimited` (legacy plan id)

| Field | Value |
| --- | --- |
| Plan ID | `unlimited` (kept for existing accounts) |
| Display name | **Scale** |
| Price | **399 SAR / month** |
| Token pool | **50,000,000** (500×) |
| Badge | Scale |
| Highlight | Yes |
| Description | Highest monthly pool for production studios shipping at volume. |

**Includes**

- 500× studio usage  
- Highest throughput routing  
- Dedicated onboarding  
- Custom workforce playbooks  
- Usage controls per session  

> **Important:** Despite the legacy id `unlimited`, this plan is **capped**. There is no infinite-token SKU.

---

### 4.4 Plan comparison at a glance

| Plan | Audience | SAR/mo | Tokens/mo | Seats |
| --- | --- | ---: | ---: | ---: |
| Free | Individual | 0 | 100k | — |
| Pro | Individual | 49 | 2M | — |
| Family Free | Family | 0 | 100k | 6 |
| Family | Family | 79 | 4M | 6 |
| Family Plus | Family | 129 | 8M | 10 |
| Team | Organization | 149 | 10M | Org seats (separate) |
| Scale | Organization | 399 | 50M | Org seats (separate) |

---

## 5. Billing, entitlements & usage

### 5.1 How usage works

- Every AI turn consumes tokens from the plan pool.
- Entitlements expose: `tokenLimit`, `tokensUsed`, `tokensRemaining`, `overLimit`, `pauseMode`.
- When over limit, Studio AI pauses (`QuotaPauseScreen`).
  - Free plans: upgrade required.
  - Paid plans: upgrade **or** wait until the next billing period.

### 5.2 Family member allowances

Within family plans, parents can assign **token allowances** per seat from the household pool. A child who exhausts their allowance is blocked from chatting until a parent grants more (soft budgets on Family Free trial).

### 5.3 Guest / unconnected mode

Without a signed-in cloud account, a soft local allowance applies (`LOCAL_UNCONNECTED_TOKEN_LIMIT` = **25,000** tokens) for local-model / guest exploration.

### 5.4 Payment

Checkout is handled via **Moyasar** invoices in SAR. Plans are also redeemable via studio codes (see Appendix).

---

## 6. Individual Studio — features

Individual plans (**Free** and **Pro**) use the companions shell. Landing is always **Chat**.

**Navigation:** Chat → Studio → Board → Brain → Work (Tasks) → Me → Settings

```
/#/individuals/…
```

Connectors are reachable via Me / deep link on Free & Pro (not in primary nav). Family plans add Connectors to the rail (§7).

### 6.1 Who Individual is for

| Persona | Why Arrab |
| --- | --- |
| Solo founder | Hire companions that ship (design, code, inbox) under one Studio |
| Creator / maker | Studio purposes with live web/phone preview |
| Knowledge worker | Board nudges + Brain + Work capture without a team HQ |
| Local-first user | Guest mode with Ollama when not signed in |

### 6.2 Free vs Pro (beyond tokens)

| | **Free** (`free`) | **Pro** (`pro`) |
| --- | --- | --- |
| Price | 0 SAR / month | **49 SAR / month** |
| Token pool | **100,000** (1×) | **2,000,000** (20×) |
| Badge | — | **Most chosen** |
| Desks / projects | **1 AI employee desk** | **Unlimited employees & projects** |
| Routing | Standard | **Priority model routing** |
| Desktop | Web + macOS Studio | **Desktop Studio + testing workspace** |
| When over limit | Upgrade required | Upgrade **or** wait until next period |

Soft allowance without a cloud account: **25,000** local tokens (`LOCAL_UNCONNECTED_TOKEN_LIMIT`).

### 6.3 Chat — companions home

- Roster of personal AI companions (faces, last line, resume caption).
- Open a room → streamed replies.
- **Session modes:** Agent · Plan · Debug · Multitask · Ask (tool/work framing).
- **Vent / Take** chips: listen-only vs concrete opinion (separate from session modes).
- Domain chips (Connect email, Triage inbox, Help me debug, …).
- **Sensitive mode** (≈48h): dampens humour / unsolicited advice after heavy topics.
- **Incognito** (Personal space): password vault, private disposable chat.
- Composer plus-menu for attachments and actions.

Full companion model: §10.

### 6.4 Studio

`CompanionStudioPage` — build and shape companions:

- Pick a **studio-selectable** purpose (Arrab Assistant, Web/Phone Design, Brand, Product Flow, UX Copy).
- Shared studio catalog faces (defaults ship ready).
- Live browser preview for web/phone design work.
- Files / export / Arrab Assistant workspace tools.
- Portrait photo picker for companion faces.

### 6.5 Board

`IndividualHomePage` — “Only what deserves your attention. The rest can wait.”

- Attention cards (≤ **3** on Board; nudge ceiling **2/week**).
- Silence / wind-down line when things are heavy.
- Quick jumps into companion rooms.
- On Family: parent can pick a child seat and compose companions for them (see §7).

### 6.6 Brain

Personal Second Brain graph (`scope=individual`) — decisions, sessions, facts. See §11.

### 6.7 Work (Tasks)

`CompanionWorkPage` — Ideas · Yours · Ready · Cleared, plus open threads.

- Purpose creation seeds starter task templates.
- Tracks what companions and you are shipping.

### 6.8 Me

`CompanionMePage` — “What your companions remember, and what you let them know.”

- “Knows about you” memory list  
- Export memories  
- Fold / unarchive companions  
- Profile photo  
- Permissions (health / calendar / contacts) → Connectors  
- Wipe local companion data  

### 6.9 Spaces: Personal vs Professional

| Space | Rule |
| --- | --- |
| **Personal** | Stays out of Professional |
| **Professional** | May read Personal; not the reverse |

`SpaceSwitch` appears on Chat, Board, Brain, Work, Me.

### 6.10 Guest mode & local models

- Continue without cloud: **local models only** banner.
- Forces local AI preference; `canUseCloudAi()` requires an account session.
- Sign in unlocks cloud models and full sync.

### 6.11 Testing workspace

Pro includes access to the Arrab **testing workspace** (`testingworkspace.arrabai.com`) — plan catalog, Studio downloads, release drops for desktop builds.

### 6.12 Settings (Individual)

Usage · Account · General · Appearance · Models · Notifications · Privacy · Desktop · Connection · Shortcuts · About  
(Account page also hosts plan catalog, Moyasar checkout, redeem codes.)

---

## 7. Family Studio — features

Family builds on the Individual suite and adds **household governance**.

### 7.1 Household seats

| Role | Capabilities |
| --- | --- |
| **Parent** (owner) | Manage seats, pause kids, Guardian, grants, billing overview |
| **Partner** | Manager capabilities (co-parent) |
| **Child** | Own companions, chat, board, brain partition, work — isolated |

**Seat limits:** 6 (Family Free / Family) or 10 (Family Plus), plus optional purchased packs.

### 7.2 Profile switch & PIN

- Switch active family member from the profile switcher.
- Children require a **4–8 digit PIN**.
- PIN hashes are stored server-side (scrypt); clients only see `hasPin`.
- Paused profiles cannot be switched into for chat.

### 7.3 Parental pause

- Parents/partners can **pause** a child’s access instantly.
- Kid sees a calm paused screen (not a scary lockout wall).
- Also available as **Remote pause** inside Guardian Hub.

### 7.4 Age tiers

| Tier ID | Ages |
| --- | --- |
| `tier_6_9` | 6–9 |
| `tier_10_13` | 10–13 |
| `tier_14_17` | 14–17 |

Age tiers drive Guardian builtin defaults and optional starter rule packs.

### 7.5 Parent guidance to companions

Parents can leave **private coaching notes** for a child’s companion (how the kid feels, what helps, what to avoid). Guidance is not shown as a kid transcript dump.

### 7.6 Ask-to-approve companions

Kids can **Ask** a parent to create a new companion. Parents approve or decline in Guardian → Approvals. The companion is only created after approval.

### 7.7 Connector isolation

Each family seat owns its own connectors. A kid never sees a parent’s Gmail/GitHub (and cannot use those secrets). See §12.

### 7.8 Family navigation extras

Family nav includes **Connectors** in addition to the full Individual suite. Chat remains first so kids and parents land on conversation.

### 7.9 Kid vs parent companion experience

| Area | Parent / partner | Child |
| --- | --- | --- |
| Create companion | Direct create + parent guidance facts | **Ask a parent** only |
| Roster | Household companions (Board member filter) | Own companions only |
| Board | Family seats, compose for kids | Own board; kid starters (Say hi / I need help / How I feel) |
| Work / Brain | Full (manager) | Partitioned to own companions / Brain |
| Connectors | Own seat’s connectors | Own-only — never parent accounts |
| Guardian | Hub + coaching toasts | Boundary chips; pause screen if paused |
| PIN / pause | Manage | PIN to switch; paused = blocked |

---

## 8. Family Guardian (parental co-parenting system)

Guardian is Arrab’s parental system: a **standing decision-maker** that sits between companion and child — not a covert keyword firewall.

### 8.1 Philosophy

| Traditional parental control | Arrab Guardian |
| --- | --- |
| Silent block / red banner | Companion names the family rule kindly |
| Transcript surveillance | Digested Decision Feed + coaching scripts |
| Checkbox Screen Time | Plain-language rules + Brain context |
| Adversarial | Co-parenting partnership |

### 8.2 Verdict ladder

| Verdict | Kid experience | Parent experience |
| --- | --- | --- |
| `allow` | Natural reply | — |
| `scaffold` | Guiding questions (e.g. homework) instead of full answers | Logged when relevant |
| `model_boundary` | Companion openly names the family rule | Logged in Decision Feed |
| `coach_parent` | Companion stays present and warm | Live toast + “How to show up” script |
| `pause_with_care` | Hard safety pause wrapped in warmth | Alert + coaching |

### 8.3 Rule kinds

- **Hard** — deterministic failsafes (self-harm, stranger meetups, contact sharing, sexual content, violence): instant `pause_with_care`.
- **Soft** — parent-authored natural language (“If they talk about meeting strangers, tell me…”).
- **Schedule** — quiet hours / downtime.
- **Tone** — warmth, length, playfulness by age.
- **Wellbeing** — heavy feelings → stay present + coach parent.

### 8.4 Pipeline (latency-aware)

```
Kid message
  → Preflight (hard rules + quiet hours) — may short-circuit before any LLM tokens
  → Companion prompt includes active Guardian rules (first-pass compliance)
  → Companion streams draft
  → Post-draft evaluation (soft / scaffold / coach)
  → Final reply to kid
  → Decision logged to child’s Second Brain + optional parent coaching alert
```

### 8.5 Guardian Hub (parent UI)

Located in **Settings → Family → select child → Guardian**.

| Tab | Purpose |
| --- | --- |
| **Feed** | Digested decisions + coaching (“How to show up”) |
| **Rules** | Write plain-language rules; apply age-tier starter packs |
| **Quiet hours** | Schedule rest window; pick always-allowed companions |
| **Approvals** | Approve/decline kid companion requests |
| **Audit** | Tamper-evident trail of Guardian actions |

Also: weekly digest strip + narrative; remote pause/resume.

### 8.6 Kid-visible moments

After a Guardian turn, kids may see a calm **boundary chip**:

| Context | Chip |
| --- | --- |
| `pause_with_care` | **Safety pause** |
| `model_boundary` | **Family rule named** |
| `scaffold` | **Thinking together** |
| `coach_parent` | **Parent got a heads-up** |

### 8.7 Live parent coaching toasts

When a manager seat is active and a kid escalates (`coach_parent` / `pause_with_care`), the parent receives an in-app toast with the coaching script.

### 8.8 On-device Guardian store

Rules, downtime, approvals, audit, and alerts persist on-device (`arrab.guardian.v1`), aligned with Brain’s privacy model.

---

## 9. Organization Studio — features

Organization plans (**Team** and **Scale**) use a different shell: **workforce first**, not personal companions.

**Navigation:** HQ → Workplace → Chat → Brain → Workforce → Connectors → Activity → Settings

```
/#/organizations/…
```

Also: `/desk/:agentId` — focused **Employee Desk** for one AI employee.

### 9.1 Who Organization is for

| Persona | Why Arrab |
| --- | --- |
| Studio / agency lead | Departments as offices, hire humans + AI agents |
| Product team | Shared goals, tasks, chat, cowork rooms |
| Ops lead | Live Map, token credits, audit trail |
| Production shop | Scale pool + highest throughput routing |

### 9.2 Team vs Scale

| | **Team** (`team`) | **Scale** (`unlimited` id) |
| --- | --- | --- |
| Display name | Team | **Scale** |
| Price | **149 SAR / month** | **399 SAR / month** |
| Token pool | **10,000,000** (100×) | **50,000,000** (500×) |
| Badge | — | **Scale** |
| Positioning | Multi-agent studios shipping together | Highest monthly pool for production volume |
| Includes | Shared goals/tasks/memory; team chat & cowork; usage controls; priority support | Everything Team-class **plus** highest throughput routing, dedicated onboarding, custom workforce playbooks |

Org **seat limits** are separate from plan tokens (default **8** seats, expandable via packs — see §9.6). Despite id `unlimited`, Scale is **capped**.

### 9.3 HQ (Headquarters)

`HomePage` — “Hire people, manage them here, then jump into Chat or Cowork to ship.”

- Hire / overview of workforce groups  
- Studio goal framing  
- Assign work (`@name`, “assign X to Y”)  
- Jump into Chat or Workplace  
- Live office entry points  

### 9.4 Workplace

`WorkplacePage` → Companion Studio in **org studios** variant (former Cowork redirects here).

- Shared studio work for the organization  
- Design / ship surfaces for team agents  

### 9.5 Chat (org)

`ChatPage` — organization chat with:

- Workforce **AI agents**, **teams**, and **human employees**  
- Connector-backed tools (mail, SSH, GitHub, Finnhub, …)  
- Message queue, pause/resume streams  
- Approvals for sensitive tool actions  

### 9.6 Workforce

`WorkforcePage` is the org control plane.

#### Departments

- Named offices with description; optional link to an AI `teamId`.
- Appear as rooms on the **Live Map**.
- Per-office capacity (typically up to **8** agents).

#### Human employees

| Field | Notes |
| --- | --- |
| Email + password | Provisioned seats |
| Role | `admin` · `manager` · `member` |
| Status | active / disabled |
| Title / display name | Directory |

#### AI agents

- Compose roles: researcher · engineer · reviewer · ops · writer  
- Modes: autonomous · supervised · pair  
- Assigned to teams / departments  

#### Seats & packs (UI)

| Pack | Seats |
| --- | --- |
| Starter | **8** (default) |
| Growth | **16** |
| Scale pack | **40** |

(Seat pack pricing may show “coming later” in UI.)

#### Token credits (per employee)

- Default allowance example: **200,000** tokens per employee seat  
- Credit packs: **+50k / +200k / +1M**  
- Drawn from the org account pool with per-seat budgets  

#### Live Map / Agents Office

- Spatial floor view of departments and seats (`AgentsOfficeHost`)  
- Labels: **Live**, **Live office**, **Live map**  
- Admin-gated open for employee seats where policy requires  

#### Org Admin tabs

Overview · Departments · Employees · Tokens · Access

#### Permissions (examples)

`canAdminister`, `canAssignWork`, `canHireAgents`, `canManageTeams`, `canViewDirectory`, `canViewAllChats` / Tasks / Agents, `canViewAudit`.

#### Seat capabilities

| Seat | Typical power |
| --- | --- |
| Billing owner (no employee session) | Full admin |
| Employee `admin` | Live Map, hire, billing |
| Employee `manager` | Assign work |
| Employee `member` | Own usage only |

#### Security & audit

Policy fields: password min length, session TTL, lockout threshold/minutes.  
Audit kinds include employee create/update/disable/sign-in/fail/lock, department changes, permission.denied.

### 9.7 Brain (org)

Shared studio Second Brain (`scope=solo`) for org memory — distinct from personal companion Brain partitions.

### 9.8 Activity

`ActivityPage` — org workforce activity only (filters out personal companion noise).

### 9.9 Employee desk

`/desk/:agentId` — focused surface for one AI employee: status, work, conversation.

### 9.10 How Organization differs from Companions

| | Companions (Individual / Family) | Organization |
| --- | --- | --- |
| Primary actor | Companions with purposes & memory | AI agents + human seats + departments |
| Shell | `/individuals` · Chat-first | `/organizations` · HQ-first |
| Creation | Purpose registry / Ask parent | Hire agents, provision employees |
| Memory | Per-person Brain + facts | Shared Brain + org knowledge/tasks |
| Governance | Family Guardian | Roles, approvals, security audit |
| Spatial UX | Board cards | Live Office map |
| Tokens | Account pool (+ family seat allowances) | Account pool + **per-employee credits** |

---

## 10. Companions system

Companions are the heart of **Individual** and **Family** plans. Organizations use workforce agents instead (see §9).

### 10.1 What a companion is

A **Companion** (`CompanionProfile`) is a named AI partner with:

| Field | Meaning |
| --- | --- |
| `name`, `domain`, `purposeId` | Identity + specialty + registry purpose |
| `brief` | Standing responsibility / personality |
| `space` | `personal` (**Personal**) or `work` (**Professional**) |
| `hue`, `faceSeed`, `avatarPhoto` | Unique portrait (optional photo) |
| `tone` / tone presets | Direct, Measured, Coach, Friend, Professional, Quiet |
| `connectors[]` | Preferred providers (gmail, github, …) |
| `callOut[]` | Topics to surface (spending, sleep, focus, …) |
| `lastMemory`, `lastLine`, `resume` | Face caption / reopen mid-thread |
| `familyMemberId` | Seat ownership on Family plans |
| `agentId`, `conversationId` | Lazy cloud agent + conversation |

Local vault: `arrab.companions.v2`.

### 10.2 How companions are created

1. **Chat catalog / Add** — presets or custom name + focus.  
2. **Studio** — studio-selectable purposes → shared studio catalog.  
3. **Topic birth** — ~3 mentions of sleep/money/work/study/training → offer to birth a companion.  
4. **General** — always available; persisted when a real message needs an agent.  
5. **Family parent** — Board compose for a child (`familyMemberId` + optional parent guidance).  
6. **Family kid** — **Ask a parent** only (Guardian Approvals).  

Creating a purpose companion seeds **task templates** into Work (unless disabled).

### 10.3 Purpose registry (complete)

#### Studio-selectable

| ID | Name | Blurb |
| --- | --- | --- |
| `arrab-assistant` | Arrab Assistant | Do anything — PC files, connectors, arrange, ship |
| `web-design` | Web Design | Sites, landing pages, live browser preview |
| `phone-design` | Phone Design | Mobile screens / pocket layouts |
| `brand-identity` | Brand Identity | Voice, palette, type, visual direction |
| `product-flow` | Product Flow | Onboarding, journeys, screen sequences |
| `copy-ux` | UX Copy | Headlines, CTAs, empty states, microcopy |

Default Studio catalog faces: Arrab Assistant, Web Designer, Phone Designer, Brand, Copywriter.

#### Chat / personal

| ID | Name | Blurb |
| --- | --- | --- |
| `general` | General | Open room for anything |
| `health` | Ivy | Sleep, movement, own health baseline |
| `relationships` | Maya | People who matter, last contact |
| `sleep` | Sleep | Rest, late nights, recovery |
| `money` | Sam | Spending, bills, runway (not licensed advice) |
| `parents` | June | Parents’ health, visits, occasions |
| `career` | Marcus | Path, satisfaction, burnout |
| `chronicler` | Chronicler | Quiet recap of what you lived |
| `work` | Work | Execution and capacity |
| `meetings` | Meetings | Brief before, owners after |
| `colleagues` | Colleagues | Who is waiting on you at work |
| `decision-guard` | Decision guard | Slows a rushed late-night decision |
| `meaning` | Meaning | The practice you chose (no religious ruling) |
| `paperwork` | Paperwork | Licences, passports, insurance expiry |
| `daily-decisions` | Daily decisions | One option, never a list |
| `study` | Study | Exams, courses, focus |
| `training` | Training | Gym, runs, consistency |
| `focus` | Focus | Deep work and distractions |
| `coder` | Coder | Repos, reviews, debugging |
| `inbox` | Inbox | Mail triage, arrange, replies |
| `trader` | Trader | Markets — quotes, news, risk (not financial advice) |
| `custom` | Custom | Operator-defined purpose |

**Chat presets** often suggest connectors (Inbox → Gmail/Outlook; Coder → GitHub/SSH; Trader → Finnhub).

### 10.4 Facts, memory & guidance

| Kind | Use |
| --- | --- |
| `explicit` | User-told facts |
| `inferred` | Derived; cleared if permission source is off |
| `parent_guidance` | Private parent coaching for a child’s companion |

Permissions: `health` · `calendar` · `contacts`.  
Nudges: whisper · line · critical (max **2/week**). Board shows ≤ **3** cards.

### 10.5 Chat room features (detail)

#### Session modes

| Mode | Hint |
| --- | --- |
| **Agent** | Do the work end to end (default) |
| **Plan** | Think through steps before acting |
| **Debug** | Find and fix what broke |
| **Multitask** | Juggle several threads |
| **Ask** | Answer questions — no edits |

Heuristic / `[[suggest_mode:…]]` can propose a switch (`SessionModeApproveBar`).

#### Vent / Take

| Chip | Framing |
| --- | --- |
| **I just want to vent** | Listen & reflect — no advice or tasks |
| **I need your take** | Be concrete; say what you would do |

#### Sensitive mode

Keyword detect (died, funeral, divorce, cancer, fired, depressed, … + AR) → ~48h softer posture; suppresses non-whisper nudges.

#### Incognito

Personal space only · password vault (≥6 chars) · on-device ciphertext · disposable API conversation · leaving locks the vault.

### 10.6 Cloud sync

1. Mutate local `arrab.companions.v2`.  
2. Debounced push (~900ms) → `PUT` companion state.  
3. Pull: remote wins if newer; **facts merge prefer-local-by-id**.  
4. Offline: local remains; next change retries.  
5. Synced: companions, facts, work, threads, nudges, studio catalog/purposes.  
6. Family: scoped by `familyMemberId`.

### 10.7 Portraits

Unique vector faces at birth (Saudi-forward portrait migration supported). Optional on-device photo upload via Studio.

---

## 11. Second Brain

### 11.1 Concept

Second Brain is Arrab’s **personal knowledge graph**: nodes for conversations, decisions, facts, files, and Guardian events.

### 11.2 Isolation

- Partitioned by account + family member: `arrab.secondBrain.v2.{account}.{member}`
- Kids never inherit a parent’s graph.
- Guardian decisions are stored as nodes tagged `guardian: true` with verdict + coaching — powering the parent Decision Feed without exposing full transcripts.

### 11.3 Surfaces

- **Brain** page for exploration  
- Background ingestion on companion turns  
- Guardian feed reads guardian nodes for the selected child  

---

## 12. Connectors

Connectors link Arrab to external systems. Secrets are encrypted on the API; the desktop never holds provider tokens.

### 12.1 Provider catalog (17)

| Provider | Typical use |
| --- | --- |
| **Gmail** | OAuth mail — list, read, arrange, send |
| **Outlook** | Microsoft OAuth mail |
| **Email (IMAP/SMTP)** | iCloud, Yahoo, custom mailboxes |
| **GitHub** | OAuth — repos, commit, PR |
| **GitLab** | Projects via token / OAuth |
| **Bitbucket** | Repos via app password / OAuth |
| **Linear** | Issues & teams |
| **Slack** | Channels |
| **Notion** | Pages & databases |
| **SSH** | Remote host commands |
| **WhatsApp Business** | Cloud API send/receive (webhook) |
| **Finnhub** | Quotes & news (Trader companions) |
| **WHOOP** | Recovery / sleep / strain OAuth |
| **Fitbit** | Activity / heart / sleep OAuth |
| **Google Drive** | Files OAuth |
| **Google Calendar** | Events OAuth |
| **Figma** | Design files OAuth |

Webhook-capable: WhatsApp, Finnhub.

### 12.2 Family seat isolation (critical)

| Rule | Behavior |
| --- | --- |
| Ownership | Every connector is stamped with `familyMemberId` when created on a family plan |
| Listing | Only connectors for the **active seat** are returned |
| Access | Using another seat’s connector ID is forbidden |
| Legacy | Pre-isolation connectors were assigned to the household **owner** |
| Kids | See an empty / own-only Connectors page — never a parent’s Gmail/GitHub |

### 12.3 Where connectors appear

- Family & Organization nav → Connectors page  
- Chat / companions tool use (mail, SSH, GitHub, Finnhub)  
- Org cowork / deploy flows  

---

## 13. Chat, cowork & AI runtime

### 13.1 AI gateway

Arrab routes model calls through `@arrab/ai` (OpenAI-compatible + Anthropic adapters). Preferences can prefer cloud or local models (e.g. Ollama) where configured.

### 13.2 Streaming UX

- Token streaming into the room  
- Queue additional messages while a reply is in flight  
- Pause / resume send  
- Failed-draft restore  

### 13.3 Approvals & presence

Sensitive tool actions can require human approval; presence hosts surface agent state in the desktop chrome.

### 13.4 Org vs companion chat

| Mode | Primary actor |
| --- | --- |
| Individual / Family | Companions |
| Organization | Workforce agents + teams |

---

## 14. Settings, account & identity

### 14.1 Settings tabs

| Tab | Notes |
| --- | --- |
| Usage | Token pool & period |
| Family | Household seats (family plans only) |
| Account | Profile, plan, billing entry |
| General / Appearance | Language, theme |
| Models | Provider / local model prefs |
| Notifications | Toasts & inbox |
| Privacy | Local data posture |
| Cowork | Family + org |
| Desktop | Window / always-on-top / updates |
| Connection | API connectivity |
| Shortcuts | Keyboard |
| About | Version |

### 14.2 Account management

- Plan catalog with audience filtering  
- Moyasar checkout  
- Redeem codes  
- Session via account token headers  

### 14.3 Auth modes

- Browser / cloud sign-in  
- Guest local mode (local models, limited)  
- First-launch setup checklist  

---

## 15. Security & privacy model

### 15.1 Non-negotiables

1. **No provider secrets in the desktop** — OAuth tokens live encrypted on the API.  
2. **Session headers** authenticate the account; family seat passed as `X-Arrab-Family-Member`.  
3. **PINs** are hashed (scrypt); never returned in API payloads.  
4. **Brain & Guardian stores** prefer on-device partitions for sensitive child data.  
5. **Coach, don’t spy** — Guardian feed is decisions + scripts, not wiretaps.

### 15.2 Threat notes (product-relevant)

| Risk | Mitigation |
| --- | --- |
| Kid sees parent Gmail | Per-seat connector ownership + API enforcement |
| Kid jumps to parent seat | PIN + pause |
| Covert filter resentment | Transparent verdicts / boundary chips |
| Quota abuse | Entitlements + pause screen |
| Transcript oversharing | Digested Guardian nodes |

See also `docs/SECURITY.md` for engineering threat notes.

---

## 16. Platform architecture

```
┌──────────────────────────────────────────────┐
│              Arrab Studio Desktop            │
│         (Tauri 2 · React 19 · Vite 7)        │
│  Individuals / Family shell  │  Org shell    │
└─────────────────┬────────────────────────────┘
                  │ HTTPS + session headers
                  ▼
┌──────────────────────────────────────────────┐
│                 Arrab API                    │
│              (Fastify · Node 22)             │
│  Accounts · Billing · Family · Conversations │
│  Connectors · Org workforce · Goals/Tasks    │
└───────┬───────────────────┬──────────────────┘
        │                   │
        ▼                   ▼
┌───────────────┐   ┌──────────────────────────┐
│  Persistence  │   │  AI Gateway (@arrab/ai)  │
│ Memory / PG   │   │  + Agents runtime         │
└───────────────┘   └──────────────────────────┘
```

### 16.1 Monorepo packages (high level)

| Package / app | Role |
| --- | --- |
| `apps/desktop` | Primary product UI |
| `apps/api` | Backend |
| `apps/agents-office` | 3D / live office experience |
| `apps/ios` | iOS client |
| `packages/shared` | Contracts, plans, entities |
| `packages/database` | Persistence + migrations |
| `packages/ai` | Model gateway |
| `packages/agents` | Agent chat runtime |
| `packages/core` | Errors, ids, clocks |

### 16.2 Related docs

| Doc | Purpose |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Engineering system layout |
| [FEATURE.md](./FEATURE.md) | How to ship features |
| [DATA_MODEL.md](./DATA_MODEL.md) | Domain entities |
| [SECURITY.md](./SECURITY.md) | Secrets & threats |
| [DESKTOP_RELEASE.md](./DESKTOP_RELEASE.md) | Shipping installers |

> If older architecture docs list only free/pro/team/unlimited, **this PRODUCT.md plan catalog is authoritative**.

---

## 17. Desktop application & release

| Item | Value |
| --- | --- |
| Product name | Arrab Studio |
| Bundle id | `com.arrab.studio` |
| Version | 0.12.0 |
| Runtime | Tauri 2 (Rust host + web UI) |
| Platforms | macOS (primary); Windows packaging documented |
| Cloud hosts | `api.arrabai.com`, `auth.arrabai.com` (CSP allowlists) |

Release process: see `docs/DESKTOP_RELEASE.md`.

---

## 18. Internationalization

- Full **English** and **Arabic** message catalogs.
- RTL layout when Arabic is active.
- Guardian and family copy is bilingual (reasons + coaching scripts).

---

## 19. Feature matrix by plan

| Capability | Free | Pro | Family Free | Family | Family+ | Team | Scale |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Companions suite | ✓ | ✓ | ✓ | ✓ | ✓ | —* | —* |
| Board / Brain / Work / Me | ✓ | ✓ | ✓ | ✓ | ✓ | Org Brain | Org Brain |
| Organization HQ / Workforce | — | — | — | — | — | ✓ | ✓ |
| Family seats | — | — | ✓ | ✓ | ✓ | — | — |
| PIN + pause | — | — | ✓ | ✓ | ✓ | — | — |
| Guardian hub | — | — | ✓ | ✓ | ✓ | — | — |
| Connectors in nav | —† | —† | ✓ | ✓ | ✓ | ✓ | ✓ |
| Seat-isolated connectors | — | — | ✓ | ✓ | ✓ | n/a | n/a |
| Priority routing | — | ✓ | — | — | ✓ | ✓ | ✓ |
| Highest throughput | — | — | — | — | — | — | ✓ |
| Monthly tokens | 100k | 2M | 100k | 4M | 8M | 10M | 50M |
| Seat cap | — | — | 6 | 6 | 10 | Org | Org |
| Price SAR/mo | 0 | 49 | 0 | 79 | 129 | 149 | 399 |

\* Org plans use workforce agents rather than the personal companions shell.  
† Individual plans can still open `/connectors` via deep links; Family/Org surface it in primary nav.

---

## 20. Glossary

| Term | Definition |
| --- | --- |
| **Companion** | Personal AI partner with purpose, memory, and work |
| **Purpose** | Registry specialty (web-design, sleep, coder, …) that shapes prompts & tasks |
| **Personal / Professional** | Companion spaces — Personal never reads Professional |
| **Session mode** | Agent / Plan / Debug / Multitask / Ask framing for a turn |
| **Vent / Take** | Reply stance chips (listen-only vs concrete opinion) |
| **Incognito** | Password-locked private companion chat in Personal space |
| **Seat / family member** | A household profile (parent, partner, or child) |
| **Guardian** | Co-parenting decision-maker for child companion turns |
| **Verdict** | Guardian outcome (`allow` … `pause_with_care`) |
| **Second Brain** | On-device knowledge graph of sessions & decisions |
| **Connector** | Linked external account/service (Gmail, GitHub, …) |
| **Workforce** | Org AI employees + human seats + departments |
| **Live Map / Agents Office** | Spatial org floor view of departments and seats |
| **Employee desk** | Focused org surface for one AI employee |
| **Entitlements** | Runtime token budget & pause state for the account |
| **Scale** | Display name for legacy plan id `unlimited` |
| **Quiet hours** | Scheduled rest window enforced by Guardian |
| **Testing workspace** | Pro web surface for plans & Studio downloads |
---

## 21. Appendix — redeem codes & seat packs

### 21.1 Redeem codes

| Code | Plan |
| --- | --- |
| `FREE-ARRAB` | Free |
| `PRO-ARRAB` | Pro |
| `FAMILY-FREE-ARRAB` | Family Free |
| `FAMILY-ARRAB` | Family |
| `FAMILY-PLUS-ARRAB` | Family Plus |
| `TEAM-ARRAB` | Team |
| `SCALE-ARRAB` | Scale |
| `UNLIMITED-ARRAB` | Scale (legacy alias) |

### 21.2 Family extra seat packs

| Pack | Label | Price |
| --- | --- | ---: |
| 1 | +1 seat | **19 SAR** |
| 2 | +2 seats | **34 SAR** |
| 5 | +5 seats | **79 SAR** |

Effective seat capacity = plan `seatLimit` + purchased `extraSeats`.

---

## Document control

| Field | Value |
| --- | --- |
| Owner | Arrab Studio product |
| Canonical plans | `packages/shared/src/account.ts` |
| Canonical nav | `apps/desktop/src/roles/catalog.ts` |
| Canonical family model | `packages/shared/src/family.ts` |
| Canonical Guardian | `apps/desktop/src/lib/guardian.ts` |
| Status | Living document — update when plans or major surfaces change |

---

*© Arrab Studio. Build your AI workforce.*
