import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus } from "lucide-react";
import type { ErpCompanion, FamilyMemberPublic } from "@arrab/shared";
import { ConnectorBrandIcon } from "@/components/ConnectorBrandIcon";
import { useLanguage } from "@/i18n/LanguageProvider";
import { COMPANION_PRESETS, companionDisplayBlurb, type CompanionPreset } from "@/lib/companion-catalog";
import {
  connectorLabel,
  resolveConnectorProviders,
} from "@/lib/connector-catalog";
import { arrabApi } from "@/lib/api";
import {
  addCompanion,
  addFact,
  liveCompanions,
  TONE_PRESETS,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionTone,
  type CompanionToneName,
} from "@/lib/companions";
import { PhotoAvatar } from "./CompanionFace";
import { syncCompanionMemory } from "./CompanionDetails";
import { CompanionPageHeader, PersonAvatar } from "./CompanionUI";
import { companionPortraitUrl, presetPortraitSeed } from "@/lib/companion-portrait";
import { useEnsureRealisticPortraits } from "@/lib/ensure-companion-portraits";

type CatalogView = "list" | "create" | "edit";
type CatalogSelection =
  | { kind: "preset"; id: string }
  | { kind: "person"; id: string }
  | { kind: "erp"; id: string }
  | null;

function toneFromErp(person: ErpCompanion): CompanionTone | undefined {
  const personality = person.personality;
  if (!personality) return undefined;
  return {
    bluntness: 40,
    humour: personality.humor ?? 30,
    replyLength: personality.verbosity ?? 45,
    warmth: personality.warmth ?? 55,
    formality: personality.formality ?? 40,
    criticism: 35,
    pace: personality.creativity ?? 45,
  };
}

const PRESET_HUES: Record<string, number> = {
  health: 162,
  relationships: 328,
  sleep: 248,
  money: 148,
  parents: 22,
  career: 198,
  work: 28,
  meetings: 210,
  colleagues: 18,
  chronicler: 40,
  "decision-guard": 255,
  meaning: 48,
  paperwork: 200,
  "daily-decisions": 300,
  study: 208,
  training: 336,
  focus: 188,
  coder: 268,
  inbox: 48,
  trader: 158,
  designer: 312,
  "ui-designer": 312,
};

