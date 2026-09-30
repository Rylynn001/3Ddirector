# 项目代理导航

修改代码前，先阅读 [`docs/AGENT-CODE-NAVIGATION.md`](docs/AGENT-CODE-NAVIGATION.md)。该文档包含项目结构、核心数据流、常见修改入口和验证命令。

## 快速菜单

| 任务 | 首要入口 |
| --- | --- |
| 相机在帧标尺中添加、覆盖、拖动或删除轨迹点 | `docs/AGENT-CODE-NAVIGATION.md` 的“相机轨迹点与帧标尺” |
| 掌镜模式、WASD、Enter 记录 | `src/editor/motion/CameraPilotController.tsx`、`src/editor/canvas/DirectorCanvas.tsx` |
| 轨迹点编辑、插入、排序、批量移动、跟踪目标 | `src/editor/motion/MotionStudio.tsx` |
| 相机轨迹状态变更与本地持久化 | `src/editor/store/directorStore.ts` |
| 轨迹数据结构、归一化与插值采样 | `src/editor/schema/directorProject.ts`、`src/editor/schema/cameraMotion.ts` |
| 3D 轨迹线、轨迹点手柄与场景内拖动 | `src/editor/canvas/SceneRoot.tsx` |
| 相机预演、跟踪、防抖和导出画面 | `src/editor/schema/cameraPlayback.ts`、`src/editor/runtime/cameraBodyTracking.ts`、`src/editor/canvas/DirectorCanvas.tsx` |
| iframe / `postMessage` 接口 | `src/editor/io/extensionProtocol.ts`、`docs/embed-contract.md` |

## 修改约束

- 先沿文档中的调用链确认数据源，再修改 UI。
- 相机和人物共用 `cameraMotionProgress`，不要另建一套时间轴状态。
- 帧标尺显示帧数，项目数据保存 `0-1` 归一化时间；统一使用 `src/editor/schema/frameTime.ts` 转换。
- 相机轨迹的持久数据在 `project.cameras[].motionPath`；选中项、播放状态等运行时状态不持久化。
- 优先补充离改动最近的测试，至少运行定向测试和 `npm run build`。

