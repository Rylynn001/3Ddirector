export const TRANSFORM_CHANNELS = ["position.x", "position.y", "position.z", "rotation.x", "rotation.y", "rotation.z", "scale.x", "scale.y", "scale.z"] as const;
export type TransformChannel = typeof TRANSFORM_CHANNELS[number];
export interface CurveTangent {
  incoming: [number, number];
  outgoing: [number, number];
  linked: boolean;
}
export type CurveTangents = Partial<Record<TransformChannel, CurveTangent>>;
export interface CurvePoint { time: number; value: number; tangent?: CurveTangent }
export function channelParts(channel: TransformChannel) {
  const [property, axis] = channel.split(".");
  return [property as "position" | "rotation" | "scale", "xyz".indexOf(axis)] as const;
}

export function normalizeCurveTangents(value: unknown): CurveTangents | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: CurveTangents = {};
  for (const channel of TRANSFORM_CHANNELS) {
    const tangent = (value as CurveTangents)[channel];
    if (!tangent) continue;
    if (![tangent.incoming, tangent.outgoing].every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite))) continue;
    result[channel] = {
      incoming: [-Math.min(1, Math.abs(tangent.incoming[0])), tangent.incoming[1]],
      outgoing: [Math.min(1, Math.abs(tangent.outgoing[0])), tangent.outgoing[1]],
      linked: tangent.linked !== false,
    };
  }
  return Object.keys(result).length ? result : undefined;
}

export function defaultCurveTangent(points: CurvePoint[], index: number): CurveTangent {
  const point = points[index];
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  const slope = (after.value - before.value) / Math.max(1e-8, after.time - before.time);
  const incoming = (point.time - before.time || after.time - point.time || 0.1) / 3;
  const outgoing = (after.time - point.time || point.time - before.time || 0.1) / 3;
  return { incoming: [-incoming, -incoming * slope], outgoing: [outgoing, outgoing * slope], linked: true };
}

function bezier(a: number, b: number, c: number, d: number, t: number) {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** 手柄只控制两帧之间的过渡，绝不修改关键帧的时间和值。 */
export function sampleCurve(points: CurvePoint[], time: number, fallback: number) {
  if (!points.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  const index = points.findIndex((point, i) => i + 1 < points.length && time >= point.time && time < points[i + 1].time);
  if (index < 0) return fallback;
  const a = points[index];
  const b = points[index + 1];
  if (!a.tangent && !b.tangent) return fallback;
  const outgoing = (a.tangent ?? defaultCurveTangent(points, index)).outgoing;
  const incoming = (b.tangent ?? defaultCurveTangent(points, index + 1)).incoming;
  const gap = b.time - a.time;
  const outTime = Math.min(gap / 2, Math.max(0, outgoing[0]));
  const inTime = Math.max(-gap / 2, Math.min(0, incoming[0]));
  // 时间控制点保持单调，用二分求出对应帧的贝塞尔参数。
  let low = 0, high = 1;
  for (let step = 0; step < 32; step++) {
    const mid = (low + high) / 2;
    if (bezier(a.time, a.time + outTime, b.time + inTime, b.time, mid) < time) low = mid;
    else high = mid;
  }
  return bezier(a.value, a.value + outgoing[1], b.value + incoming[1], b.value, (low + high) / 2);
}