export function CompanionCatalog({
  space,
  signedIn,
  initialDomain = "",
  onClose,
  onCreated,
  /** Family household: pick who this companion is for (parent or child seat). */
  assignMembers,
  defaultAssignMemberId,
}: {
  space: CompanionSpace;
  signedIn: boolean;
  initialDomain?: string;
  onClose: () => void;
  onCreated: (person: CompanionProfile) => void;
  assignMembers?: FamilyMemberPublic[];
  defaultAssignMemberId?: string | null;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const state = useCompanionState();
  useEnsureRealisticPortraits();
  const householdAssign = Boolean(assignMembers && assignMembers.length > 0);
  const [assignMemberId, setAssignMemberId] = useState(
    () => defaultAssignMemberId || assignMembers?.[0]?.id || "",
  );
  const assignMember =
    assignMembers?.find((m) => m.id === assignMemberId) ?? assignMembers?.[0] ?? null;

  const people = liveCompanions(state, space).filter((person) => {
    if (person.domain === "general") return false;
    if (!householdAssign || !assignMember) return true;
    return person.familyMemberId === assignMember.id;
  });
  const [view, setView] = useState<CatalogView>(() => (initialDomain.trim() ? "create" : "list"));
  const [selection, setSelection] = useState<CatalogSelection>(null);
  const [erpItems, setErpItems] = useState<ErpCompanion[]>([]);
  useEffect(() => {
    if (!signedIn) {
      setErpItems([]);
      return;
    }
    let cancelled = false;
    void arrabApi
      .erpCompanions()
      .then((res) => {
        if (!cancelled) {
          setErpItems(res.items.filter((item) => item.status === "published"));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ownedDomains = useMemo(
    () => new Set(people.map((person) => person.domain.toLowerCase())),
    [people],
  );
  const selectedPreset =
    selection?.kind === "preset"
      ? (COMPANION_PRESETS.find((preset) => preset.id === selection.id) ?? null)
      : null;
  const selectedOwnedFromPreset = selectedPreset
    ? people.find((person) => person.domain.toLowerCase() === selectedPreset.domain)
    : null;
  const selectedPerson =
    selection?.kind === "person"
      ? (people.find((person) => person.id === selection.id) ?? null)
      : null;
  const editingPerson = editingId
    ? (people.find((person) => person.id === editingId) ?? null)
    : null;
  const selectedErp =
    selection?.kind === "erp"
      ? (erpItems.find((item) => item.id === selection.id) ?? null)
      : null;
  const detailOpen = Boolean(selectedPreset || selectedPerson || selectedErp);

  function addFromErp(item: ErpCompanion) {
    if (!signedIn) return;
    const existing = people.find((person) => person.erpId === item.id);
    if (existing) {
      onCreated(existing);
      onClose();
      return;
    }
    const person = addCompanion({
      name: item.name,
      domain: item.slug || item.category || "custom",
      purposeId: "custom",
      brief: item.systemPrompt || item.description || item.tagline || null,
      space,
      tone: toneFromErp(item),
      avatarPhoto: item.avatar || null,
      familyMemberId: assignMember?.id ?? undefined,
      erpId: item.id,
      chatModel: item.model || null,
      temperature: item.temperature ?? null,
      maxTokens: item.maxTokens ?? null,
      greeting: item.greeting || null,
      seedTasks: false,
    });
    for (const note of item.knowledge ?? []) {
      const text = [note.title, note.content].filter(Boolean).join("\n").trim();
      if (!text) continue;
      addFact({
        companionId: person.id,
        text,
        source: "Arrab Control",
        space,
      });
    }
    onCreated(person);
    onClose();
  }

  function addFromPreset(preset: CompanionPreset) {
    if (!signedIn) return;
    const existing = people.find((person) => person.domain.toLowerCase() === preset.domain);
    if (existing) {
      onCreated(existing);
      onClose();
      return;
    }
    const person = addCompanion({
      name: ar ? preset.nameAr : preset.name,
      domain: preset.domain,
      purposeId: preset.purposeId,
      brief: ar ? preset.briefAr : preset.brief,
      connectors: preset.connectors,
      space,
      toneName: preset.toneName,
      faceSeed: presetPortraitSeed(preset.id),
      hue: PRESET_HUES[preset.id],
      familyMemberId: assignMember?.id ?? undefined,
    });
    onCreated(person);
    onClose();
  }

  function openPerson(person: CompanionProfile) {
    onCreated(person);
    onClose();
  }

  function startEdit(person: CompanionProfile) {
    setEditingId(person.id);
    setView("edit");
  }

  const assignPicker =
    householdAssign && assignMembers ? (
      <div className="cp-catalog-assign" role="group" aria-label={t("familyCatalogAssignFor")}>
        <div className="cp-catalog-assign-copy">
          <p className="cp-catalog-assign-kicker">{t("familyCatalogAssignFor")}</p>
          <p className="cp-catalog-assign-lead">
            {assignMember
              ? t("familyCatalogAssignPicked").replace("{name}", assignMember.displayName)
              : t("familyCatalogAssignPick")}
          </p>
        </div>
        <div className="cp-face-list cp-catalog-assign-faces">
          {assignMembers.map((member) => {
            const pressed = assignMember?.id === member.id;
            const age =
              member.ageTier === "tier_6_9"
                ? t("familyAgeShort69")
                : member.ageTier === "tier_10_13"
                  ? t("familyAgeShort1013")
                  : member.ageTier === "tier_14_17"
                    ? t("familyAgeShort1417")
                    : null;
            const meta =
              member.role === "child"
                ? age ?? t("familyRoleChild")
                : member.isOwner
                  ? t("familyOwner")
                  : member.role === "partner"
                    ? t("familyRolePartner")
                    : t("familyRoleParent");
            return (
              <button
                key={member.id}
                type="button"
                className="cp-face-choice"
                aria-pressed={pressed}
                onClick={() => {
                  setAssignMemberId(member.id);
                  setSelection(null);
                }}
              >
                <span
                  className={`cp-catalog-assign-disc${pressed ? " is-on" : ""}`}
                  style={{ background: member.color }}
                >
                  {member.displayName.slice(0, 1).toUpperCase()}
                </span>
                <strong>{member.displayName}</strong>
                <small>{meta}</small>
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  if (view === "create") {
    return (
      <div className="cp-ui cp-page cp-catalog-page cp-catalog-create-page">
        <CompanionPageHeader title={t("compCreateCustom")} subtitle={t("compCatalogSubtitle")}>
          <button
            type="button"
            className="cp-button"
            onClick={() => (initialDomain.trim() ? onClose() : setView("list"))}
          >
            {ar ? "رجوع" : "Back"}
          </button>
        </CompanionPageHeader>
        <div className="cp-catalog-page-body cp-catalog-create-body">
          {assignPicker}
          {signedIn ? (
            <CompanionEditorForm
              space={space}
              initialDomain={initialDomain}
              familyMemberId={assignMember?.id ?? null}
              onCancel={() => (initialDomain.trim() ? onClose() : setView("list"))}
              onSaved={(person) => {
                onCreated(person);
                onClose();
              }}
            />
          ) : (
            <div className="cp-catalog-guest">
              <p>{t("compSignInToManage")}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === "edit" && editingPerson) {
    return (
      <div className="cp-ui cp-page cp-catalog-page cp-catalog-create-page">
        <CompanionPageHeader
          title={ar ? `تعديل ${editingPerson.name}` : `Edit ${editingPerson.name}`}
          subtitle={t("compCatalogSubtitle")}
        >
          <button
            type="button"
            className="cp-button"
            onClick={() => {
              setView("list");
              setEditingId(null);
              setSelection({ kind: "person", id: editingPerson.id });
            }}
          >
            {ar ? "رجوع" : "Back"}
          </button>
        </CompanionPageHeader>
        <div className="cp-catalog-page-body cp-catalog-create-body">
          <CompanionEditorForm
            space={space}
            person={editingPerson}
            onCancel={() => {
              setView("list");
              setEditingId(null);
              setSelection({ kind: "person", id: editingPerson.id });
            }}
            onSaved={(person) => {
              setView("list");
              setEditingId(null);
              setSelection({ kind: "person", id: person.id });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cp-ui cp-page cp-catalog-page">
      <CompanionPageHeader
        title={householdAssign ? t("familyCatalogTitle") : t("compListTitle")}
        subtitle={householdAssign ? t("familyCatalogSubtitle") : t("compCatalogSubtitle")}
      >
        <button type="button" className="cp-button" onClick={onClose}>
          {ar ? "رجوع" : "Back"}
        </button>
      </CompanionPageHeader>

      <div className={`cp-catalog-page-body ${detailOpen ? "has-detail" : ""}`}>
        <div className="cp-catalog-main">
          {assignPicker}
          <div className="cp-catalog-circles" role="list">
            {COMPANION_PRESETS.map((preset) => {
              const owned = ownedDomains.has(preset.domain);
              const hue = PRESET_HUES[preset.id] ?? 220;
              const active = selection?.kind === "preset" && selection.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="listitem"
                  className={`cp-catalog-circle ${owned ? "is-owned" : ""} ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setSelection({ kind: "preset", id: preset.id })}
                >
                  <span className="cp-catalog-disc">
                    <PhotoAvatar
                      src={companionPortraitUrl({
                        seed: presetPortraitSeed(preset.id),
                        name: preset.name,
                        domain: preset.domain,
                        hue,
                        size: 256,
                      })}
                      name={preset.name}
                      size="lg"
                      state={active ? "lit" : owned ? "contributing" : "quiet"}
                      fallbackHue={hue}
                      fallbackSeed={presetPortraitSeed(preset.id)}
                    />
                  </span>
                  <strong>{ar ? preset.nameAr : preset.name}</strong>
                  <small>{owned ? (ar ? "مضاف" : "Added") : ar ? preset.blurbAr : preset.blurb}</small>
                </button>
              );
            })}

            {erpItems.map((item) => {
              const owned = people.some((person) => person.erpId === item.id);
              const active = selection?.kind === "erp" && selection.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={`cp-catalog-circle ${owned ? "is-owned" : ""} ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setSelection({ kind: "erp", id: item.id })}
                >
                  <span className="cp-catalog-disc">
                    <PhotoAvatar
                      src={
                        item.avatar ||
                        companionPortraitUrl({
                          seed: 17,
                          name: item.name,
                          domain: item.slug || "custom",
                          size: 256,
                        })
                      }
                      name={item.name}
                      size="lg"
                      state={active ? "lit" : owned ? "contributing" : "quiet"}
                    />
                  </span>
                  <strong>{item.name}</strong>
                  <small>{owned ? (ar ? "مضاف" : "Added") : item.tagline || item.category || ""}</small>
                </button>
              );
            })}

            {signedIn ? (
              <button
                type="button"
                className="cp-catalog-circle"
                onClick={() => setView("create")}
              >
                <span className="cp-catalog-disc cp-catalog-disc-add">
                  <Plus size={24} strokeWidth={1.5} />
                </span>
                <strong>{t("compCreateCustom")}</strong>
                <small>{ar ? "بغرض وموصلات" : "Purpose & connectors"}</small>
              </button>
            ) : null}
          </div>

          {people.length ? (
            <section className="cp-catalog-yours">
              <h3>{ar ? "رفاقك" : "Yours"}</h3>
              <div className="cp-catalog-circles">
                {people.map((person) => {
                  const active = selection?.kind === "person" && selection.id === person.id;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className={`cp-catalog-circle ${active ? "is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => setSelection({ kind: "person", id: person.id })}
                    >
                      <span className="cp-catalog-disc">
                        <PersonAvatar person={person} size="lg" />
                      </span>
                      <strong>{person.name}</strong>
                      <small>{person.domain}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        {selectedPerson ? (
          <aside className="cp-catalog-detail" aria-live="polite">
            <div className="cp-catalog-detail-head">
              <span className="cp-catalog-disc cp-catalog-disc-lg">
                <PersonAvatar person={selectedPerson} size="xl" />
              </span>
              <div>
                <h2>{selectedPerson.name}</h2>
                <p className="cp-muted">{selectedPerson.domain}</p>
              </div>
            </div>

            <div className="cp-catalog-detail-block">
              <h3>{t("compBrief")}</h3>
              <p>
                {companionDisplayBlurb(selectedPerson, locale) ||
                  (ar ? "لا مهمة مكتوبة بعد." : "No purpose written yet.")}
              </p>
            </div>

            <div className="cp-catalog-detail-block">
              <h3>{t("compTone")}</h3>
              <p>
                {t(
                  selectedPerson.toneName === "direct" ? "compBornDirect" : "compBornMeasured",
                )}
              </p>
            </div>

            {selectedPerson.connectors.length ? (
              <div className="cp-catalog-detail-block">
                <h3>{t("compConnectors")}</h3>
                <div className="cp-catalog-connector-chips">
                  {selectedPerson.connectors.map((id) => (
                    <span key={id} className="cp-catalog-chip is-static">
                      {connectorLabel(id, ar)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="cp-actions">
              <button
                type="button"
                className="cp-button cp-primary"
                onClick={() => openPerson(selectedPerson)}
              >
                {t("open")}
              </button>
              {signedIn ? (
                <button
                  type="button"
                  className="cp-button"
                  onClick={() => startEdit(selectedPerson)}
                >
                  <Pencil size={15} />
                  {t("edit")}
                </button>
              ) : null}
              <button type="button" className="cp-button" onClick={() => setSelection(null)}>
                {t("close")}
              </button>
            </div>
          </aside>
        ) : null}

        {selectedErp ? (
          <aside className="cp-catalog-detail" aria-live="polite">
            <div className="cp-catalog-detail-head">
              <span className="cp-catalog-disc cp-catalog-disc-lg">
                <PhotoAvatar
                  src={
                    selectedErp.avatar ||
                    companionPortraitUrl({
                      seed: 17,
                      name: selectedErp.name,
                      domain: selectedErp.slug || "custom",
                      size: 320,
                    })
                  }
                  name={selectedErp.name}
                  size="xl"
                  state="lit"
                />
              </span>
              <div>
                <h2>{selectedErp.name}</h2>
                <p className="cp-muted">{selectedErp.tagline || selectedErp.category || ""}</p>
              </div>
            </div>
            <div className="cp-catalog-detail-block">
              <h3>{t("compBrief")}</h3>
              <p>{selectedErp.description || selectedErp.tagline || selectedErp.name}</p>
            </div>
            <div className="cp-actions">
              <button
                type="button"
                className="cp-button cp-primary"
                onClick={() => addFromErp(selectedErp)}
              >
                {people.some((person) => person.erpId === selectedErp.id)
                  ? t("open")
                  : ar
                    ? "إضافة"
                    : "Add"}
              </button>
              <button type="button" className="cp-button" onClick={() => setSelection(null)}>
                {t("close")}
              </button>
            </div>
          </aside>
        ) : null}

        {selectedPreset ? (
          <aside className="cp-catalog-detail" aria-live="polite">
            <div className="cp-catalog-detail-head">
              <span className="cp-catalog-disc cp-catalog-disc-lg">
                <PhotoAvatar
                  src={companionPortraitUrl({
                    seed: presetPortraitSeed(selectedPreset.id),
                    name: selectedPreset.name,
                    domain: selectedPreset.domain,
                    hue: PRESET_HUES[selectedPreset.id] ?? 220,
                    size: 320,
                  })}
                  name={selectedPreset.name}
                  size="xl"
                  state="lit"
                  fallbackHue={PRESET_HUES[selectedPreset.id] ?? 220}
                  fallbackSeed={presetPortraitSeed(selectedPreset.id)}
                />
              </span>
              <div>
                <h2>{ar ? selectedPreset.nameAr : selectedPreset.name}</h2>
                <p className="cp-muted">{ar ? selectedPreset.blurbAr : selectedPreset.blurb}</p>
              </div>
            </div>

            <div className="cp-catalog-detail-block">
              <h3>{t("compBrief")}</h3>
              <p>{ar ? selectedPreset.briefAr : selectedPreset.brief}</p>
            </div>

            <div className="cp-catalog-detail-block">
              <h3>{t("compTone")}</h3>
              <p>
                {t(
                  selectedPreset.toneName === "direct" ? "compBornDirect" : "compBornMeasured",
                )}
              </p>
            </div>

            {selectedPreset.connectors.length ? (
              <div className="cp-catalog-detail-block">
                <h3>{t("compConnectors")}</h3>
                <div className="cp-catalog-connector-chips">
                  {selectedPreset.connectors.map((id) => (
                    <span key={id} className="cp-catalog-chip is-static">
                      {connectorLabel(id, ar)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="cp-actions">
              {selectedOwnedFromPreset ? (
                <>
                  <button
                    type="button"
                    className="cp-button cp-primary"
                    onClick={() => openPerson(selectedOwnedFromPreset)}
                  >
                    {t("open")}
                  </button>
                  {signedIn ? (
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() => startEdit(selectedOwnedFromPreset)}
                    >
                      <Pencil size={15} />
                      {t("edit")}
                    </button>
                  ) : null}
                </>
              ) : signedIn ? (
                <button
                  type="button"
                  className="cp-button cp-primary"
                  onClick={() => addFromPreset(selectedPreset)}
                >
                  <Plus size={15} />
                  {t("compAddCompanion")}
                </button>
              ) : (
                <p className="cp-muted">{t("compSignInToManage")}</p>
              )}
              <button type="button" className="cp-button" onClick={() => setSelection(null)}>
                {t("close")}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function CompanionEditorForm({
  space,
  initialDomain = "",
  person,
  familyMemberId = null,
  onCancel,
  onSaved,
}: {
  space: CompanionSpace;
  initialDomain?: string;
  person?: CompanionProfile;
  familyMemberId?: string | null;
  onCancel: () => void;
  onSaved: (person: CompanionProfile) => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const editing = Boolean(person);
  const [domain, setDomain] = useState(person?.domain ?? initialDomain);
  const [name, setName] = useState(person?.name ?? "");
  const [brief, setBrief] = useState(person?.brief ?? "");
  const [tone, setTone] = useState<CompanionToneName>(person?.toneName ?? "measured");
  const [connectors, setConnectors] = useState<string[]>(() => {
    if (person) return [...person.connectors];
    const match = COMPANION_PRESETS.find(
      (preset) => preset.domain.toLowerCase() === initialDomain.trim().toLowerCase(),
    );
    return match?.connectors ?? [];
  });
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [catalogProviders, setCatalogProviders] = useState<string[]>(() =>
    resolveConnectorProviders([]),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/api")
      .then(({ arrabApi }) =>
        Promise.all([arrabApi.connectorCatalog(), arrabApi.connectors()]),
      )
      .then(([catalog, linked]) => {
        if (cancelled) return;
        setCatalogProviders(resolveConnectorProviders(catalog.items ?? []));
        setConnected(
          new Set(
            linked.items
              .filter((item) => item.status === "connected")
              .map((item) => item.provider),
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setCatalogProviders(resolveConnectorProviders([]));
        setConnected(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleConnector(id: string) {
    setConnectors((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <form
      className="cp-catalog-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!domain.trim() || !brief.trim()) return;
        if (editing && person) {
          const nextName = name.trim() || domain.trim();
          setSaving(true);
          updateCompanion(person.id, {
            name: nextName,
            domain: domain.trim(),
            brief: brief.trim(),
            connectors,
            toneName: tone,
            tone: { ...TONE_PRESETS[tone] },
          });
          void syncCompanionMemory().catch(() => {
            /* local save already applied; sync can retry from details later */
          });
          setSaving(false);
          onSaved({
            ...person,
            name: nextName,
            domain: domain.trim(),
            brief: brief.trim(),
            connectors,
            toneName: tone,
            tone: { ...TONE_PRESETS[tone] },
          });
          return;
        }
        const created = addCompanion({
          name: name.trim() || domain.trim(),
          domain: domain.trim(),
          purposeId: domain.trim().toLowerCase(),
          brief: brief.trim(),
          connectors,
          space,
          toneName: tone,
          familyMemberId: familyMemberId ?? undefined,
        });
        onSaved(created);
      }}
    >
      <p className="cp-muted cp-catalog-form-lead">
        {editing
          ? ar
            ? "عدّل الاسم والمهمة والنبرة والموصلات لهذا الرفيق."
            : "Change this companion’s name, purpose, tone, and connectors."
          : ar
            ? "حدّد ما يتابعه، ومهمته، والموصلات التي يعتمد عليها، ثم اختر الأسلوب."
            : "Define what they watch, their purpose, which connectors they use, then choose a voice."}
      </p>

      <div className="cp-catalog-form-grid">
        <div className="cp-catalog-form-main cp-stack">
          <label className="cp-label">
            {t("compWatches")}
            <input
              autoFocus={!editing}
              required
              className="cp-input"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder={ar ? "مثل: العمل، الدراسة، النوم" : "e.g. work, study, sleep"}
            />
          </label>
          <label className="cp-label">
            {editing ? (ar ? "الاسم" : "Name") : t("compNameOptional")}
            <input
              autoFocus={editing}
              className="cp-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required={editing}
            />
          </label>
          <label className="cp-label">
            {t("compBrief")}
            <textarea
              required
              className="cp-input cp-catalog-purpose"
              rows={6}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("compBriefPlaceholder")}
            />
            <span className="cp-field-hint">{t("compBriefHint")}</span>
          </label>

          <div className="cp-tone-options">
            {(["direct", "measured"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={tone === option}
                onClick={() => setTone(option)}
              >
                <strong>{t(option === "direct" ? "compBornDirect" : "compBornMeasured")}</strong>
                <p>{t(option === "direct" ? "compBornDirectExample" : "compBornMeasuredExample")}</p>
                {tone === option ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </div>

        <aside className="cp-catalog-connectors-panel" aria-label={t("compConnectors")}>
          <h3>{t("compConnectors")}</h3>
          <p className="cp-field-hint">{t("compConnectorsHint")}</p>
          <div className="cp-catalog-connector-grid">
            {catalogProviders.map((provider) => {
              const on = connectors.includes(provider);
              const live = connected.has(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  className={`cp-catalog-connector ${on ? "is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleConnector(provider)}
                >
                  <span className={`connector-brand brand-${provider}`}>
                    <ConnectorBrandIcon provider={provider} size={18} />
                  </span>
                  <span className="cp-catalog-connector-copy">
                    <strong>{connectorLabel(provider, ar)}</strong>
                    <small>{live ? (ar ? "متصل" : "Connected") : t("compNotConnected")}</small>
                  </span>
                  {on ? <Check size={15} className="cp-catalog-connector-check" /> : null}
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <div className="cp-actions cp-end">
        <button className="cp-button" type="button" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </button>
        <button
          className="cp-button cp-primary"
          disabled={!domain.trim() || !brief.trim() || (editing && !name.trim()) || saving}
        >
          {editing ? t("save") : t("compAddCompanion")}
          {editing ? null : <Plus size={15} />}
        </button>
      </div>
    </form>
  );
}
