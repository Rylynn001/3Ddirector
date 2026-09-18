import {
  MapPinPlus,
  Package,
  Pause,
  PersonStanding,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_CAMERA_MOTION_PATH, getCameraMotionPath, getCameraMotionTimingPlan } from "../schema/cameraMotion";
import { getObjectMotionTimingPlan, normalizeObjectMotionPath } from "../schema/objectMotion";
import type { RouteTimingPlan } from "../schema/routeTiming";
import { DEFAULT_FPS, DEFAULT_TOTAL_FRAMES, formatFrame, frameToProgress, progressToFrame } from "../schema/frameTime";
import { useDirectorStore } from "../store/directorStore";
import "./objectMotionTransport.css";
import { CurveEditor } from "./CurveEditor";

const CURRENT_KEYFRAME_TOLERANCE = 0.005;

export function getRulerTicks(startFrame: number, endFrame: number) {
  const start = Math.min(startFrame, endFrame);
  const end = Math.max(startFrame, endFrame);
  const span = Math.max(1, end - start);
  const targetLabelCount = 14;
  const roughStep = span / (targetLabelCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const niceMultiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const majorStep = niceMultiplier * magnitude;
  const minorStep = Math.max(1, majorStep / (majorStep >= 5 ? 5 : 2));
  const frames = new Set<number>([start, end]);

  for (let frame = Math.ceil(start / minorStep) * minorStep; frame <= end; frame += minorStep) {
    frames.add(Math.round(frame));
  }

  return [...frames]
    .sort((left, right) => left - right)
    .map((frame) => ({ frame, major: frame === start || frame === end || frame % majorStep === 0 }));
}

function getRouteSpans(times: number[], plan: RouteTimingPlan | null) {
  const arrivals = plan?.arrivals ?? times;
  const departures = plan?.departures ?? times;
  return {
    arrivals,
    holds: arrivals.slice(0, -1).flatMap((arrival, index) => {
      const departure = departures[index] ?? arrival;
      return departure - arrival > 0.0001 ? [{ end: departure, index, start: arrival }] : [];
    }),
    moves: arrivals.slice(1).map((arrival, index) => ({
      end: arrival,
      index,
      start: departures[index] ?? arrivals[index],
    })),
  };
}

function getRoutePlaybackStatus(
  spans: ReturnType<typeof getRouteSpans> | null,
  progress: number,
) {
  if (!spans) return "无路线";
  if (spans.holds.some((span) => progress >= span.start && progress < span.end)) return "停留中";
  if (spans.moves.some((span) => progress >= span.start && progress < span.end)) return "移动中";
  const lastArrival = spans.arrivals[spans.arrivals.length - 1] ?? 0;
  if (progress >= lastArrival - CURRENT_KEYFRAME_TOLERANCE) return "已结束";
  return progress <= CURRENT_KEYFRAME_TOLERANCE ? "等待" : "已到点";
}

/**
 * A shared transport for all character and prop animation.
 *
 * Object motion and camera motion intentionally use the same normalized
 * progress value so a director can pause the cast, adjust the shot, and
 * continue without losing sync.
 */
export function ObjectMotionTransport({ onRecordCamera }: { onRecordCamera?: (cameraId: string) => void } = {}) {
  const [curveEditorOpen, setCurveEditorOpen] = useState(false);
  const curveEditorButton = <button className="curve-editor-trigger" type="button" onClick={() => setCurveEditorOpen(true)}>曲线编辑器</button>;
  const progress = useDirectorStore((state) => state.cameraMotionProgress);
  const playing = useDirectorStore((state) => state.cameraMotionPlaying);
  const pilotMode = useDirectorStore((state) => state.cameraPilotMode);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const objects = useDirectorStore((state) => state.project.objects);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const viewportCameraId = useDirectorStore((state) => state.viewMode === "camera" ? state.viewportCameraId : null);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((camera) => camera.id === state.project.activeCameraId)
      ?? state.project.cameras[0]
  );
  const addObjectMotionKeyframe = useDirectorStore((state) => state.addObjectMotionKeyframe);
  const deleteObjectMotionKeyframe = useDirectorStore((state) => state.deleteObjectMotionKeyframe);
  const deleteCameraMotionKeyframe = useDirectorStore((state) => state.deleteCameraMotionKeyframe);
  const selectObjectMotionKeyframe = useDirectorStore((state) => state.selectObjectMotionKeyframe);
  const selectedCameraKeyframeId = useDirectorStore((state) => state.selectedCameraKeyframeId);
  const selectCameraMotionKeyframe = useDirectorStore((state) => state.selectCameraMotionKeyframe);
  const updateCameraMotionPath = useDirectorStore((state) => state.updateCameraMotionPath);
  const setProgress = useDirectorStore((state) => state.setCameraMotionProgress);
  const setPlaying = useDirectorStore((state) => state.setCameraMotionPlaying);
  const restartPlayback = useDirectorStore((state) => state.restartCameraMotionPlayback);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);
  const updateTotalFrames = useDirectorStore((state) => state.updateTotalFrames);
  const updateFps = useDirectorStore((state) => state.updateFps);

  const fps = useDirectorStore((state) => state.project.fps ?? DEFAULT_FPS);
  const totalFrames = useDirectorStore((state) => state.project.totalFrames ?? DEFAULT_TOTAL_FRAMES);
  const currentFrame = progressToFrame(progress, totalFrames);
  const duration = activeCamera
    ? getCameraMotionPath(activeCamera).duration
    : DEFAULT_CAMERA_MOTION_PATH.duration;
  const [rulerStartFrame, setRulerStartFrame] = useState(0);
  const [rulerEndFrame, setRulerEndFrame] = useState(totalFrames);

  useEffect(() => {
    setRulerStartFrame((value) => Math.min(Math.max(0, value), Math.max(0, totalFrames - 1)));
    setRulerEndFrame((value) => Math.max(1, Math.min(totalFrames, value)));
  }, [totalFrames]);
  const isPiloting = pilotMode !== "idle";
  const selectedObject = objects.find(
    (object) => object.id === selectedObjectId && object.kind !== "camera" && object.kind !== "panorama"
  );
  const selectedSceneObject = objects.find((object) => object.id === selectedObjectId);
  const recordingCamera = cameras.find((camera) => camera.id === (viewportCameraId ?? selectedSceneObject?.linkedCameraId));
  const showCameraTimeline = selectedSceneObject?.kind === "camera" || !selectedSceneObject;
  const showObjectTimeline = Boolean(selectedObject);
  const selectedMotionPath = selectedObject
    ? normalizeObjectMotionPath(selectedObject.motionPath, selectedObject.transform)
    : null;
  const keyframes = selectedMotionPath?.keyframes ?? [];
  const cameraPath = activeCamera ? getCameraMotionPath(activeCamera) : null;
  const cameraSpans = cameraPath
    ? getRouteSpans(cameraPath.keyframes.map((keyframe) => keyframe.time), getCameraMotionTimingPlan(activeCamera))
    : null;
  const objectTimingPlan = selectedObject ? getObjectMotionTimingPlan(selectedObject, duration) : null;
  const objectSpans = selectedMotionPath
    ? getRouteSpans(selectedMotionPath.keyframes.map((keyframe) => keyframe.time), objectTimingPlan)
    : null;
  const hasPlayableObjectMotion =
    cameras.some((camera) => (camera.motionPath?.keyframes.length ?? 0) >= 2)
    || objects.some(
      (object) => (object.motionPath?.keyframes?.length ?? 0) >= 2 || Boolean(object.characterRig?.actionPresetId)
    );
  const currentKeyframe = keyframes.find((keyframe, index) =>
    Math.abs((objectSpans?.arrivals[index] ?? keyframe.time) - progress) <= CURRENT_KEYFRAME_TOLERANCE
  );
  const isAtStart = progress <= CURRENT_KEYFRAME_TOLERANCE;
  const isCharacterRoute = selectedObject?.kind === "character";
  const pointLabel = isCharacterRoute ? "路线点" : "动作点";
  const recordLabel = isAtStart ? "记录起点" : "记录当前位置";

  function togglePlayback() {
    if (!hasPlayableObjectMotion) return;
    if (playing) {
      setPlaying(false);
      return;
    }

    if (progress >= 1 - CURRENT_KEYFRAME_TOLERANCE) {
      setProgress(0);
    }
    setPlaying(true);
  }

  function seek(nextProgress: number) {
    setPlaying(false);
    setProgress(nextProgress);
  }

  function seekFrame(frame: number) {
    seek(frameToProgress(frame, totalFrames));
  }

  function moveCameraWaypointToFrame(keyframeId: string, frame: number) {
    if (!activeCamera || !cameraPath) return;
    const nextProgress = frameToProgress(frame, totalFrames);
    const keyframes = cameraPath.keyframes.map((keyframe, index) => ({
      ...keyframe,
      time: keyframe.id === keyframeId
        ? nextProgress
        : cameraSpans?.arrivals[index] ?? keyframe.time,
    }));

    updateCameraMotionPath(activeCamera.id, {
      speedMode: "custom",
      easing: "linear",
      customEasing: [0, 0, 1, 1],
      keyframes,
    });
    selectCameraMotionKeyframe(keyframeId);
    seekFrame(frame);
  }

  const rulerSpan = Math.max(1, rulerEndFrame - rulerStartFrame);
  const rulerTicks = getRulerTicks(rulerStartFrame, rulerEndFrame);
  const visibleCurrentFrame = Math.min(rulerEndFrame, Math.max(rulerStartFrame, currentFrame));
  const isCurrentFrameVisible = currentFrame >= rulerStartFrame && currentFrame <= rulerEndFrame;

  if (isPiloting) {
    return (
      <section
        className="object-motion-transport object-motion-transport--pilot"
        aria-label="掌镜人物和道具动作播放条"
      >
        <button
          className="object-motion-transport__play object-motion-transport__play--compact"
          type="button"
          disabled={!hasPlayableObjectMotion}
          aria-label={hasPlayableObjectMotion
            ? playing ? "暂停人物和物品动作" : "播放人物和物品动作"
            : "还没有可播放的人物和物品动作"}
          aria-pressed={playing}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
        </button>
        <output className="object-motion-transport__compact-time" aria-label="当前帧">
          第 {formatFrame(currentFrame)} 帧
        </output>
        <span className="object-motion-transport__shortcut" aria-label="空格键播放或暂停">
          <kbd>空格</kbd>
          播放/暂停
        </span>
      </section>
    );
  }

  const objectKindLabel = selectedObject?.kind === "character" ? "人物" : "道具";

  return (
    <section
      className="object-motion-transport object-motion-transport--full"
      aria-label="人物和道具动作播放条"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="object-motion-transport__subject" aria-label="当前动作对象">
        <span className="object-motion-transport__subject-icon" aria-hidden="true">
          {selectedObject?.kind === "character"
            ? <PersonStanding size={17} />
            : <Package size={17} />}
        </span>
        <span className="object-motion-transport__subject-copy">
          <small>{selectedObject ? isCharacterRoute ? "人物路线播放" : `${objectKindLabel}动作` : "人物 / 道具动作"}</small>
          <strong title={selectedObject?.name}>
            {selectedObject?.name ?? "请先选中人物或道具"}
          </strong>
        </span>
      </div>

      <div className="object-motion-transport__player" aria-label="动作播放控制">
        <button
          className="object-motion-transport__icon-button"
          type="button"
          aria-label="回到动作开头"
          onClick={() => seek(0)}
        >
          <RotateCcw aria-hidden="true" size={15} />
        </button>
        <button
          className="object-motion-transport__play"
          type="button"
          disabled={!hasPlayableObjectMotion}
          aria-label={hasPlayableObjectMotion
            ? playing ? "暂停人物和物品动作" : "播放人物和物品动作"
            : "还没有可播放的人物和物品动作"}
          aria-pressed={playing}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
        </button>
      </div>

      <div className="object-motion-transport__ruler-panel" role="region" aria-label="帧数标尺">
        <div className="object-motion-transport__ruler-toolbar">
          <strong>帧标尺</strong>
          <span>{rulerStartFrame} - {rulerEndFrame} / {totalFrames} 帧</span>
          <label className="object-motion-transport__frame-count-control">
            总帧数
            <input
              aria-label="动作总帧数"
              type="number"
              min="24"
              max="720"
              step="1"
              value={totalFrames}
              onChange={(event) => updateTotalFrames(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            帧/秒
            <select
              aria-label="项目帧率"
              value={fps}
              onChange={(event) => updateFps(Number(event.currentTarget.value))}
            >
              {[12, 24, 25, 30, 48, 50, 60].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="object-motion-transport__ruler" aria-label="帧标尺刻度">
          {rulerTicks.map(({ frame, major }) => {
            return (
              <span
                className={`object-motion-transport__ruler-tick${major ? " is-major" : ""}${frame === rulerStartFrame ? " is-first" : ""}${frame === rulerEndFrame ? " is-last" : ""}`}
                key={frame}
                data-frame={major ? frame : undefined}
                style={{ left: `${((frame - rulerStartFrame) / rulerSpan) * 100}%` }}
              />
            );
          })}
          {showCameraTimeline && activeCamera && cameraPath ? cameraPath.keyframes.map((keyframe, index) => {
            const waypointFrame = progressToFrame(cameraSpans?.arrivals[index] ?? keyframe.time, totalFrames);
            if (waypointFrame < rulerStartFrame || waypointFrame > rulerEndFrame) return null;
            return (
              <input
                className={`object-motion-transport__camera-waypoint${selectedCameraKeyframeId === keyframe.id ? " is-selected" : ""}`}
                key={keyframe.id}
                aria-label={`轨迹点 ${index + 1} 帧位置`}
                aria-valuetext={`轨迹点 ${index + 1}，第 ${waypointFrame} 帧`}
                title={`轨迹点 ${index + 1} · 第 ${waypointFrame} 帧`}
                type="range"
                min={String(rulerStartFrame)}
                max={String(rulerEndFrame)}
                step="1"
                value={waypointFrame}
                onPointerDown={() => {
                  beginUndoBatch();
                  setPlaying(false);
                  selectCameraMotionKeyframe(keyframe.id);
                }}
                onPointerUp={endUndoBatch}
                onPointerCancel={endUndoBatch}
                onBlur={endUndoBatch}
                onChange={(event) => moveCameraWaypointToFrame(keyframe.id, Number(event.currentTarget.value))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (activeCamera) deleteCameraMotionKeyframe(activeCamera.id, keyframe.id);
                }}
              />
            );
          }) : null}
          {keyframes.map((keyframe, index) => {
            const frame = progressToFrame(objectSpans?.arrivals[index] ?? keyframe.time, totalFrames);
            if (frame < rulerStartFrame || frame > rulerEndFrame) return null;
            return (
              <button
                key={keyframe.id}
                type="button"
                className="object-motion-transport__object-waypoint"
                style={{ left: `${((frame - rulerStartFrame) / rulerSpan) * 100}%` }}
                aria-label={`${selectedObject?.name}关键帧 ${frame}`}
                title={`第 ${frame} 帧，右键删除`}
                onClick={() => seekFrame(frame)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selectedObject) return;
                  setPlaying(false);
                  deleteObjectMotionKeyframe(selectedObject.id, keyframe.id);
                }}
              />
            );
          })}
          {isCurrentFrameVisible ? <>
            <i
              className="object-motion-transport__ruler-playhead"
              style={{ left: `${((visibleCurrentFrame - rulerStartFrame) / rulerSpan) * 100}%` }}
            />
            <output
              className="object-motion-transport__ruler-frame-label"
              aria-label="当前帧标记"
              style={{ left: `clamp(14px, ${((visibleCurrentFrame - rulerStartFrame) / rulerSpan) * 100}%, calc(100% - 14px))` }}
            >
              {formatFrame(currentFrame)}
            </output>
          </> : null}
          <input
            className="object-motion-transport__ruler-scrubber"
            aria-label="帧标尺播放头"
            type="range"
            min={String(rulerStartFrame)}
            max={String(rulerEndFrame)}
            step="1"
            value={visibleCurrentFrame}
            onChange={(event) => seekFrame(Number(event.currentTarget.value))}
          />
        </div>
        <div className="object-motion-transport__ruler-range" aria-label="帧标尺显示范围">
          <span className="object-motion-transport__ruler-range-track" aria-hidden="true" />
          <span
            className="object-motion-transport__ruler-range-selection"
            aria-hidden="true"
            style={{
              left: `${(rulerStartFrame / totalFrames) * 100}%`,
              width: `${((rulerEndFrame - rulerStartFrame) / totalFrames) * 100}%`,
            }}
          />
          <input
            className="object-motion-transport__range-input object-motion-transport__range-input--start"
            aria-label="标尺起始帧"
            type="range"
            min="0"
            max={String(Math.max(1, totalFrames - 1))}
            value={rulerStartFrame}
            onChange={(event) => setRulerStartFrame(Math.min(Number(event.currentTarget.value), rulerEndFrame - 1))}
          />
          <input
            className="object-motion-transport__range-input object-motion-transport__range-input--end"
            aria-label="标尺结束帧"
            type="range"
            min="1"
            max={String(totalFrames)}
            value={rulerEndFrame}
            onChange={(event) => setRulerEndFrame(Math.max(Number(event.currentTarget.value), rulerStartFrame + 1))}
          />
          <output className="object-motion-transport__ruler-range-start">起始 {rulerStartFrame}</output>
          <output className="object-motion-transport__ruler-range-end">结束 {rulerEndFrame}</output>
        </div>
      </div>

      {hasPlayableObjectMotion ? (
        <div className="object-motion-transport__tracks" aria-label="镜头与对象移动停留时间轴">
          <div className="object-motion-transport__tracks-heading">
            <strong>镜头与人物时间轴</strong>
            <span><i className="is-move" />移动 <i className="is-hold" />停留 <i className="is-playhead" />当前帧</span>
          </div>
          {showCameraTimeline && cameraSpans?.moves.length ? (
            <div className="object-motion-transport__track object-motion-transport__track--camera">
              <span className="object-motion-transport__track-label">
                <strong>镜头移动</strong>
                <small>{getRoutePlaybackStatus(cameraSpans, progress)}</small>
              </span>
              <div className="object-motion-transport__track-line">
                {cameraSpans.moves.map((span) => (
                  <span
                    key={`camera-move-${span.index}`}
                    className={`object-motion-transport__span is-move${progress >= span.start && progress < span.end ? " is-active" : ""}`}
                    style={{ left: `${span.start * 100}%`, width: `${Math.max(0, span.end - span.start) * 100}%` }}
                    title={`镜头移动 第 ${progressToFrame(span.start, totalFrames)} 帧 - 第 ${progressToFrame(span.end, totalFrames)} 帧`}
                  />
                ))}
                {cameraSpans.holds.map((span) => (
                  <span
                    key={`camera-hold-${span.index}`}
                    className={`object-motion-transport__span is-hold${progress >= span.start && progress < span.end ? " is-active" : ""}`}
                    style={{ left: `${span.start * 100}%`, width: `${Math.max(0, span.end - span.start) * 100}%` }}
                    title={`镜头停留第 ${progressToFrame(span.start, totalFrames)} 帧至第 ${progressToFrame(span.end, totalFrames)} 帧`}
                  />
                ))}
                <i className="object-motion-transport__playhead" style={{ left: `${progress * 100}%` }} />
                <input
                  className="object-motion-transport__track-scrubber"
                  aria-label="拖动镜头时间轴"
                  aria-valuetext={`第 ${formatFrame(currentFrame)} 帧，共 ${totalFrames} 帧`}
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={progress}
                  onChange={(event) => seek(Number(event.currentTarget.value))}
                />
              </div>
            </div>
          ) : null}
          {showObjectTimeline && objectSpans?.moves.length ? (
            <div className="object-motion-transport__track object-motion-transport__track--object">
              <span className="object-motion-transport__track-label" title={selectedObject?.name}>
                <strong>{selectedObject?.name ?? (selectedObject?.kind === "character" ? "人物" : "道具")}移动</strong>
                <small>{getRoutePlaybackStatus(objectSpans, progress)}</small>
              </span>
              <div className="object-motion-transport__track-line">
                {objectSpans.moves.map((span) => (
                  <span
                    key={`object-move-${span.index}`}
                    className={`object-motion-transport__span is-move${progress >= span.start && progress < span.end ? " is-active" : ""}`}
                    style={{ left: `${span.start * 100}%`, width: `${Math.max(0, span.end - span.start) * 100}%` }}
                    title={`${selectedObject?.name ?? "对象"}移动 第 ${progressToFrame(span.start, totalFrames)} 帧 - 第 ${progressToFrame(span.end, totalFrames)} 帧`}
                  />
                ))}
                {objectSpans.holds.map((span) => (
                  <span
                    key={`object-hold-${span.index}`}
                    className={`object-motion-transport__span is-hold${progress >= span.start && progress < span.end ? " is-active" : ""}`}
                    style={{ left: `${span.start * 100}%`, width: `${Math.max(0, span.end - span.start) * 100}%` }}
                    title={`${selectedObject?.name ?? "对象"}停留第 ${progressToFrame(span.start, totalFrames)} 帧至第 ${progressToFrame(span.end, totalFrames)} 帧`}
                  />
                ))}
                <i className="object-motion-transport__playhead" style={{ left: `${progress * 100}%` }} />
                <input
                  className="object-motion-transport__track-scrubber"
                  aria-label="拖动人物时间轴"
                  aria-valuetext={`第 ${formatFrame(currentFrame)} 帧，共 ${totalFrames} 帧`}
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={progress}
                  onChange={(event) => seek(Number(event.currentTarget.value))}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="object-motion-transport__editor">
        <button
          className="object-motion-transport__play"
          type="button"
          disabled={!hasPlayableObjectMotion}
          aria-label="从起点播放"
          title="从起点播放"
          onClick={restartPlayback}
        >
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5v14M9 5l11 7-11 7z" /></svg>
        </button>
        {!isCharacterRoute || recordingCamera ? <>
          <button
            className="object-motion-transport__record"
            type="button"
            disabled={!selectedObject && !recordingCamera}
            aria-label={recordingCamera ? `${recordLabel}：${recordingCamera.name}` : selectedObject ? `${recordLabel}：${selectedObject.name}` : "记录人物或道具动作点"}
            title={recordLabel}
            onClick={() => {
              if (recordingCamera) {
                setPlaying(false);
                if (onRecordCamera) onRecordCamera(recordingCamera.id);
                else useDirectorStore.getState().addCameraMotionKeyframe(recordingCamera.id, progress);
                return;
              }
              if (!selectedObject) return;
              setPlaying(false);
              const recorded = addObjectMotionKeyframe(selectedObject.id, progress);
              if (recorded) selectObjectMotionKeyframe(recorded);
            }}
          >
            <MapPinPlus aria-hidden="true" size={15} />
            <span>{recordLabel}</span>
          </button>
          {curveEditorButton}
          <div
            className="object-motion-transport__keyframes"
            role="group"
            aria-label={selectedObject ? `${selectedObject.name}动作点` : "动作点"}
          >
            {keyframes.length > 0 ? keyframes.map((keyframe, index) => {
            const isCurrent = keyframe.id === currentKeyframe?.id;
            return (
              <button
                key={keyframe.id}
                className={isCurrent ? "is-current" : undefined}
                type="button"
                aria-label={`跳转到${selectedObject?.name ?? "对象"}${pointLabel} ${index + 1}`}
                aria-pressed={isCurrent}
                title={`第 ${progressToFrame(objectSpans?.arrivals[index] ?? keyframe.time, totalFrames)} 帧 · ${pointLabel} ${index + 1}`}
                onClick={() => {
                  selectObjectMotionKeyframe(keyframe.id);
                  seek(objectSpans?.arrivals[index] ?? keyframe.time);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (selectedObject) {
                    deleteObjectMotionKeyframe(selectedObject.id, keyframe.id);
                    selectObjectMotionKeyframe(null);
                  }
                }}
              >
                {index + 1}
              </button>
            );
            }) : (
              <small>{selectedObject ? "还没有动作点" : "选择对象后记录动作"}</small>
            )}
          </div>
        </> : <>{curveEditorButton}<span className="object-motion-transport__route-hint">路线点、每段动作和朝向请在右侧“路线”页编辑</span></>}

        <button
          className="object-motion-transport__delete"
          type="button"
          disabled={isCharacterRoute || !selectedObject || !currentKeyframe}
          aria-label={selectedObject ? `删除${selectedObject.name}当前${pointLabel}` : "删除当前动作点"}
          title="删除当前点"
          onClick={() => {
            if (!selectedObject || !currentKeyframe) return;
            setPlaying(false);
            deleteObjectMotionKeyframe(selectedObject.id, currentKeyframe.id);
            selectObjectMotionKeyframe(null);
          }}
        >
          <Trash2 aria-hidden="true" size={14} />
          <span>删除当前点</span>
        </button>
      </div>
      {curveEditorOpen ? <CurveEditor onClose={() => setCurveEditorOpen(false)} /> : null}
    </section>
  );
}
