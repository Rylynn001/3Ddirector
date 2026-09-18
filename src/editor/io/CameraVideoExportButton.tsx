import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDirectorStore } from "../store/directorStore";
import { downloadReferenceVideo, requestReferenceVideoExport, type ReferenceVideoExportQuality } from "./referenceVideoExport";
import "./cameraVideoExport.css";

export function CameraVideoExportButton({ cameraId, compact = false }: { cameraId?: string; compact?: boolean }) {
  const cameras = useDirectorStore((state) => state.project.cameras);
  const fps = useDirectorStore((state) => state.project.fps);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<ReferenceVideoExportQuality>("1080p");
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const selected = cameras.filter((camera) => cameraId ? camera.id === cameraId : !camera.isVirtual);
  const label = cameraId ? `导出 ${selected[0]?.name ?? "机位"}` : "导出全部";

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [open]);

  async function exportVideos() {
    if (controller.current || !selected.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setExporting(true);
    try {
      for (const [index, camera] of selected.entries()) {
        abort.signal.throwIfAborted();
        setStatus(`正在导出 ${index + 1}/${selected.length}：${camera.name}`);
        const result = await requestReferenceVideoExport({
          cameraId: camera.id,
          fileName: `${String(index + 1).padStart(2, "0")}-${camera.name.replace(/[\\/:*?"<>|]/g, "_")}`,
          fps,
          quality,
          signal: abort.signal,
        });
        abort.signal.throwIfAborted();
        downloadReferenceVideo(result);
      }
      setStatus(`已导出 ${selected.length} 个机位视频`);
    } catch (error) {
      setStatus(abort.signal.aborted ? "已取消导出，已完成的视频予以保留" : error instanceof Error ? error.message : "视频导出失败");
    } finally {
      controller.current = null;
      setExporting(false);
    }
  }

  return <>
    <button type="button" className={compact ? "object-flag-button object-icon-flag-button camera-video-export-compact" : "top-bar-action-button camera-video-export-trigger"}
      aria-label={label} title={`${label} MP4`} disabled={!selected.length}
      onClick={(event) => { event.stopPropagation(); setStatus(""); setOpen(true); }}>
      <Download aria-hidden="true" size={15} />{!compact && <span>{cameraId ? "导出视频" : label}</span>}
    </button>
    {open && createPortal(<div className="camera-video-export-backdrop" onClick={(event) => event.stopPropagation()}>
      <div className="camera-video-export-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={dialog}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { if (exporting) controller.current?.abort(); else setOpen(false); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)")];
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <header><strong>{label}</strong><button type="button" aria-label="关闭视频导出" disabled={exporting} onClick={() => setOpen(false)}><X size={16} /></button></header>
        <p>{cameraId ? selected[0]?.name : `全部 ${selected.length} 个机位，按名称分别下载`} · MP4</p>
        <label>画质<select aria-label="导出视频画质" disabled={exporting} value={quality} onChange={(event) => setQuality(event.target.value as ReferenceVideoExportQuality)}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
        <p>使用项目帧率（{fps} 帧/秒）和完整帧范围。</p>
        {status && <output role="status">{status}</output>}
        <footer>{exporting ? <button type="button" onClick={() => controller.current?.abort()}>取消导出</button> : <button type="button" disabled={!selected.length} onClick={() => void exportVideos()}>导出 MP4</button>}</footer>
      </div>
    </div>, document.body)}
  </>;
}
