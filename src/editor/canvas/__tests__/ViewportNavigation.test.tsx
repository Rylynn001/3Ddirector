import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3, MOUSE } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ViewportNavigation } from "../ViewportNavigation";
import { createInitialDirectorState, useDirectorStore, type CameraShotSnapshot } from "../../store/directorStore";
import { getCameraViewSnapshotFromShot } from "../../schema/cameraGeometry";
import { setRuntimePlaybackProgress } from "../../runtime/playbackRuntime";

const mock = vi.hoisted(() => ({
  props: {} as { onStart: () => void; onChange: () => void; onEnd: () => void },
  frame: () => {},
}));
const camera = new PerspectiveCamera();
const canvas = document.createElement("canvas");
const gl = { domElement: canvas };
vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera, gl }),
  useFrame: (callback: () => void) => { mock.frame = callback; },
}));
vi.mock("@react-three/drei", async () => {
  const { forwardRef } = await import("react");
  return { OrbitControls: forwardRef((props: typeof mock.props, _ref) => {
    mock.props = props;
    return null;
  }) };
});

beforeEach(() => {
  useDirectorStore.setState({ ...createInitialDirectorState() });
  setRuntimePlaybackProgress(0);
});

it("相机视口移动写回相机，打帧后可播放，返回 persp 恢复自由视口", () => {
  const state = useDirectorStore.getState();
  const shot = state.project.cameras[0];
  const free: CameraShotSnapshot = { position: [10, 8, 12], target: [0, 0, 0], fov: 50 };
  const controls = { target: new Vector3(), update: vi.fn(), mouseButtons: {} };
  const controlsRef = { current: controls as unknown as OrbitControlsImpl };
  let snapshot = free;
  const onFreeChange = vi.fn();
  render(<ViewportNavigation controlsRef={controlsRef} freeSnapshot={free}
    onFreeChange={onFreeChange} onCameraSnapshot={(value) => { snapshot = value; }} disabled={false} />);
  expect(camera.position.toArray()).toEqual(free.position);
  act(() => state.setViewportCamera(shot.id));
  const start = getCameraViewSnapshotFromShot(shot);
  expect(camera.position.toArray()).toEqual(start.position);
  act(() => state.addCameraMotionKeyframe(shot.id, 0, snapshot));
  act(() => state.setCameraMotionProgress(1));
  act(() => {
    mock.props.onStart();
    camera.position.add(new Vector3(4, 2, 0));
    controls.target.add(new Vector3(4, 2, 0));
    mock.props.onChange();
    mock.props.onEnd();
  });
  const edited = useDirectorStore.getState().project.cameras[0];
  expect(edited.transform.position[0]).toBeCloseTo(shot.transform.position[0] + 4);
  expect(edited.transform.position[1]).toBeCloseTo(shot.transform.position[1] + 2);
  expect(onFreeChange).not.toHaveBeenCalled();
  const end = snapshot;
  act(() => state.addCameraMotionKeyframe(shot.id, 1, snapshot));
  act(() => state.setCameraMotionProgress(0));
  expect(camera.position.toArray()).toEqual(start.position);
  act(() => state.setCameraMotionPlaying(true));
  act(() => { setRuntimePlaybackProgress(1); mock.frame(); });
  expect(camera.position.toArray()).toEqual(end.position);
  act(() => state.setViewportCamera(null));
  expect(camera.position.toArray()).toEqual(free.position);
  expect(useDirectorStore.getState().project.cameras[0].motionPath?.keyframes).toHaveLength(2);
});

it("Alt 配合鼠标导航，普通点击保留给选择对象", () => {
  const controls = { target: new Vector3(), update: vi.fn(), mouseButtons: {} };
  render(<ViewportNavigation controlsRef={{ current: controls as unknown as OrbitControlsImpl }}
    freeSnapshot={{ position: [10, 8, 12], target: [0, 0, 0], fov: 50 }}
    onFreeChange={vi.fn()} onCameraSnapshot={vi.fn()} disabled={false} />);
  fireEvent.pointerDown(canvas, { altKey: true });
  expect(controls.mouseButtons).toEqual({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.DOLLY });
  fireEvent.pointerDown(canvas, { altKey: false });
  expect(controls.mouseButtons).toEqual({ LEFT: undefined, MIDDLE: undefined, RIGHT: undefined });
});
