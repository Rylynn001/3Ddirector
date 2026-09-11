import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../../store/directorStore";
import { getRulerTicks, ObjectMotionTransport } from "../ObjectMotionTransport";

beforeEach(() => {
  const initialState = createInitialDirectorState();
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initialState,
    cameraMotionProgress: 0,
    cameraMotionPlaying: false,
    cameraPilotMode: "idle",
  });
});

it("shows a complete, accessible transport in the regular editor", () => {
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
    cameraMotionProgress: 0.25,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: { ...camera.motionPath!, duration: 8 },
      })),
    },
  });

  render(<ObjectMotionTransport />);

  expect(screen.getByRole("region", { name: "人物和道具动作播放条" })).toBeInTheDocument();
  expect(screen.getByLabelText("当前动作对象")).toHaveTextContent("角色01");
  expect(screen.getByRole("button", { name: "回到动作开头" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "还没有可播放的人物和物品动作" })).toBeDisabled();
  expect(screen.getByRole("slider", { name: "帧标尺播放头" })).toHaveValue("36");
  expect(screen.queryByLabelText("当前动作时间")).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: "动作总时长（秒）" })).not.toBeInTheDocument();
  expect(screen.queryByRole("slider", { name: "场景动作时间轴" })).not.toBeInTheDocument();
  expect(screen.getByText("路线点、每段动作和朝向请在右侧“路线”页编辑")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除角色01当前路线点" })).toBeDisabled();
});

it("keeps seconds out of the bottom transport", () => {
  render(<ObjectMotionTransport />);

  expect(screen.queryByLabelText("项目总时长")).not.toBeInTheDocument();
  expect(screen.queryByText("当前动作时间")).not.toBeInTheDocument();
});

it("shows a frame ruler and updates its range and frame rate", () => {
  render(<ObjectMotionTransport />);

  expect(screen.getByRole("region", { name: "帧数标尺" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "帧标尺播放头" })).toHaveValue("0");
  expect(screen.getByRole("spinbutton", { name: "动作总帧数" })).toHaveValue(144);
  expect(screen.getByRole("combobox", { name: "项目帧率" })).toHaveValue("24");
  fireEvent.change(screen.getByRole("slider", { name: "标尺起始帧" }), { target: { value: "20" } });
  fireEvent.change(screen.getByRole("slider", { name: "标尺结束帧" }), { target: { value: "100" } });
  expect(screen.getByText("20 - 100 / 144 帧")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("combobox", { name: "项目帧率" }), { target: { value: "30" } });
  expect(useDirectorStore.getState().project.fps).toBe(30);
  expect(screen.getAllByRole("slider")).toHaveLength(3);
});

it("keeps intermediate ruler ticks when the visible range starts at a non-round frame", () => {
  const ticks = getRulerTicks(14, 144);
  expect(ticks.map((tick) => tick.frame)).toEqual(expect.arrayContaining([14, 20, 30, 40, 140, 144]));
  expect(ticks.filter((tick) => tick.major).length).toBeGreaterThan(4);
});

it("shows camera waypoints on the ruler and moves a waypoint to an exact frame", () => {
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    cameraMotionPlaying: true,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: {
          duration: 6,
          loop: false,
          interpolation: "linear",
          easing: "linear",
          speedMode: "uniform",
          keyframes: [
            { id: "point_1", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "point_2", time: 0.5, position: [1, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "point_3", time: 1, position: [10, 2, 8], target: [0, 1, 0], fov: 50 },
          ],
        },
      })),
    },
  });

  render(<ObjectMotionTransport />);

  const marker = screen.getByRole("slider", { name: "轨迹点 2 帧位置" });
  expect(marker).toHaveValue("14");
  fireEvent.change(marker, { target: { value: "48" } });

  const nextState = useDirectorStore.getState();
  const path = nextState.project.cameras[0].motionPath!;
  expect(path.keyframes.find((keyframe) => keyframe.id === "point_2")?.time).toBeCloseTo(48 / 144);
  expect(path.speedMode).toBe("custom");
  expect(path.customEasing).toEqual([0, 0, 1, 1]);
  expect(nextState.selectedCameraKeyframeId).toBe("point_2");
  expect(nextState.cameraMotionProgress).toBeCloseTo(48 / 144);
  expect(nextState.cameraMotionPlaying).toBe(false);
});

