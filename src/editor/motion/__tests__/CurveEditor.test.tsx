import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CurveEditor } from "../CurveEditor";
import { createInitialDirectorState, useDirectorStore } from "../../store/directorStore";
import { getObjectMotionSnapshot } from "../../schema/objectMotion";

beforeEach(() => {
  useDirectorStore.setState({ ...createInitialDirectorState() });
});

it("通道选择、手柄拖动和一次撤销，关键帧位置保持不变", () => {
  const state = useDirectorStore.getState();
  const id = "char_default_a";
  state.selectObject(id);
  state.addObjectMotionKeyframe(id, 0);
  state.updateObjectTransform(id, { position: [3, 0, 0] });
  state.addObjectMotionKeyframe(id, 0.5);
  state.updateObjectTransform(id, { position: [0, 0, 0] });
  state.addObjectMotionKeyframe(id, 1);
  state.setCameraMotionProgress(0.5);
  const before = useDirectorStore.getState().project.objects.find((item) => item.id === id)!;
  render(<CurveEditor onClose={vi.fn()} />);
  const nav = screen.getByRole("navigation", { name: "动画通道" });
  expect(within(nav).getAllByRole("button", { name: /^(平移|旋转|缩放) [XYZ]$/ })).toHaveLength(9);
  fireEvent.click(within(nav).getByRole("button", { name: "平移 X" }));
  expect(screen.queryByRole("button", { name: "平移 Y 第 72 帧关键帧" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "平移 X 第 72 帧关键帧" }));
  const handle = screen.getByRole("button", { name: "入切线手柄" });
  Object.assign(handle, { setPointerCapture: vi.fn() });
  const plot = screen.getByRole("group", { name: "动画曲线，横轴帧数，纵轴通道值" });
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 520, right: 1000, bottom: 520, toJSON: () => ({}) });
  fireEvent.pointerDown(handle, { pointerId: 1 });
  fireEvent.pointerMove(plot, { pointerId: 1, clientX: 340, clientY: 250 });
  fireEvent.pointerUp(plot, { pointerId: 1 });
  const after = useDirectorStore.getState().project.objects.find((item) => item.id === id)!;
  const originalKeys = before.motionPath!.keyframes.map((key) => [key.time, key.transform]);
  expect(after.motionPath!.keyframes.map((key) => [key.time, key.transform])).toEqual(originalKeys);
  expect(getObjectMotionSnapshot(after, 0.25).position[0]).not.toBeCloseTo(getObjectMotionSnapshot(before, 0.25).position[0]);
  const tangent = after.motionPath!.keyframes[1].tangents!["position.x"]!;
  expect(tangent.incoming[1] / tangent.incoming[0]).toBeCloseTo(tangent.outgoing[1] / tangent.outgoing[0]);
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.5);
  act(() => state.undo());
  const restored = useDirectorStore.getState().project.objects.find((item) => item.id === id)!;
  expect(restored.motionPath!.keyframes[1].tangents).toBeUndefined();
});

it("没有关键帧时显示提示，Escape 关闭编辑器", () => {
  const onClose = vi.fn();
  render(<CurveEditor onClose={onClose} />);
  expect(screen.getByText("请先在场景层级中选择物体或相机。")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
