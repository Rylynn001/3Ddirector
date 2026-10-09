# 播放区间功能 (In/Out 点)

## 功能概述

在帧标尺中使用键盘快捷键 `I` 和 `O` 标记播放区间，播放时只在该区间内循环。

## 使用方法

### 设置区间

1. 将播放头移动到想要开始的位置
2. 按 `I` 键设置 **In 点**（区间起点）
3. 将播放头移动到想要结束的位置
4. 按 `O` 键设置 **Out 点**（区间终点）

### 清除区间

- **单独清除 In 点**：按 `Alt + I`
- **单独清除 Out 点**：按 `Alt + O`
- **同时清除 In/Out 点**：按 `Alt + X` 或点击"清除区间"按钮

### 播放行为

- **未设置区间**：从 0 播放到 1（全时间轴）
- **设置区间后**：
  - 播放只在 In 和 Out 之间循环
  - 点击"从起点播放"按钮会从 In 点开始
  - 播放到 Out 点后：
    - 如果开启循环：跳回 In 点继续
    - 如果未开启循环：停在 Out 点

## 键盘快捷键

| 快捷键 | 功能 |
| --- | --- |
| `I` | 在当前位置设置 In 点 |
| `O` | 在当前位置设置 Out 点 |
| `Alt + I` | 清除 In 点 |
| `Alt + O` | 清除 Out 点 |
| `Alt + X` | 同时清除 In 和 Out 点 |

## 视觉标识

- **In 点**：蓝色竖线，标记 "I"
- **Out 点**：红色竖线，标记 "O"
- **区间高亮**：In 和 Out 之间显示半透明蓝色背景

## 技术实现

### 状态管理

```typescript
// directorStore.ts
export interface DirectorInternalState {
  playbackInPoint: number | null;    // In 点位置 (0-1)
  playbackOutPoint: number | null;   // Out 点位置 (0-1)
  // ...
}
```

### API

```typescript
setPlaybackInPoint(progress: number | null): void
setPlaybackOutPoint(progress: number | null): void
clearPlaybackRange(): void
```

### 播放逻辑

播放循环在 `DirectorCanvas.tsx` 中实现，自动处理区间：

```typescript
const inPoint = state.playbackInPoint ?? 0;
const outPoint = state.playbackOutPoint ?? 1;
const rangeStart = Math.min(inPoint, outPoint);
const rangeEnd = Math.max(inPoint, outPoint);
```

### 键盘事件

在 `ObjectMotionTransport.tsx` 中监听：

```typescript
if (event.code === "KeyI") {
  if (event.altKey) {
    setPlaybackInPoint(null);  // 清除 In 点
  } else {
    setPlaybackInPoint(progress);  // 设置 In 点
  }
} else if (event.code === "KeyO") {
  if (event.altKey) {
    setPlaybackOutPoint(null);  // 清除 Out 点
  } else {
    setPlaybackOutPoint(progress);  // 设置 Out 点
  }
} else if (event.code === "KeyX" && event.altKey) {
  clearPlaybackRange();  // 清除整个区间
}
```

## 注意事项

1. In/Out 点值为归一化进度 (0-1)，不是帧数
2. 区间状态不持久化到项目文件（运行时状态）
3. 播放区间与相机轨迹点独立，可以任意设置
4. 区间可以逆序设置（Out 在 In 之前），系统会自动处理
5. 可以只设置 In 点或只设置 Out 点，未设置的端点使用默认值（0 或 1）

## 测试

运行测试：

```bash
npx vitest run src/editor/store/__tests__/playbackRange.test.ts
```

覆盖场景：
- 设置 In 点
- 设置 Out 点
- 单独清除 In 点
- 单独清除 Out 点
- 清除整个区间
- 从 In 点重启播放
- 无区间时从 0 开始