it("plays and scrubs a camera-only shot, pausing as soon as the timeline is dragged", async () => {
  const user = userEvent.setup();
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    cameraMotionPlaying: true,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: {
          ...camera.motionPath!,
          keyframes: [
            { id: "shot_1", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "shot_2", time: 1, position: [4, 2, 4], target: [0, 1, 0], fov: 50 },
          ],
        },
      })),
    },
  });

  render(<ObjectMotionTransport />);

  const timeline = screen.getByRole("slider", { name: "帧标尺播放头" });
  fireEvent.change(timeline, { target: { value: "60" } });
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
  expect(useDirectorStore.getState().cameraMotionProgress).toBeCloseTo(60 / 144);

  await user.click(screen.getByRole("button", { name: "播放人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);
});

it("lets users drag either visible route track to pause and seek the shared time", () => {
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    cameraMotionPlaying: true,
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: {
          ...camera.motionPath!,
          keyframes: [
            { id: "shot_1", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "shot_2", time: 1, position: [4, 2, 4], target: [0, 1, 0], fov: 50 },
          ],
        },
      })),
      objects: state.project.objects.map((object) => object.id === "char_default_a"
        ? {
            ...object,
            motionPath: {
              interpolation: "linear",
              keyframes: [
                { id: "route_1", time: 0, transform: object.transform },
                { id: "route_2", time: 1, transform: { ...object.transform, position: [4, 0, 0] } },
              ],
            },
          }
        : object),
    },
  });

  render(<ObjectMotionTransport />);

  fireEvent.change(screen.getByRole("slider", { name: "拖动镜头时间轴" }), { target: { value: "0.3" } });
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.3);

  useDirectorStore.getState().setCameraMotionPlaying(true);
  fireEvent.change(screen.getByRole("slider", { name: "拖动人物时间轴" }), { target: { value: "0.72" } });
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.72);
});

it("keeps character route editing out of the playback transport", () => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
  });

  render(<ObjectMotionTransport />);

  expect(screen.queryByRole("button", { name: /记录起点|记录当前位置/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除角色01当前路线点" })).toBeDisabled();
  expect(screen.getByText("路线点、每段动作和朝向请在右侧“路线”页编辑")).toBeInTheDocument();
});

it("controls global action playback and rewinds before replaying from the end", async () => {
  const user = userEvent.setup();
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 0);
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 1);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    cameraMotionProgress: 1,
  });

  render(<ObjectMotionTransport />);

  await user.click(screen.getByRole("button", { name: "播放人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0);
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);

  await user.click(screen.getByRole("button", { name: "暂停人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);

  useDirectorStore.getState().setCameraMotionProgress(0.6);
  await user.click(screen.getByRole("button", { name: "回到动作开头" }));
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0);
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
});

it("shows only the compact playback controls while piloting", () => {
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 0);
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 1);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    cameraPilotMode: "pilot",
    cameraMotionProgress: 0.5,
  });

  render(<ObjectMotionTransport />);

  expect(screen.getByRole("region", { name: "掌镜人物和道具动作播放条" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "播放人物和物品动作" })).toBeInTheDocument();
  expect(screen.getByLabelText("当前帧")).toHaveTextContent("72");
  expect(screen.getByLabelText("空格键播放或暂停")).toHaveTextContent("空格播放/暂停");
  expect(screen.queryByRole("slider", { name: "场景动作时间轴" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /记录起点|记录当前位置/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "回到动作开头" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("镜头与对象移动停留时间轴")).not.toBeInTheDocument();
});

it("shows camera and character move-hold spans on the shared bottom timeline", () => {
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: {
          ...camera.motionPath!,
          duration: 10,
          interpolation: "linear",
          speedMode: "uniform",
          keyframes: [
            { id: "camera_start", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "camera_hold", time: 0.5, position: [5, 2, 8], target: [0, 1, 0], fov: 50, pointBehavior: "hold", holdSeconds: 2 },
            { id: "camera_end", time: 1, position: [10, 2, 8], target: [0, 1, 0], fov: 50 },
          ],
        },
      })),
      objects: state.project.objects.map((object) => object.id === "char_default_a"
        ? {
            ...object,
            motionPath: {
              interpolation: "linear",
              speedMode: "uniform",
              keyframes: [
                { id: "actor_start", time: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
                { id: "actor_hold", time: 0.5, transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, pointBehavior: "hold", holdSeconds: 1 },
                { id: "actor_end", time: 1, transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
              ],
            },
          }
        : object),
    },
  });

  render(<ObjectMotionTransport />);

  expect(screen.getByLabelText("镜头与对象移动停留时间轴")).toBeInTheDocument();
  expect(screen.getByTitle(/镜头停留第 .*帧至第 .*帧/)).toBeInTheDocument();
  expect(screen.getByTitle(/角色01停留第 .*帧至第 .*帧/)).toBeInTheDocument();
});

it("keeps recording actions disabled until a character or prop is selected", () => {
  render(<ObjectMotionTransport />);

  expect(screen.getByLabelText("当前动作对象")).toHaveTextContent("请先选中人物或道具");
  expect(screen.getByRole("button", { name: "记录人物或道具动作点" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除当前动作点" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "动作点" })).toHaveTextContent("选择对象后记录动作");
});
