# 3D 导演台代码导航

本文是后续代理和维护者的本地代码地图。它优先记录“从哪里开始查”和“数据如何流动”，不替代产品使用说明。用户操作见根目录 `README.md`，嵌入协议见 `docs/embed-contract.md`，历史交接背景见 `docs/PROJECT-HANDOFF.md`。

## 1. 项目结论

这是一个 React 18、TypeScript、Vite、Three.js、React Three Fiber 和 Zustand 构成的浏览器端 3D 分镜工具。核心能力不是传统视频轨道剪辑，而是把人物、道具和相机在统一的归一化时间轴上记录为空间关键点，再实时采样为 3D 画面或导出视频。

主干分层如下：

| 层 | 作用 | 入口 |
| --- | --- | --- |
| 应用与工作区 | 首页、导演台实例、顶层布局、宿主通信 | `src/App.tsx`、`src/app/layout/DirectorDeskShell.tsx` |
| 3D 视口 | Three.js Canvas、相机快照、渲染、导出 | `src/editor/canvas/DirectorCanvas.tsx` |
| 场景呈现 | 对象、相机路径、轨迹点手柄、变换控件 | `src/editor/canvas/SceneRoot.tsx` |
| 运动 UI | 底部帧标尺、掌镜、轨迹编辑、曲线编辑 | `src/editor/motion/` |
| 属性面板 | 场景、人物、道具、相机属性 | `src/editor/panels/` |
| 状态与命令 | Zustand 状态、撤销、项目变更、本地持久化 | `src/editor/store/directorStore.ts` |
| 数据与算法 | 项目类型、轨迹归一化、计时、插值、目标跟踪 | `src/editor/schema/` |
| 运行时 | 播放进度、人物模型、骨骼目标、防抖 | `src/editor/runtime/` |
| 输入输出 | 截图、视频、项目 JSON、宿主协议 | `src/editor/io/` |

## 2. 启动和状态所有权

入口是 `src/main.tsx -> src/App.tsx -> DirectorDeskShell + DirectorCanvas`。

`src/editor/store/directorStore.ts` 是编辑状态的唯一中心：

- 持久项目：`project`，包含对象、相机、帧数、帧率和相机 `motionPath`。
- 运行时状态：`cameraMotionProgress`、`cameraMotionPlaying`、`selectedCameraKeyframeId(s)`、掌镜状态等。
- 项目变更统一经过 `commitMutation`，自动写入浏览器 `localStorage` 并进入撤销栈。
- 持久化键以 `storyai-3d-director-desk-demo` 为基础；不同导演台实例可带作用域后缀。
- 播放进度、播放中状态和轨迹点选中状态不会写入项目快照，这是有意的运行时状态边界。

注意：这里的“本地持久化”是浏览器存储。本文和根目录 `AGENTS.md` 则是代码库内的本地导航文件。

## 3. 相机轨迹点与帧标尺

### 3.1 用户可见入口

相机轨迹点有三条添加路径，但最后都写入同一份 `camera.motionPath.keyframes`：

| 操作 | UI 入口 | 调用 |
| --- | --- | --- |
| 在底部帧标尺当前帧记录 | `ObjectMotionTransport` 的“记录起点/记录当前位置” | `DirectorCanvas` 提供视口快照，再调用 `addCameraMotionKeyframe(cameraId, progress, snapshot)` |
| 在运镜工作台添加当前视角 | `MotionStudio` 的“添加当前视角” | `recordCameraMotionSnapshot(..., timelineTime)` |
| 掌镜时按 Enter | `CameraPilotController` 采集当前相机 | `DirectorCanvas.recordPilotSnapshot -> recordCameraMotionSnapshot` |

最接近“相机在帧标尺中添加轨迹点”的主链路是：

```text
ObjectMotionTransport
  -> 当前播放头 cameraMotionProgress
  -> onRecordCamera(cameraId)
  -> DirectorCanvas 中读取 viewportCameraSnapshotRef
  -> directorStore.addCameraMotionKeyframe
  -> project.cameras[id].motionPath.keyframes
  -> 自动持久化并触发 UI 重渲染
  -> ObjectMotionTransport 在帧标尺显示点
  -> SceneRoot 在 3D 场景显示路径和手柄
```

