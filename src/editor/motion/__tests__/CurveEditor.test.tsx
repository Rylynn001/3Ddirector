import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CurveEditor } from "../CurveEditor";
import { createInitialDirectorState, useDirectorStore } from "../../store/directorStore";
import { getObjectMotionSnapshot } from "../../schema/objectMotion";

beforeEach(() => {
  useDirectorStore.setState({ ...createInitialDirectorState() });
});

it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])("%s 循环切换对象，同步曲线并保留当前帧和透视相机", (key) => {
  const state = useDirectorStore.getState();
  const character = state.project.objects.find((item) => item.kind === "character")!;
  const camera = state.project.objects.find((item) => item.kind === "camera")!;
  useDirectorStore.setState({ project: { ...state.project, objects: [character, camera] } });
  state.addObjectMotionKeyframe(character.id, 0.25);
  state.addCameraMotionKeyframe(camera.linkedCameraId!, 0.75);
  state.setViewportCamera(camera.linkedCameraId!);
  state.selectObject(character.id);
  state.setCameraMotionProgress(0.5);
  const before = useDirectorStore.getState().project;
  render(<CurveEditor onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "平移 X 第 36 帧关键帧" }));
  const handle = screen.getByRole("button", { name: "入切线手柄" });
  handle.focus();
  fireEvent.keyDown(handle, { key });
  expect(useDirectorStore.getState().selectedObjectId).toBe(camera.id);
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.5);
  expect(useDirectorStore.getState().viewportCameraId).toBe(camera.linkedCameraId);
  expect(screen.getByRole("navigation")).toHaveTextContent(camera.name);
  expect(screen.getByRole("button", { name: "平移 X 第 108 帧关键帧" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "入切线手柄" })).not.toBeInTheDocument();
  expect(dialog).toHaveFocus();
  fireEvent.keyDown(dialog, { key });
  expect(useDirectorStore.getState().selectedObjectId).toBe(character.id);
  expect(screen.getByRole("button", { name: "平移 X 第 36 帧关键帧" })).toBeInTheDocument();
  expect(useDirectorStore.getState().project.objects).toEqual(before.objects);
  expect(useDirectorStore.getState().project.cameras).toEqual(before.cameras);
});

it("未选中时从首个对象开始，方向键不会在编辑器之外触发", () => {
  const state = useDirectorStore.getState();
  state.selectObject(null);
  const { unmount } = render(<CurveEditor onClose={vi.fn()} />);
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useDirectorStore.getState().selectedObjectId).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(useDirectorStore.getState().selectedObjectId).toBe(state.project.objects[0].id);
  unmount();
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useDirectorStore.getState().selectedObjectId).toBe(state.project.objects[0].id);
});

it("左右与上下按相同方向遍历，并跳过全景对象", () => {
  const state = useDirectorStore.getState();
  const character = state.project.objects.find((item) => item.kind === "character")!;
  const camera = state.project.objects.find((item) => item.kind === "camera")!;
  const prop = { ...character, id: "prop", kind: "prop" as const, name: "道具" };
  const panorama = { ...character, id: "panorama", kind: "panorama" as const };
  useDirectorStore.setState({ project: { ...state.project, objects: [character, panorama, camera, prop] } });
  state.selectObject(character.id);
  render(<CurveEditor onClose={vi.fn()} />);
  for (const [key, id] of [["ArrowRight", camera.id], ["ArrowDown", prop.id], ["ArrowRight", character.id], ["ArrowLeft", prop.id], ["ArrowUp", camera.id]]) {
    fireEvent.keyDown(screen.getByRole("dialog"), { key });
    expect(useDirectorStore.getState().selectedObjectId).toBe(id);
  }
});

it("修饰键和输入框保留自己的方向键行为", () => {
  const state = useDirectorStore.getState();
  state.selectObject("char_default_a");
  render(<CurveEditor onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog");
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
    fireEvent.keyDown(dialog, { key: "ArrowRight", [modifier]: true });
    expect(useDirectorStore.getState().selectedObjectId).toBe("char_default_a");
  }
  const input = document.createElement("input");
  input.type = "number";
  dialog.appendChild(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(useDirectorStore.getState().selectedObjectId).toBe("char_default_a");
  input.remove();
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
  fireEvent.pointerMove(plot, { pointerId: 1, clientX: 340, clientY: 100 });
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


it("滚轮围绕指针缩放，中键平移画布，不修改关键帧", () => {
  const state = useDirectorStore.getState();
  state.selectObject("char_default_a");
  state.addObjectMotionKeyframe("char_default_a", 0);
  state.updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  state.addObjectMotionKeyframe("char_default_a", 0.5);
  const before = useDirectorStore.getState().project.objects[0].motionPath;
  render(<CurveEditor onClose={vi.fn()} />);
  const plot = screen.getByRole("group", { name: "动画曲线，横轴帧数，纵轴通道值" });
  Object.assign(plot, { setPointerCapture: vi.fn() });
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 520, right: 1000, bottom: 520, toJSON: () => ({}) });
  const key = screen.getByRole("button", { name: "平移 X 第 72 帧关键帧" });
  const startKey = screen.getByRole("button", { name: "平移 X 第 0 帧关键帧" });
  const position = () => key.getAttribute("transform")!.match(/[-\d.]+/g)!.map(Number);
  const [x, y] = position();
  const startTransform = startKey.getAttribute("transform");
  fireEvent.wheel(plot, { deltaY: -160, clientX: x, clientY: y });
  expect(position()[0]).toBeCloseTo(x);
  expect(position()[1]).toBeCloseTo(y);
  expect(startKey.getAttribute("transform")).not.toBe(startTransform);
  fireEvent.pointerDown(plot, { button: 1, pointerId: 1, clientX: 400, clientY: 250 });
  fireEvent.pointerMove(plot, { pointerId: 1, clientX: 430, clientY: 270 });
  fireEvent.pointerUp(plot, { pointerId: 1 });
  expect(position()[0]).toBeCloseTo(x + 30);
  expect(position()[1]).toBeCloseTo(y + 20);
  expect(useDirectorStore.getState().project.objects[0].motionPath).toEqual(before);
  expect(screen.queryByRole("button", { name: "放大曲线" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "适配曲线" }));
  expect(position()[0]).toBeGreaterThan(0);
  expect(position()[0]).toBeLessThan(1000);
});
