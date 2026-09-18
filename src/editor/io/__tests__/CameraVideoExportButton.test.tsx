import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CameraVideoExportButton } from "../CameraVideoExportButton";
import { createInitialDirectorState, useDirectorStore } from "../../store/directorStore";
import { downloadReferenceVideo, requestReferenceVideoExport } from "../referenceVideoExport";

vi.mock("../referenceVideoExport", () => ({
  requestReferenceVideoExport: vi.fn(),
  downloadReferenceVideo: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  const state = createInitialDirectorState();
  const first = state.project.cameras[0];
  useDirectorStore.setState({ ...state, project: { ...state.project, cameras: [
    { ...first, id: "one", name: "机位01" },
    { ...first, id: "two", name: "机位02" },
    { ...first, id: "virtual", name: "虚拟机位", isVirtual: true },
  ] } });
  vi.mocked(requestReferenceVideoExport).mockImplementation(async (request) => ({
    blob: new Blob([request.cameraId!]), fileName: request.fileName, durationSeconds: 6,
    height: 1080, width: 1920, mimeType: "video/mp4",
  }));
});

it("单机位导出明确指定相机，不改变当前选择", async () => {
  const activeId = useDirectorStore.getState().project.activeCameraId;
  render(<CameraVideoExportButton cameraId="two" />);
  fireEvent.click(screen.getByRole("button", { name: "导出 机位02" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 MP4" }));
  await waitFor(() => expect(downloadReferenceVideo).toHaveBeenCalledOnce());
  expect(requestReferenceVideoExport).toHaveBeenCalledWith(expect.objectContaining({ cameraId: "two", fps: 24, quality: "1080p" }));
  expect(useDirectorStore.getState().project.activeCameraId).toBe(activeId);
});

it("全部导出依次等待每个机位完成，排除虚拟机位", async () => {
  let finishFirst!: () => void;
  vi.mocked(requestReferenceVideoExport).mockImplementationOnce((request) => new Promise((resolve) => {
    finishFirst = () => resolve({ blob: new Blob(["one"]), fileName: request.fileName, durationSeconds: 6, height: 720, width: 1280, mimeType: "video/mp4" });
  }));
  render(<CameraVideoExportButton />);
  fireEvent.click(screen.getByRole("button", { name: "导出全部" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 MP4" }));
  expect(requestReferenceVideoExport).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("1/2：机位01");
  finishFirst();
  await waitFor(() => expect(downloadReferenceVideo).toHaveBeenCalledTimes(2));
  expect(vi.mocked(requestReferenceVideoExport).mock.calls.map(([request]) => request.cameraId)).toEqual(["one", "two"]);
  expect(screen.getByRole("status")).toHaveTextContent("已导出 2 个机位视频");
});

it("失败时显示原因并允许重试", async () => {
  vi.mocked(requestReferenceVideoExport).mockRejectedValueOnce(new Error("视频录制失败"));
  render(<CameraVideoExportButton />);
  fireEvent.click(screen.getByRole("button", { name: "导出全部" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 MP4" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("视频录制失败"));
  expect(downloadReferenceVideo).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "导出 MP4" })).toBeEnabled();
});

it("取消时通知录制器停止并且不启动下一个机位", async () => {
  vi.mocked(requestReferenceVideoExport).mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new DOMException("取消", "AbortError")), { once: true });
  }));
  render(<CameraVideoExportButton />);
  fireEvent.click(screen.getByRole("button", { name: "导出全部" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 MP4" }));
  fireEvent.click(screen.getByRole("button", { name: "取消导出" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已取消导出"));
  expect(requestReferenceVideoExport).toHaveBeenCalledTimes(1);
  expect(downloadReferenceVideo).not.toHaveBeenCalled();
});