### 3.2 帧标尺组件

文件：`src/editor/motion/ObjectMotionTransport.tsx`

关键符号：

- `getRulerTicks`：按当前可见帧范围计算主、次刻度。
- `frameToProgress` / `progressToFrame`：帧数与 `0-1` 时间互转，实现在 `src/editor/schema/frameTime.ts`。
- `recordingCamera`：优先取当前透视相机 `viewportCameraId`，否则取选中相机场景对象的 `linkedCameraId`。
- `onRecordCamera`：将记录动作交给 `DirectorCanvas`，以便拿到视口真实位置、朝向和 FOV。
- `moveCameraWaypointToFrame`：拖动相机点时把目标帧转回归一化时间，并将路径切为 `speedMode: custom`、线性时间曲线。
- `.object-motion-transport__camera-waypoint`：每个相机轨迹点在标尺上的范围输入控件；左键拖动时间，右键删除。
- `.object-motion-transport__ruler-scrubber`：播放头，只修改共享进度，不添加轨迹点。
- `rulerStartFrame` / `rulerEndFrame`：仅控制标尺可见窗口，不裁剪项目轨迹。

标尺上显示的点来自当前 `activeCamera`，并使用 `getCameraMotionTimingPlan(camera).arrivals` 计算实际到达帧。不能简单地假设显示位置总等于 `keyframe.time`：匀速、柔和速度和停留行为会改变到达时间。

### 3.3 视口快照来源

文件：`src/editor/canvas/DirectorCanvas.tsx`

- `viewportCameraSnapshotRef` 保存当前视口相机的 `position`、`target`、`fov`，以及可选的 `rotation`、`scale`。
- 底部记录按钮传入 `onRecordCamera` 后，若当前是相机视角，就把该快照传给 `addCameraMotionKeyframe`。
- `recordPilotSnapshot` 用于掌镜 Enter 记录；若正在编辑已有点，传入 `cameraPilotEditKeyframeId`，否则新增点。
- `ObjectMotionTransport` 在这里挂载，因此若记录按钮拿到的视角不正确，先查这里，而不是先改状态仓库。

### 3.4 状态写入规则

文件：`src/editor/store/directorStore.ts`

主要命令：

| 命令 | 语义 |
| --- | --- |
| `addCameraMotionKeyframe` | 帧标尺式记录；指定时间时按项目帧数取整，同一帧存在点则覆盖该点 |
| `recordCameraMotionSnapshot` | 掌镜/当前视角记录；可更新指定点，也可在当前时间插入并按时间排序 |
| `insertCameraMotionKeyframeAfter` | 在相邻两点中间采样出新点，继承兼容的跟踪设置 |
| `updateCameraMotionKeyframe` | 修改位置、目标、FOV、到达时间、停留或跟踪参数 |
| `deleteCameraMotionKeyframe` | 删除并选择邻近点，停止播放 |
| `moveCameraMotionKeyframe` | 改变点的顺序，并重新均匀分配 `time` |
| `translateSelectedCameraMotionKeyframes` | 批量平移多个点的位置和手动目标 |
| `replaceCameraMotionKeyframes` | 用预设等整批替换轨迹 |
| `updateCameraMotionPath` | 修改时长、循环、插值、速度曲线等路径级属性 |

`addCameraMotionKeyframe` 的关键约束：

1. 先用 `progressToFrame` 再用 `frameToProgress`，保证记录落在整数帧。
2. 以实际到达时间查找同帧点；存在时复用 ID，因此行为是覆盖而非堆叠。
3. 指定帧记录后启用自定义速度和线性时间曲线，保留用户在标尺上的时间意图。
4. 新点通过 `createCameraMotionKeyframe` 建立，随后整条路径经过 `normalizeCameraMotionPath` 排序和约束。
5. 写入后选中新点、把播放头移动到该点并停止播放。

### 3.5 数据结构

文件：`src/editor/schema/directorProject.ts`

