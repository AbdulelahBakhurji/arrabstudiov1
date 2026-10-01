import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Aperture,
  Axis3d,
  Camera,
  Grid3x3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Shapes,
  X,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import {
  type ModelCameraKind,
  type ModelPreviewQuality,
  type ModelShadingMode,
} from "@/domains/studio/studio-model-preview";
import { cn } from "@/shared/lib/utils";

type Model3DStageProps = {
  html: string;
  empty?: boolean;
};

type ModelStats = {
  fps: number | null;
  objects: number | null;
  faces: number | null;
  verts: number | null;
  shading: string | null;
};

export function Model3DStage({ html, empty = false }: Model3DStageProps) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [quality, setQuality] = useState<ModelPreviewQuality>("high");
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [shading, setShading] = useState<ModelShadingMode>("material");
  const [cameraKind, setCameraKind] = useState<ModelCameraKind>("persp");
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [stats, setStats] = useState<ModelStats>({
    fps: null,
    objects: null,
    faces: null,
    verts: null,
    shading: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  const blank = empty || !html.trim();

  const srcDoc = useMemo(() => {
    if (blank) return "";
    return html;
  }, [blank, html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        fps?: number;
        objects?: number;
        faces?: number;
        verts?: number;
        shading?: string;
      } | null;
      if (!data || data.type !== "arrab-model-stats") return;
      setStats({
        fps: typeof data.fps === "number" ? data.fps : null,
        objects: typeof data.objects === "number" ? data.objects : null,
        faces: typeof data.faces === "number" ? data.faces : null,
        verts: typeof data.verts === "number" ? data.verts : null,
        shading: typeof data.shading === "string" ? data.shading : null,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const pushControls = () => {
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "arrab-model-control",
        payload: {
          quality,
          showGrid,
          showAxes,
          shading,
          cameraKind,
          paused,
        },
      },
      "*",
    );
  };

  useEffect(() => {
    if (blank) return;
    pushControls();
  }, [quality, showAxes, showGrid, shading, cameraKind, paused, reloadKey, fullscreen, blank]);

  const resetView = () => {
    setReloadKey((value) => value + 1);
    setStats({ fps: null, objects: null, faces: null, verts: null, shading: null });
    setPaused(false);
  };

  if (blank) {
    const blankStage = (
      <div className={cn("st-model-stage st-game-blank", fullscreen && "is-fullscreen")} dir={ar ? "rtl" : "ltr"}>
        <div className="st-preview-empty">
          <div className="st-preview-empty-glow" aria-hidden="true" />
          <Shapes size={28} />
          <h3>{t("studioEmptyPreview")}</h3>
          <p>{t("studioEmptyPreviewHint")}</p>
        </div>
      </div>
    );
    if (fullscreen) {
      return createPortal(
        <div className="st-model-fullscreen-portal" role="dialog" aria-modal="true" aria-label={t("studioModelPreview")}>
          {blankStage}
        </div>,
        document.body,
      );
    }
    return blankStage;
  }

  const stage = (
    <div className={cn("st-model-stage", fullscreen && "is-fullscreen")} dir={ar ? "rtl" : "ltr"}>
      <div className="st-model-toolbar">
        <div className="st-model-toolbar-lead">
          <Shapes size={14} />
          <strong>{t("studioModelPreview")}</strong>
          <span className="st-model-pill">Advanced · WebGL</span>
          {fullscreen ? <span className="st-model-pill is-live">{t("studioModelFullscreenLive")}</span> : null}
          {stats.fps != null ? <span className="st-model-stat">{stats.fps} FPS</span> : null}
          {stats.faces != null ? (
            <span className="st-model-stat">
              {stats.faces} {ar ? "وجه" : "faces"}
              {stats.verts != null ? ` · ${stats.verts}v` : ""}
            </span>
          ) : null}
        </div>
        <div className="st-model-toolbar-actions">
          <label className="st-model-quality">
            <span>{t("studioModelQuality")}</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value as ModelPreviewQuality)}>
              <option value="high">{t("studioModelQualityHigh")}</option>
              <option value="balanced">{t("studioModelQualityBalanced")}</option>
              <option value="performance">{t("studioModelQualityPerf")}</option>
            </select>
          </label>
          <label className="st-model-quality">
            <Aperture size={13} />
            <select
              value={shading}
              onChange={(event) => setShading(event.target.value as ModelShadingMode)}
              title={t("studioModelShading")}
            >
              <option value="solid">{t("studioModelSolid")}</option>
              <option value="wire">{t("studioModelWire")}</option>
              <option value="material">{t("studioModelMaterial")}</option>
              <option value="rendered">{t("studioModelRendered")}</option>
            </select>
          </label>
          <label className="st-model-quality">
            <Camera size={13} />
            <select
              value={cameraKind}
              onChange={(event) => setCameraKind(event.target.value as ModelCameraKind)}
              title={t("studioModelCamera")}
            >
              <option value="persp">{t("studioModelPersp")}</option>
              <option value="ortho">{t("studioModelOrtho")}</option>
            </select>
          </label>
          <button
            type="button"
            className={cn("st-model-toggle", showGrid && "is-on")}
            onClick={() => setShowGrid((value) => !value)}
            title={t("studioModelGrid")}
          >
            <Grid3x3 size={14} />
            <span>{t("studioModelGrid")}</span>
          </button>
          <button
            type="button"
            className={cn("st-model-toggle", showAxes && "is-on")}
            onClick={() => setShowAxes((value) => !value)}
            title={t("studioModelAxes")}
          >
            <Axis3d size={14} />
            <span>{t("studioModelAxes")}</span>
          </button>
          <button
            type="button"
            className={cn("st-model-toggle", paused && "is-on")}
            onClick={() => setPaused((value) => !value)}
            title={paused ? t("studioModelResume") : t("studioModelPause")}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            <span>{paused ? t("studioModelResume") : t("studioModelPause")}</span>
          </button>
          <button type="button" className="st-model-toggle" onClick={resetView} title={t("studioModelReset")}>
            <RotateCcw size={14} />
            <span>{t("studioModelReset")}</span>
          </button>
          <button
            type="button"
            className={cn("st-model-toggle", fullscreen && "is-on")}
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? t("studioModelExitFullscreen") : t("studioModelFullscreen")}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{fullscreen ? t("studioModelExitFullscreen") : t("studioModelFullscreen")}</span>
          </button>
          {fullscreen ? (
            <button
              type="button"
              className="st-model-toggle is-close"
              onClick={() => setFullscreen(false)}
              aria-label={t("studioModelExitFullscreen")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="st-model-viewport">
        <div className="st-model-vignette" aria-hidden />
        <iframe
          key={`${reloadKey}-${fullscreen ? "fs" : "in"}`}
          ref={frameRef}
          title={t("studioModelPreview")}
          className="st-model-frame"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={srcDoc}
          onLoad={pushControls}
        />
        <div className="st-model-hint-bar">
          <span>{t("studioModelControlsHint")}</span>
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="st-model-fullscreen-portal" role="dialog" aria-modal="true" aria-label={t("studioModelPreview")}>
        {stage}
      </div>,
      document.body,
    );
  }

  return stage;
}
