import { beforeEach, expect, it } from "vitest";
import { TRANSFORM_CHANNELS, channelParts, normalizeCurveTangents, sampleCurve } from "../animationCurves";
import { createInitialDirectorState, useDirectorStore } from "../../store/directorStore";
import { getObjectMotionSnapshot } from "../objectMotion";
import { getCameraMotionSnapshot } from "../cameraMotion";

beforeEach(() => useDirectorStore.setState({ ...createInitialDirectorState() }));

it("贝塞尔切线只改变过渡，首尾时间和值保持不变", () => {
  const points = [
    { time: 0, value: 0, tangent: { incoming: [-0.2, -2] as [number, number], outgoing: [0.2, 2] as [number, number], linked: true } },
    { time: 1, value: 1 },
  ];
  expect(sampleCurve(points, 0, 0)).toBe(0);
  expect(sampleCurve(points, 1, 1)).toBe(1);
  expect(sampleCurve(points, 0.5, 0.5)).toBeGreaterThan(0.5);
  expect(normalizeCurveTangents({ "position.x": { incoming: [-1, NaN], outgoing: [1, 0] } })).toBeUndefined();
});

it.each(TRANSFORM_CHANNELS)("物体 %s 切线改变实际采样且能够保存重载", (channel) => {
  const state = useDirectorStore.getState();
  const object = state.project.objects.find((item) => item.kind === "character")!;
  state.addObjectMotionKeyframe(object.id, 0);
  state.updateObjectTransform(object.id, { position: [2, 2, 2], rotation: [0.5, 0.5, 0.5], scale: [2, 2, 2] });
  state.addObjectMotionKeyframe(object.id, 1);
  const before = useDirectorStore.getState().project.objects.find((item) => item.id === object.id)!;
  const [property, axis] = channelParts(channel);
  const base = getObjectMotionSnapshot(before, 0.5)[property][axis];
  const keys = before.motionPath!.keyframes;
  state.updateCurveTangent(object.id, keys[0].id, channel, { incoming: [-0.2, -4], outgoing: [0.2, 4], linked: true });
  const after = useDirectorStore.getState().project.objects.find((item) => item.id === object.id)!;
  expect(after.motionPath!.keyframes.map((key) => [key.time, key.transform])).toEqual(keys.map((key) => [key.time, key.transform]));
  const value = getObjectMotionSnapshot(after, 0.5)[property][axis];
  expect(value).not.toBeCloseTo(base);
  state.replaceProject(JSON.parse(JSON.stringify(useDirectorStore.getState().project)));
  const restored = useDirectorStore.getState().project.objects.find((item) => item.id === object.id)!;
  expect(getObjectMotionSnapshot(restored, 0.5)[property][axis]).toBeCloseTo(value);
});

it.each(TRANSFORM_CHANNELS)("相机 %s 切线接入播放并保持关键帧", (channel) => {
  const state = useDirectorStore.getState();
  const object = state.project.objects.find((item) => item.kind === "camera")!;
  const cameraId = object.linkedCameraId!;
  state.addCameraMotionKeyframe(cameraId, 0);
  state.addCameraMotionKeyframe(cameraId, 1);
  const before = useDirectorStore.getState().project.cameras.find((item) => item.id === cameraId)!;
  const keys = before.motionPath!.keyframes;
  const [property, axis] = channelParts(channel);
  const oldSnapshot = getCameraMotionSnapshot(before, 0.5);
  state.updateCurveTangent(object.id, keys[0].id, channel, { incoming: [-0.2, -2], outgoing: [0.2, 2], linked: true });
  state.replaceProject(JSON.parse(JSON.stringify(useDirectorStore.getState().project)));
  const after = useDirectorStore.getState().project.cameras.find((item) => item.id === cameraId)!;
  expect(after.motionPath!.keyframes.map((key) => [key.time, key.position, key.rotation, key.scale])).toEqual(JSON.parse(JSON.stringify(keys.map((key) => [key.time, key.position, key.rotation, key.scale]))));
  const snapshot = getCameraMotionSnapshot(after, 0.5);
  expect(snapshot[property]![axis]).not.toBeCloseTo(oldSnapshot[property]?.[axis] ?? keys[0].rotation![axis]);
});