`DirectorCameraMotionKeyframe` 是单个轨迹点：

| 字段 | 含义 |
| --- | --- |
| `id` | 跨 UI、存储和协议引用的稳定 ID |
| `time` | `0-1` 归一化时间，不是帧号或秒数 |
| `position` | 相机世界坐标 |
| `target` | 手动注视点，或动态跟踪的回退目标 |
| `fov` | 此点垂直视场角，限制为 5-120 度 |
| `rotation`、`scale` | 可选的相机对象变换，曲线编辑器会使用 |
| `targetMode`、`targetObjectId` | 固定目标或跟踪场景对象 |
| `targetBodyPart` | 人物的语义骨骼部位 |
| `targetFollowMode` | 立即或柔和跟随 |
| `targetStabilizationEnabled` | 是否抑制骨骼动画高频抖动 |
| `pointBehavior`、`holdSeconds` | 经过或在该点停留 |
| `tangents` | 曲线编辑器的通道切线 |

`DirectorCameraMotionPath` 是整条路线，包含 `duration`、`loop`、空间插值、速度模式、贝塞尔速度曲线和 `keyframes`。

### 3.6 归一化、计时与播放

- `src/editor/schema/cameraMotion.ts`
  - `normalizeCameraMotionPath`：处理旧数据、非法值、默认值和按时间排序。
  - `createCameraMotionKeyframe`：由相机快照生成标准点。
  - `getCameraMotionTimingPlan`：把距离、速度模式、停留转成实际到达/离开时间。
  - `getCameraMotionSnapshot`：在任意进度采样位置、目标、FOV、旋转和缩放。
- `src/editor/schema/routeTiming.ts`：相机和人物路线共用的计时算法。
- `src/editor/schema/cameraTarget.ts`：逐点目标、人物运动后目标位置及不同点之间的目标过渡。
- `src/editor/schema/cameraPlayback.ts`：组合轨迹采样、动态跟踪和路径碰撞，形成最终相机快照。
- `src/editor/runtime/cameraBodyTracking.ts`：所有视口和导出共用的跟踪平滑与防抖运行时。
- `src/editor/runtime/playbackRuntime.ts`：高频播放进度；React 状态和渲染循环之间的共享运行时。

### 3.7 轨迹点后续编辑

文件：`src/editor/motion/MotionStudio.tsx`

这里负责相机轨迹的主要编辑体验：

- 添加当前视角、开始掌镜、选择和进入某点调整。
- 在相邻点间插入、删除、前移和后移。
- 批量选择；实际 3D 批量拖动由 `SceneRoot.tsx` 调用 `translateSelectedCameraMotionKeyframes`。
- 修改路径插值、速度、时长、循环、经过/停留。
- 为每个点设置跟踪对象、人物身体部位、响应速度和防抖。
- 应用 `cameraPathTemplates.ts` 的轨迹预设，整批替换为普通可编辑点。

`src/editor/panels/CameraPanel.tsx` 也提供较传统的相机属性入口，可选择轨迹点、编辑位置和 FOV、删除点与预演。修改某一能力时要检查两个入口是否应保持一致。

相机属性页调整 FOV 会切到当前机位视角；轨迹已有点时，调整值会写入当前播放头所在帧（同帧覆盖），侧边栏显示随播放头采样的实际 FOV。焦段预设为全画幅 36×24 毫米的等效焦段，使用 24 毫米画幅高度换算 Three.js 的垂直 FOV，公式和范围位于 `src/editor/schema/cameraGeometry.ts`。焦段是输入预设，项目仍只保存角度值。

### 3.8 3D 场景表现

文件：`src/editor/canvas/SceneRoot.tsx`

- 相机路径按采样点绘制，不直接把关键点用直线简单连接。
- 每个轨迹点有场景手柄，可选中并更新位置。
- 单选显示单点变换控件；多选显示批量变换中心。
- 播放时按当前实际到达时间标记已到达和即将到达的点。

