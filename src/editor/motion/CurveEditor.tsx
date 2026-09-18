import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2 } from "lucide-react";
import { useDirectorStore } from "../store/directorStore";
import { TRANSFORM_CHANNELS, channelParts, defaultCurveTangent, type CurvePoint, type CurveTangent, type TransformChannel } from "../schema/animationCurves";
import { getCameraKeyTransform, getCameraMotionPath, getCameraMotionSnapshot, getCameraMotionTimingPlan } from "../schema/cameraMotion";
import { getObjectMotionSnapshot, getObjectMotionTimingPlan, normalizeObjectMotionPath } from "../schema/objectMotion";
import { cameraViewRotation } from "../schema/cameraGeometry";
import "./curveEditor.css";

const LEFT = 48, TOP = 25, RIGHT = 16, BOTTOM = 16;
const colors = ["#e45b59", "#72bb62", "#659ad6"];
const labels = { position: "平移", rotation: "旋转", scale: "缩放" };
function channelLabel(channel: TransformChannel) {
  const [property, axis] = channelParts(channel);
  return `${labels[property]} ${"XYZ"[axis]}`;
}
function unit(channel: TransformChannel) { return channel.startsWith("rotation") ? 180 / Math.PI : 1; }

export function CurveEditor({ onClose }: { onClose: () => void }) {
  const project = useDirectorStore((state) => state.project);
  const selectedId = useDirectorStore((state) => state.selectedObjectId);
  const progress = useDirectorStore((state) => state.cameraMotionProgress);
  const updateTangent = useDirectorStore((state) => state.updateCurveTangent);
  const [channels, setChannels] = useState<TransformChannel[]>(["position.x", "position.y", "position.z"]);
  const [selected, setSelected] = useState<{ id: string; channel: TransformChannel } | null>(null);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 520 });
  const W = size.width, H = size.height;
  const [timeRange, setTimeRange] = useState({ min: -0.1, max: 1.1 });
  const pan = useRef<{ x: number; y: number; min: number; max: number; timeMin: number; timeMax: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; objectId: string; channel: TransformChannel; side: "incoming" | "outgoing"; point: CurvePoint; tangent: CurveTangent; limit: number } | null>(null);
  const object = project.objects.find((item) => item.id === selectedId);
  const camera = project.cameras.find((item) => item.id === object?.linkedCameraId);
  const duration = project.totalFrames / project.fps;
  const data = useMemo(() => {
    if (!object) return [];
    if (camera) {
      const path = getCameraMotionPath(camera);
      const arrivals = getCameraMotionTimingPlan(camera)?.arrivals;
      return path.keyframes.map((key, index) => ({ id: key.id, time: arrivals?.[index] ?? key.time, transform: getCameraKeyTransform(key), tangents: key.tangents }));
    }
    const path = normalizeObjectMotionPath(object.motionPath, object.transform);
    const arrivals = getObjectMotionTimingPlan(object, duration)?.arrivals;
    return path.keyframes.map((key, index) => ({ ...key, time: arrivals?.[index] ?? key.time }));
  }, [object, camera, duration]);

  function points(channel: TransformChannel): CurvePoint[] {
    const [property, axis] = channelParts(channel);
    return data.map((key) => ({ time: key.time, value: key.transform[property][axis], tangent: key.tangents?.[channel] }));
  }
  function valueAt(channel: TransformChannel, time: number) {
    const [property, axis] = channelParts(channel);
    if (camera) {
      const snapshot = getCameraMotionSnapshot(camera, time);
      return (property === "position" ? snapshot.position : property === "rotation"
        ? snapshot.rotation ?? cameraViewRotation(snapshot.position, snapshot.target)
        : snapshot.scale ?? camera.transform.scale)[axis] * unit(channel);
    }
    return object ? getObjectMotionSnapshot(object, time, duration)[property][axis] * unit(channel) : 0;
  }
  const values = channels.flatMap((channel) => points(channel).map((point) => point.value * unit(channel)));
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const bounds = range ?? { min: min - (max - min) * 0.25, max: max + (max - min) * 0.25 };
  const toX = (time: number) => LEFT + (time - timeRange.min) / (timeRange.max - timeRange.min) * (W - LEFT - RIGHT);
  const toY = (value: number) => TOP + (bounds.max - value) / (bounds.max - bounds.min) * (H - TOP - BOTTOM);
  const index = data.findIndex((key) => key.id === selected?.id);
  const activePoints = selected ? points(selected.channel) : [];
  const point = activePoints[index];
  const tangent = point ? point.tangent ?? defaultCurveTangent(activePoints, index) : null;

  useEffect(() => {
    setSelected(null);
    setRange(null);
    setTimeRange({ min: -0.1, max: 1.1 });
  }, [selectedId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus(); useDirectorStore.getState().endUndoBatch(); };
  }, []);

  useEffect(() => {
    const plot = svg.current;
    if (!plot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > LEFT + RIGHT && height > TOP + BOTTOM) setSize({ width, height });
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const plot = svg.current;
    if (!plot) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current || pan.current) return;
      const rect = plot.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, ((event.clientX - rect.left) * W / rect.width - LEFT) / (W - LEFT - RIGHT)));
      const y = Math.max(0, Math.min(1, ((event.clientY - rect.top) * H / rect.height - TOP) / (H - TOP - BOTTOM)));
      const factor = Math.exp(Math.max(-0.25, Math.min(0.25, event.deltaY * (event.deltaMode === 1 ? 16 : 1) * 0.0015)));
      const time = timeRange.min + x * (timeRange.max - timeRange.min);
      const value = bounds.max - y * (bounds.max - bounds.min);
      const timeSpan = Math.max(1 / project.totalFrames, Math.min(20, (timeRange.max - timeRange.min) * factor));
      const valueSpan = Math.max(0.0001, Math.min(1e6, (bounds.max - bounds.min) * factor));
      setTimeRange({ min: time - x * timeSpan, max: time + (1 - x) * timeSpan });
      setRange({ min: value - (1 - y) * valueSpan, max: value + y * valueSpan });
    };
    plot.addEventListener("wheel", wheel, { passive: false });
    return () => plot.removeEventListener("wheel", wheel);
  }, [W, H, bounds.min, bounds.max, timeRange.min, timeRange.max, project.totalFrames]);

  function update(value: CurveTangent) {
    if (object && selected && !object.locked) updateTangent(object.id, selected.id, selected.channel, value);
  }
  function selectKey(keyIndex: number, channel: TransformChannel) {
    const curvePoints = points(channel);
    const key = curvePoints[keyIndex];
    const handles = key.tangent ?? defaultCurveTangent(curvePoints, keyIndex);
    const low = Math.min(bounds.min, (key.value + handles.incoming[1]) * unit(channel), (key.value + handles.outgoing[1]) * unit(channel));
    const high = Math.max(bounds.max, (key.value + handles.incoming[1]) * unit(channel), (key.value + handles.outgoing[1]) * unit(channel));
    if (low < bounds.min || high > bounds.max) setRange({ min: low - (high - low) * 0.08, max: high + (high - low) * 0.08 });
    setSelected({ id: data[keyIndex].id, channel });
  }
  function endDrag() {
    pan.current = null;
    if (!drag.current) return;
    drag.current = null;
    useDirectorStore.getState().endUndoBatch();
  }
  function beginDrag(event: PointerEvent<SVGGElement>, side: "incoming" | "outgoing") {
    if (!object || object.locked || !point || !tangent || !selected) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const neighbor = activePoints[index + (side === "incoming" ? -1 : 1)];
    drag.current = { objectId: object.id, id: selected.id, channel: selected.channel, side, point, tangent,
      limit: neighbor ? Math.abs(neighbor.time - point.time) / 2 : 0.1 };
    useDirectorStore.getState().setCameraMotionPlaying(false);
    useDirectorStore.getState().beginUndoBatch();
  }
  function moveHandle(event: PointerEvent<SVGSVGElement>) {
    if (!svg.current) return;
    if (pan.current) {
      const start = pan.current;
      const dx = (event.clientX - start.x) / (W - LEFT - RIGHT) * (start.timeMax - start.timeMin);
      const dy = (event.clientY - start.y) / (H - TOP - BOTTOM) * (start.max - start.min);
      setTimeRange({ min: start.timeMin - dx, max: start.timeMax - dx });
      setRange({ min: start.min + dy, max: start.max + dy });
      return;
    }
    const moving = drag.current;
    if (!moving) return;
    const rect = svg.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * W / rect.width;
    const y = (event.clientY - rect.top) * H / rect.height;
    const time = timeRange.min + (x - LEFT) / (W - LEFT - RIGHT) * (timeRange.max - timeRange.min);
    const value = (bounds.max - (y - TOP) / (H - TOP - BOTTOM) * (bounds.max - bounds.min)) / unit(moving.channel);
    const sign = moving.side === "incoming" ? -1 : 1;
    const dt = sign * Math.min(moving.limit, Math.max(0.00001, sign * (time - moving.point.time)));
    const dv = value - moving.point.value;
    const next = { ...moving.tangent, [moving.side]: [dt, dv] as [number, number] };
    if (next.linked) {
      const other = moving.side === "incoming" ? "outgoing" : "incoming";
      next[other] = [next[other][0], (dv / dt) * next[other][0]];
    }
    updateTangent(moving.objectId, moving.id, moving.channel, next);
  }
  function fit() {
    setTimeRange({ min: -0.1, max: 1.1 });
    const samples = channels.flatMap((channel) => Array.from({ length: 101 }, (_, i) => valueAt(channel, i / 100)));
    const low = Math.min(0, ...samples), high = Math.max(1, ...samples);
    setRange({ min: low - (high - low) * 0.15, max: high + (high - low) * 0.15 });
  }

  return createPortal(<div className="curve-editor-backdrop">
    <div className="curve-editor" role="dialog" aria-modal="true" aria-label="曲线编辑器" tabIndex={-1} ref={dialog}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
          event.preventDefault();
          event.stopPropagation();
          if (drag.current || pan.current) return;
          const objects = project.objects.filter((item) => item.kind !== "panorama"
            && !project.cameras.some((camera) => camera.id === item.linkedCameraId && camera.isVirtual));
          if (!objects.length) return;
          const current = objects.findIndex((item) => item.id === selectedId);
          const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
          const next = current < 0 ? (step > 0 ? 0 : objects.length - 1) : (current + step + objects.length) % objects.length;
          if (objects[next].id !== selectedId) useDirectorStore.getState().selectObject(objects[next].id);
          dialog.current?.focus();
        }
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
          if (!focusable?.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="curve-editor-header"><strong>曲线编辑器</strong><span>{object?.name ?? "未选择对象"}</span><button aria-label="关闭曲线编辑器" onClick={onClose}><X size={17} /></button></header>
      <div className="curve-editor-toolbar">
        <span>{selected ? `${channelLabel(selected.channel)} · 第 ${Math.round((point?.time ?? 0) * project.totalFrames)} 帧` : "选择关键帧以显示切线"}</span>
        <button disabled={!tangent || object?.locked} onClick={() => tangent && update({ ...tangent, incoming: [tangent.incoming[0], 0], outgoing: [tangent.outgoing[0], 0] })}>水平切线</button>
        <button disabled={!tangent || object?.locked} onClick={() => point && update(defaultCurveTangent(activePoints, index))}>平滑切线</button>
        <label><input type="checkbox" checked={tangent?.linked ?? true} disabled={!tangent || object?.locked} onChange={(event) => tangent && update({ ...tangent, linked: event.target.checked })} />联动两端</label>
        <button aria-label="适配曲线" onClick={fit}><Maximize2 size={15} /></button>
      </div>
      <div className="curve-editor-body">
        <nav aria-label="动画通道" className="curve-editor-channels">
          <strong title={object?.name}>{object?.name ?? "请先在层级中选择对象"}</strong>
          <button onClick={() => { setChannels([...TRANSFORM_CHANNELS]); setRange(null); }}>全部通道</button>
          {(["position", "rotation", "scale"] as const).map((property) => <section key={property}>
            <button className="curve-editor-group" onClick={() => { setChannels(TRANSFORM_CHANNELS.filter((c) => c.startsWith(property))); setRange(null); }}>{labels[property]}</button>
            {TRANSFORM_CHANNELS.filter((channel) => channel.startsWith(property)).map((channel, axis) => <button key={channel} aria-pressed={channels.includes(channel)} style={{ color: colors[axis] }} onClick={(event) => {
              setChannels(event.ctrlKey || event.metaKey ? channels.includes(channel) ? channels.filter((c) => c !== channel) : [...channels, channel] : [channel]);
              setSelected(null); setRange(null);
            }}>{channelLabel(channel)}</button>)}
          </section>)}
        </nav>
        <div className="curve-editor-plot">
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="group" aria-label="动画曲线，横轴帧数，纵轴通道值"
            onPointerDown={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              pan.current = { x: event.clientX, y: event.clientY, min: bounds.min, max: bounds.max, timeMin: timeRange.min, timeMax: timeRange.max };
            }}
            onPointerMove={moveHandle} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            {Array.from({ length: 11 }, (_, i) => {
              const time = timeRange.min + i / 10 * (timeRange.max - timeRange.min), value = bounds.min + (bounds.max - bounds.min) * i / 10;
              return <g key={i}><line className="curve-grid" x1={toX(time)} x2={toX(time)} y1={TOP} y2={H - BOTTOM} /><text x={toX(time)} y={16} textAnchor="middle">{Math.round(time * project.totalFrames)}</text><line className="curve-grid" x1={LEFT} x2={W - RIGHT} y1={toY(value)} y2={toY(value)} /><text x={LEFT - 9} y={toY(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text></g>;
            })}
            <defs><clipPath id="curve-plot-clip"><rect x={LEFT} y={TOP} width={W - LEFT - RIGHT} height={H - TOP - BOTTOM} /></clipPath></defs>
            <g clipPath="url(#curve-plot-clip)">
              <line className="curve-playhead" x1={toX(progress)} x2={toX(progress)} y1={TOP} y2={H - BOTTOM} />
              {data.length > 0 && channels.map((channel) => {
                const axis = channelParts(channel)[1];
                const path = Array.from({ length: 181 }, (_, i) => `${i ? "L" : "M"}${toX(timeRange.min + i / 180 * (timeRange.max - timeRange.min))},${toY(valueAt(channel, timeRange.min + i / 180 * (timeRange.max - timeRange.min)))}`).join(" ");
                return <g key={channel}><path d={path} fill="none" stroke={colors[axis]} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  {points(channel).map((key, i) => <g key={data[i].id} transform={`translate(${toX(key.time)} ${toY(key.value * unit(channel))})`}
                    className={`curve-key${selected?.id === data[i].id && selected.channel === channel ? " is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${channelLabel(channel)} 第 ${Math.round(key.time * project.totalFrames)} 帧关键帧`}
                    onClick={() => selectKey(i, channel)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectKey(i, channel); } }}>
                    <circle className="curve-hit-area" r={9} />
                    <path className="curve-key-mark" d="M0 -3 L3 0 L0 3 L-3 0 Z" />
                  </g>)}
                </g>;
              })}
              {point && tangent && selected && channels.includes(selected.channel) && (["incoming", "outgoing"] as const).map((side) => {
                const offset = tangent[side];
                const x = toX(point.time + offset[0]), y = toY((point.value + offset[1]) * unit(selected.channel));
                return <g key={side}><line className="curve-tangent-line" x1={toX(point.time)} y1={toY(point.value * unit(selected.channel))} x2={x} y2={y} />
                  <g className="curve-tangent-handle" transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={side === "incoming" ? "入切线手柄" : "出切线手柄"} onPointerDown={(event) => beginDrag(event, side)}>
                    <circle className="curve-hit-area" r={10} />
                    <path className="curve-tangent-mark" d="M0 -2.5 V2.5" transform={`rotate(${Math.atan2(y - toY(point.value * unit(selected.channel)), x - toX(point.time)) * 180 / Math.PI})`} />
                  </g>
                </g>;
              })}
            </g>
          </svg>
          {!data.length && <div className="curve-editor-empty">{object ? "此对象还没有关键帧。关闭编辑器，在时间轴上按 S 记录后再编辑曲线。" : "请先在场景层级中选择物体或相机。"}</div>}
        </div>
      </div>
      <footer>←/↑ 上一个对象 · →/↓ 下一个对象 · 滚轮缩放 · 中键拖动平移 · Ctrl 多选通道 · 拖动切线端点调整过渡 · 旋转单位为度{camera ? " · 相机缩放改变相机对象尺寸" : ""}{object?.locked ? " · 对象已锁定" : ""}</footer>
    </div>
  </div>, document.body);
}
