import { describe, it, expect, beforeEach } from "vitest";
import { useDirectorStore } from "../directorStore";
import { createInitialDirectorState } from "../directorStore";

describe("播放区间 (In/Out 点)", () => {
  beforeEach(() => {
    useDirectorStore.setState(createInitialDirectorState());
  });

  it("应该能设置 In 点", () => {
    const { setPlaybackInPoint } = useDirectorStore.getState();
    setPlaybackInPoint(0.25);
    expect(useDirectorStore.getState().playbackInPoint).toBe(0.25);
  });

  it("应该能设置 Out 点", () => {
    const { setPlaybackOutPoint } = useDirectorStore.getState();
    setPlaybackOutPoint(0.75);
    expect(useDirectorStore.getState().playbackOutPoint).toBe(0.75);
  });

  it("应该能单独清除 In 点", () => {
    const { setPlaybackInPoint, setPlaybackOutPoint } = useDirectorStore.getState();
    setPlaybackInPoint(0.3);
    setPlaybackOutPoint(0.8);

    setPlaybackInPoint(null);
    expect(useDirectorStore.getState().playbackInPoint).toBeNull();
    expect(useDirectorStore.getState().playbackOutPoint).toBe(0.8);
  });

  it("应该能单独清除 Out 点", () => {
    const { setPlaybackInPoint, setPlaybackOutPoint } = useDirectorStore.getState();
    setPlaybackInPoint(0.3);
    setPlaybackOutPoint(0.8);

    setPlaybackOutPoint(null);
    expect(useDirectorStore.getState().playbackInPoint).toBe(0.3);
    expect(useDirectorStore.getState().playbackOutPoint).toBeNull();
  });

  it("应该能清除整个播放区间", () => {
    const { setPlaybackInPoint, setPlaybackOutPoint, clearPlaybackRange } = useDirectorStore.getState();
    setPlaybackInPoint(0.3);
    setPlaybackOutPoint(0.8);
    expect(useDirectorStore.getState().playbackInPoint).toBe(0.3);
    expect(useDirectorStore.getState().playbackOutPoint).toBe(0.8);

    clearPlaybackRange();
    expect(useDirectorStore.getState().playbackInPoint).toBeNull();
    expect(useDirectorStore.getState().playbackOutPoint).toBeNull();
  });

  it("重启播放应该从 In 点开始", () => {
    const { setPlaybackInPoint, restartCameraMotionPlayback } = useDirectorStore.getState();
    setPlaybackInPoint(0.4);
    restartCameraMotionPlayback();
    expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.4);
    expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);
  });

  it("没有设置 In 点时应该从 0 开始", () => {
    const { clearPlaybackRange, restartCameraMotionPlayback } = useDirectorStore.getState();
    clearPlaybackRange();
    restartCameraMotionPlayback();
    expect(useDirectorStore.getState().cameraMotionProgress).toBe(0);
    expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);
  });
});