若问题是“数据已添加但场景里不显示”，检查 `showCharacterRoutes`、当前相机、选中状态和 `CameraMotionPathView` 一带；若“标尺不显示”，检查 `showCameraTimeline` 与 `activeCamera`，两者不是同一显示条件。

## 4. 修改任务导航

| 需求 | 最小修改入口 | 同步检查 |
| --- | --- | --- |
| 改帧标尺视觉、刻度、播放头 | `ObjectMotionTransport.tsx`、`objectMotionTransport.css` | `ObjectMotionTransport.test.tsx` |
| 改“当前帧添加点”行为 | `directorStore.ts` 的 `addCameraMotionKeyframe` | `DirectorCanvas.test.tsx`、`directorStore.test.ts` |
| 改掌镜 Enter 记录 | `CameraPilotController.tsx`、`DirectorCanvas.recordPilotSnapshot` | `CameraPilotController.test.tsx` |
| 改同帧覆盖、排序或 ID | `directorStore.ts` | 持久化兼容、撤销、同帧测试 |
| 改轨迹点字段 | `directorProject.ts`、`cameraMotion.ts` | 导入导出、协议、旧项目归一化测试 |
| 改点的到达帧或停留 | `routeTiming.ts`、`cameraMotion.ts` | 标尺显示与 MotionStudio 显示均使用 arrivals |
| 改相机空间路径 | `cameraMotion.ts` | `cameraMotion.test.ts`、场景路径和视频导出 |
| 改目标跟踪或身体部位 | `cameraTarget.ts`、`cameraBodyTracking.ts` | 主视口、监看、成片、导出必须一致 |
| 改轨迹点 3D 拖动 | `SceneRoot.tsx` | 单选、多选、撤销批次 |
| 改预设生成 | `cameraPathTemplates.ts` | `cameraPathTemplates.test.ts` |
| 改项目本地保存 | `directorStore.ts` 的持久化辅助函数和 `commitMutation` | 作用域隔离、旧快照迁移 |

## 5. 测试与验证

优先运行与改动相邻的测试：

```powershell
npx vitest run src/editor/motion/__tests__/ObjectMotionTransport.test.tsx
npx vitest run src/editor/store/__tests__/directorStore.test.ts
npx vitest run src/editor/schema/__tests__/cameraMotion.test.ts
npx vitest run src/editor/schema/__tests__/cameraPlayback.test.ts
npx vitest run src/editor/canvas/__tests__/DirectorCanvas.test.tsx
npm run build
```

相机帧标尺功能的最低人工验收：

1. 选中或切入一个相机视角，把播放头移到指定整数帧。
2. 点击“记录当前位置”，标尺、运镜面板和 3D 场景出现同一个轨迹点。
3. 在同一帧改变视角后再次记录，点数量不增加，位置/FOV 更新，ID 不变。
4. 拖动标尺上的轨迹点，点落到目标帧，顺序正确且播放停止。
5. 右键删除标尺点，三个界面同步消失，撤销可恢复。
6. 刷新页面或重开同一导演台，轨迹仍在；打开另一个导演台实例，不应串场。
7. 至少两个点时，导演视角、第一视角和导出采样结果一致。

## 6. 容易误改的边界

- `activeCameraId`、`viewportCameraId`、选中的相机场景对象并不总是同一个概念。添加点前先确认当前交互需要哪个相机。
- `motionPath.duration` 是相机路线时长；`project.totalFrames / fps` 是项目帧时间基准。现有 UI 通过归一化进度保持对象与相机同步，不要直接混用秒数和帧数。
- 路径归一化会按 `time` 排序。若要保存用户的手工顺序，必须明确它与时间排序的关系。
- `speedMode` 存在时，轨迹点显示帧应优先使用计时计划的 `arrivals`。
- 动态跟踪会覆盖基础采样的 `target`；只修改 `keyframe.target` 不一定改变最终画面。
- 所有相机轨迹写入都应经过状态仓库，以保留撤销、本地持久化、选中状态和播放停止语义。
- 不要为帧标尺另建一份轨迹数组；标尺、运镜工作台、3D 场景和导出必须消费同一份 `camera.motionPath.keyframes`。
