import { useRef, useState } from "react";
import { Cable, ImageUp, Settings2, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { forgetEverything, updateCompanion, useCompanionState } from "@/lib/companions";
import { AvatarImageError, fileToAvatarDataUrl } from "@/lib/avatar-image";
import { setProfilePhoto, useProfilePhoto } from "@/lib/profile-photo";
import {
  CompanionPageHeader,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/components/companions/CompanionUI";
import { ExportMemories, MemoryDetails } from "@/components/companions/CompanionDetails";

export function CompanionMePage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href } = useRole();
  const { account } = useSignedInAccount();
  const state = useCompanionState();
  const [space, setSpace] = useCompanionSpace();
  const folded = state.companions.filter((person) => person.archivedAt && person.space === space);
  const photo = useProfilePhoto();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState("");
  async function pickPhoto(file: File) {
    setPhotoError("");
    try {
      setProfilePhoto(await fileToAvatarDataUrl(file));
    } catch (err) {
      setPhotoError(
        err instanceof AvatarImageError && err.message === "too-large"
          ? ar
            ? "الصورة كبيرة جدًا. اختر صورة أصغر من 20 ميجابايت."
            : "That image is too large — pick one under 20MB."
          : ar
            ? "تعذّرت قراءة هذه الصورة. جرّب صورة أخرى."
            : "Couldn't read that image — try a different one.",
      );
    }
  }
  return (
    <div className="cp-ui cp-page">
      <CompanionPageHeader
        title={ar ? "أنا" : "Me"}
        subtitle={
          ar
            ? "ما يتذكره رفاقك، وما تسمح لهم بمعرفته."
            : "What your companions remember, and what you let them know."
        }
      >
        <SpaceSwitch value={space} onChange={setSpace} />
      </CompanionPageHeader>
      <div className="cp-me-grid">
        <section className="cp-card">
          <div className="cp-section-heading">
            <h2>{t("compKnows")}</h2>
          </div>
          <MemoryDetails space={space} />
        </section>
        <aside className="cp-stack">
          <div className="cp-card cp-profile">
            <div className="cp-profile-head">
              <span className="cp-profile-icon">
                {photo ? (
                  <img src={photo} alt="" className="cp-profile-photo" />
                ) : (
                  <UserRound size={23} />
                )}
              </span>
              <div className="cp-profile-name">
                <h2>{account?.displayName || t("compGeneral")}</h2>
                <p className="cp-muted">{account?.email}</p>
              </div>
            </div>
            <div className="cp-actions cp-profile-actions">
              <button type="button" className="cp-text-button" onClick={() => fileInputRef.current?.click()}>
                <ImageUp size={13} />
                {ar ? "رفع صورة" : "Upload photo"}
              </button>
              {photo ? (
                <button type="button" className="cp-text-button" onClick={() => setProfilePhoto(null)}>
                  <X size={13} />
                  {ar ? "إزالة" : "Remove"}
                </button>
              ) : null}
            </div>
            {photoError ? (
              <p role="alert" className="cp-notice">
                {photoError}
              </p>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="cp-sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickPhoto(file);
              }}
            />
            <Link className="cp-button" to={href("/account")}>
              {t("amTitle")}
            </Link>
          </div>
          <div className="cp-card cp-stack">
            <h2>{t("compPermissions")}</h2>
            <p className="cp-muted">
              {ar
                ? "راجع مصادر البيانات وغيّر وصولها من الاتصالات."
                : "Review data sources and manage access in Connections."}
            </p>
            {account ? (
              <Link className="cp-button" to={href("/connectors")}>
                <Cable size={16} />
                {t("connectors")}
              </Link>
            ) : null}
            <Link className="cp-button" to={href("/settings")}>
              <Settings2 size={16} />
              {t("settings")}
            </Link>
            <ExportMemories />
          </div>
          {folded.length ? (
            <div className="cp-card cp-stack">
              <h2>{ar ? "رفاق مطويّون" : "Folded companions"}</h2>
              {folded.map((person) => (
                <div className="cp-folded" key={person.id}>
                  <PersonAvatar person={person} size="sm" />
                  <span>{person.name}</span>
                  <button
                    className="cp-text-button"
                    onClick={() => updateCompanion(person.id, { archivedAt: null })}
                  >
                    {t("compUnarchive")}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <details className="cp-data-controls">
            <summary>{ar ? "بيانات هذا الجهاز" : "Data on this device"}</summary>
            <p className="cp-muted">
              {ar
                ? "الذاكرة والمهام والملفات محفوظة على هذا الجهاز. المحادثات محفوظة في حساب Arrab."
                : "Memories, tasks and threads are stored on this device. Conversations are stored in your Arrab account."}
            </p>
            <button
              className="cp-text-button cp-delete"
              onClick={() => {
                if (window.confirm(t("compForgetConfirm"))) forgetEverything();
              }}
            >
              {t("compForget")}
            </button>
          </details>
        </aside>
      </div>
    </div>
  );
}
