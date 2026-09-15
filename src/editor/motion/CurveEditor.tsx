import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { X, Minus, Plus, Maximize2 } from "lucide-react";
import { useDirectorStore } from "../store/directorStore";
import { TRANSFORM_CHANNELS, channelParts, defaultCurveTangent, type CurvePoint, type CurveTangent, type TransformChannel } from "../schema/animationCurves";
import { getCameraKeyTransform, getCameraMotionPath, getCameraMotionSnapshot, getCameraMotionTimingPlan } from "../schema/cameraMotion";
import { getObjectMotionSnapshot, getObjectMotionTimingPlan, normalizeObjectMotionPath } from "../schema/objectMotion";
import { cameraViewRotation } from "../schema/cameraGeometry";
import "./curveEditor.css";

const W = 1000, H = 520, LEFT = 62, TOP = 26, RIGHT = 24, BOTTOM = 34;
const colors = ["#f07472", "#78d58b", "#79b5ff"];
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
  const toX = (time: number) => LEFT + time * (W - LEFT - RIGHT);
  const toY = (value: number) => TOP + (bounds.max - value) / (bounds.max - bounds.min) * (H - TOP - BOTTOM);
  const index = data.findIndex((key) => key.id === selected?.id);
  const activePoints = selected ? points(selected.channel) : [];
  const point = activePoints[index];
  const tangent = point ? point.tangent ?? defaultCurveTangent(activePoints, index) : null;

  useEffect(() => {
    setSelected(null);
    setRange(null);
  }, [selectedId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus(); useDirectorStore.getState().endUndoBatch(); };
  }, []);

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
    if (!drag.current) return;
    drag.current = null;
    useDirectorStore.getState().endUndoBatch();
  }
  function beginDrag(event: PointerEvent<SVGCircleElement>, side: "incoming" | "outgoing") {
    if (!object || object.locked || !point || !tangent || !selected) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const neighbor = activePoints[index + (side === "incoming" ? -1 : 1)];
    drag.current = { objectId: object.id, id: selected.id, channel: selected.channel, side, point, tangent,
      limit: neighbor ? Math.abs(neighbor.time - point.time) / 2 : 0.1 };
    useDirectorStore.getState().setCameraMotionPlaying(false);
    useDirectorStore.getState().beginUndoBatch();
  }
  function moveHandle(event: PointerEvent<SVGSVGElement>) {
    const moving = drag.current;
    if (!moving || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * W / rect.width;
    const y = (event.clientY - rect.top) * H / rect.height;
    const time = (x - LEFT) / (W - LEFT - RIGHT);
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
  function zoom(factor: number) {
    const center = (bounds.min + bounds.max) / 2;
    const half = Math.max(0.0001, (bounds.max - bounds.min) * factor / 2);
    setRange({ min: center - half, max: center + half });
  }
  function fit() {
    const samples = channels.flatMap((channel) => Array.from({ length: 101 }, (_, i) => valueAt(channel, i / 100)));
    const low = Math.min(0, ...samples), high = Math.max(1, ...samples);
    setRange({ min: low - (high - low) * 0.15, max: high + (high - low) * 0.15 });
  }

  return createPortal(<div className="curve-editor-backdrop">
    <div className="curve-editor" role="dialog" aria-modal="true" aria-label="曲线编辑器" tabIndex={-1} ref={dialog}
      onKeyDown={(event) => {
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
        <button aria-label="缩小曲线" onClick={() => zoom(1.3)}><Minus size={15} /></button>
        <button aria-label="放大曲线" onClick={() => zoom(1 / 1.3)}><Plus size={15} /></button>
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
            onPointerMove={moveHandle} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            {Array.from({ length: 11 }, (_, i) => {
              const time = i / 10, value = bounds.min + (bounds.max - bounds.min) * time;
              return <g key={i}><line className="curve-grid" x1={toX(time)} x2={toX(time)} y1={TOP} y2={H - BOTTOM} /><text x={toX(time)} y={H - 10} textAnchor="middle">{Math.round(time * project.totalFrames)}</text><line className="curve-grid" x1={LEFT} x2={W - RIGHT} y1={toY(value)} y2={toY(value)} /><text x={LEFT - 9} y={toY(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text></g>;
            })}
            <defs><clipPath id="curve-plot-clip"><rect x={LEFT} y={TOP} width={W - LEFT - RIGHT} height={H - TOP - BOTTOM} /></clipPath></defs>
            <g clipPath="url(#curve-plot-clip)">
              <line className="curve-playhead" x1={toX(progress)} x2={toX(progress)} y1={TOP} y2={H - BOTTOM} />
              {data.length > 0 && channels.map((channel) => {
                const axis = channelParts(channel)[1];
                const path = Array.from({ length: 181 }, (_, i) => `${i ? "L" : "M"}${toX(i / 180)},${toY(valueAt(channel, i / 180))}`).join(" ");
                return <g key={channel}><path d={path} fill="none" stroke={colors[axis]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  {points(channel).map((key, i) => <circle key={data[i].id} cx={toX(key.time)} cy={toY(key.value * unit(channel))} r={selected?.id === data[i].id && selected.channel === channel ? 5 : 3.5}
                    className="curve-key" role="button" tabIndex={0} aria-label={`${channelLabel(channel)} 第 ${Math.round(key.time * project.totalFrames)} 帧关键帧`}
                    onClick={() => selectKey(i, channel)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectKey(i, channel); } }} />)}
                </g>;
              })}
              {point && tangent && selected && channels.includes(selected.channel) && (["incoming", "outgoing"] as const).map((side) => {
                const offset = tangent[side];
                const x = toX(point.time + offset[0]), y = toY((point.value + offset[1]) * unit(selected.channel));
                return <g key={side}><line className="curve-tangent-line" x1={toX(point.time)} y1={toY(point.value * unit(selected.channel))} x2={x} y2={y} />
                  <circle className="curve-tangent-handle" cx={x} cy={y} r={6} role="button" tabIndex={0} aria-label={side === "incoming" ? "入切线手柄" : "出切线手柄"} onPointerDown={(event) => beginDrag(event, side)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      const dv = offset[1] + (event.key === "ArrowUp" ? 1 : -1) * (bounds.max - bounds.min) / 100 / unit(selected.channel);
                      const next = { ...tangent, [side]: [offset[0], dv] as [number, number] };
                      const other = side === "incoming" ? "outgoing" : "incoming";
                      if (next.linked && offset[0]) next[other] = [next[other][0], dv / offset[0] * next[other][0]];
                      update(next);
                    }} />
                </g>;
              })}
            </g>
          </svg>
          {!data.length && <div className="curve-editor-empty">{object ? "此对象还没有关键帧。关闭编辑器，在时间轴上按 S 记录后再编辑曲线。" : "请先在场景层级中选择物体或相机。"}</div>}
        </div>
      </div>
      <footer>单击通道单独查看 · Ctrl 多选通道 · 单击关键帧显示切线 · 拖动两端手柄调整过渡 · 旋转单位为度{camera ? " · 相机缩放改变相机对象尺寸" : ""}{object?.locked ? " · 对象已锁定" : ""}</footer>
    </div>
  </div>, document.body);
}
