/**
 * 帧时间转换工具
 *
 * 内部使用归一化时间(0-1),外部使用帧数
 */

export const DEFAULT_FPS = 24;
export const DEFAULT_TOTAL_FRAMES = 144;

/**
 * 帧数转归一化时间 (0-1)
 */
export function frameToProgress(frame: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0;
  return Math.max(0, Math.min(1, frame / totalFrames));
}

/**
 * 归一化时间转帧数
 */
export function progressToFrame(progress: number, totalFrames: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * totalFrames);
}

/**
 * 秒数转帧数
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * 帧数转秒数
 */
export function framesToSeconds(frames: number, fps: number): number {
  if (fps <= 0) return 0;
  return frames / fps;
}

/**
 * 格式化帧数显示
 */
export function formatFrame(frame: number): string {
  return `${Math.round(frame)}`;
}
