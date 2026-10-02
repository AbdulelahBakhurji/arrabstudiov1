import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Axis3d,
  Box,
  Camera,
  Grid3x3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Wand2,
  X,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import {
  type GameCameraMode,
  type GamePreviewQuality,
  type GameTimeOfDay,
} from "@/domains/studio/studio-game-preview";
import { cn } from "@/shared/lib/utils";

type Game3DStageProps = {
  html: string;
  empty?: boolean;
  /** Non-browser projects (e.g. Roblox) — show file-oriented blank state. */
  projectKind?: "webgl" | "roblox" | "blank";
};

type GameStats = {
  fps: number | null;
  objects: number | null;
  triangles: number | null;
  score: number | null;
  collected: number | null;
  total: number | null;
};

export function Game3DStage({
  html,
  empty = false,
  projectKind = "webgl",
}: Game3DStageProps) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [quality, setQuality] = useState<GamePreviewQuality>("high");
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [postFx, setPostFx] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cameraMode, setCameraMode] = useState<GameCameraMode>("follow");
  const [timeOfDay, setTimeOfDay] = useState<GameTimeOfDay>("dusk");
  const [fullscreen, setFullscreen] = useState(false);
  const [stats, setStats] = useState<GameStats>({
    fps: null,
    objects: null,
    triangles: null,
    score: null,
    collected: null,
    total: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  const blank = empty || projectKind === "blank" || !html.trim();
  const roblox = projectKind === "roblox";

  const srcDoc = useMemo(() => {
    if (blank || roblox) return "";
    return html;
  }, [blank, html, roblox]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        fps?: number;
        objects?: number;
        triangles?: number;
        score?: number;
        collected?: number;
        total?: number;
      } | null;
      // Only the preview frame we created may report stats.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!data || data.type !== "arrab-game-stats") return;
      setStats({
        fps: typeof data.fps === "number" ? data.fps : null,
        objects: typeof data.objects === "number" ? data.objects : null,
        triangles: typeof data.triangles === "number" ? data.triangles : null,
        score: typeof data.score === "number" ? data.score : null,
        collected: typeof data.collected === "number" ? data.collected : null,
        total: typeof data.total === "number" ? data.total : null,
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
        type: "arrab-game-control",
        payload: {
          quality,
          showGrid,
          showAxes,
          wireframe,
          postFx,
          paused,
          cameraMode,
          timeOfDay,
        },
      },
      "*",
    );
  };

  useEffect(() => {
    if (blank || roblox) return;
    pushControls();
  }, [quality, showAxes, showGrid, wireframe, postFx, paused, cameraMode, timeOfDay, reloadKey, fullscreen, blank, roblox]);

  const resetRun = () => {
    setReloadKey((value) => value + 1);
    setStats({
      fps: null,
      objects: null,
      triangles: null,
      score: null,
      collected: null,
      total: null,
    });
    setPaused(false);
  };

  if (blank || roblox) {
    const blankStage = (
      <div className={cn("st-game-stage st-game-blank", fullscreen && "is-fullscreen")} dir={ar ? "rtl" : "ltr"}>
        <div className="st-preview-empty">
          <div className="st-preview-empty-glow" aria-hidden="true" />
          <Sparkles size={28} />
          <h3>{roblox ? t("studioGameRobloxTitle") : t("studioGameBlankTitle")}</h3>
          <p>{roblox ? t("studioGameRobloxHint") : t("studioGameBlankHint")}</p>
        </div>
      </div>
    );
    if (fullscreen) {
      return createPortal(
        <div className="st-game-fullscreen-portal" role="dialog" aria-modal="true" aria-label={t("studioGamePreview")}>
          {blankStage}
        </div>,
        document.body,
      );
    }
    return blankStage;
  }

  const stage = (
    <div className={cn("st-game-stage", fullscreen && "is-fullscreen")} dir={ar ? "rtl" : "ltr"}>
      <div className="st-game-toolbar">
        <div className="st-game-toolbar-lead">
          <Sparkles size={14} />
          <strong>{t("studioGamePreview")}</strong>
          <span className="st-game-pill">WebGL · Three.js · Bloom</span>
          {fullscreen ? <span className="st-game-pill is-live">{t("studioGameFullscreenLive")}</span> : null}
          {stats.fps != null ? <span className="st-game-stat">{stats.fps} FPS</span> : null}
          {stats.triangles != null ? (
            <span className="st-game-stat">
              {(stats.triangles / 1000).toFixed(1)}k {ar ? "مثلث" : "tri"}
            </span>
          ) : stats.objects != null ? (
            <span className="st-game-stat">
              {stats.objects} {ar ? "عنصر" : "objs"}
            </span>
          ) : null}
          {stats.score != null ? (
            <span className="st-game-stat is-score">
              {stats.score}
              {stats.total != null ? ` · ${stats.collected ?? 0}/${stats.total}` : ""}
            </span>
          ) : null}
        </div>
        <div className="st-game-toolbar-actions">
          <label className="st-game-quality">
            <span>{t("studioGameQuality")}</span>
            <select
              value={quality}
              onChange={(event) => setQuality(event.target.value as GamePreviewQuality)}
            >
              <option value="high">{t("studioGameQualityHigh")}</option>
              <option value="balanced">{t("studioGameQualityBalanced")}</option>
              <option value="performance">{t("studioGameQualityPerf")}</option>
            </select>
          </label>
          <label className="st-game-quality">
            <Camera size={13} />
            <select
              value={cameraMode}
              onChange={(event) => setCameraMode(event.target.value as GameCameraMode)}
              title={t("studioGameCamera")}
            >
              <option value="follow">{t("studioGameCamFollow")}</option>
              <option value="chase">{t("studioGameCamChase")}</option>
              <option value="orbit">{t("studioGameCamOrbit")}</option>
            </select>
          </label>
          <label className="st-game-quality">
            <Sun size={13} />
            <select
              value={timeOfDay}
              onChange={(event) => setTimeOfDay(event.target.value as GameTimeOfDay)}
              title={t("studioGameTime")}
            >
              <option value="dawn">{t("studioGameDawn")}</option>
              <option value="noon">{t("studioGameNoon")}</option>
              <option value="dusk">{t("studioGameDusk")}</option>
              <option value="night">{t("studioGameNight")}</option>
            </select>
          </label>
          <button
            type="button"
            className={cn("st-game-toggle", postFx && "is-on")}
            onClick={() => setPostFx((value) => !value)}
            title={t("studioGameBloom")}
          >
            <Wand2 size={14} />
            <span>{t("studioGameBloom")}</span>
          </button>
          <button
            type="button"
            className={cn("st-game-toggle", showGrid && "is-on")}
            onClick={() => setShowGrid((value) => !value)}
            title={t("studioGameGrid")}
          >
            <Grid3x3 size={14} />
            <span>{t("studioGameGrid")}</span>
          </button>
          <button
            type="button"
            className={cn("st-game-toggle", showAxes && "is-on")}
            onClick={() => setShowAxes((value) => !value)}
            title={t("studioGameAxes")}
          >
            <Axis3d size={14} />
            <span>{t("studioGameAxes")}</span>
          </button>
          <button
            type="button"
            className={cn("st-game-toggle", wireframe && "is-on")}
            onClick={() => setWireframe((value) => !value)}
            title={t("studioGameWireframe")}
          >
            <Box size={14} />
            <span>{t("studioGameWireframe")}</span>
          </button>
          <button
            type="button"
            className={cn("st-game-toggle", paused && "is-on")}
            onClick={() => setPaused((value) => !value)}
            title={paused ? t("studioGameResume") : t("studioGamePause")}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            <span>{paused ? t("studioGameResume") : t("studioGamePause")}</span>
          </button>
          <button type="button" className="st-game-toggle" onClick={resetRun} title={t("studioGameReset")}>
            <RotateCcw size={14} />
            <span>{t("studioGameReset")}</span>
          </button>
          <button
            type="button"
            className={cn("st-game-toggle", fullscreen && "is-on")}
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? t("studioGameExitFullscreen") : t("studioGameFullscreen")}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{fullscreen ? t("studioGameExitFullscreen") : t("studioGameFullscreen")}</span>
          </button>
          {fullscreen ? (
            <button
              type="button"
              className="st-game-toggle is-close"
              onClick={() => setFullscreen(false)}
              aria-label={t("studioGameExitFullscreen")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="st-game-viewport">
        <div className="st-game-vignette" aria-hidden />
        <iframe
          key={`${reloadKey}-${fullscreen ? "fs" : "in"}`}
          ref={frameRef}
          title={t("studioGamePreview")}
          className="st-game-frame"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          onLoad={pushControls}
        />
        <div className="st-game-hint-bar" dir={ar ? "rtl" : "ltr"}>
          <span>{t("studioGameControlsHint")}</span>
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="st-game-fullscreen-portal" role="dialog" aria-modal="true" aria-label={t("studioGamePreview")}>
        {stage}
      </div>,
      document.body,
    );
  }

  return stage;
}
