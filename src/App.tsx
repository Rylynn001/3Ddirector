import "./styles/index.css";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, BookOpen, Boxes, Check, Clock3, House, Keyboard, MousePointer2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { DirectorDeskShell } from "./app/layout/DirectorDeskShell";
import { DirectorCanvas } from "./editor/canvas/DirectorCanvas";
import {
  DIRECTOR_DESK_SESSION_OPENED_EVENT,
  initDirectorDeskHostBridge,
  postDirectorDeskCapturesToHost,
  postDirectorDeskMessageToHost,
} from "./editor/io/hostBridge";
import { useDirectorStore } from "./editor/store/directorStore";
import {
  createDirectorDeskRecord,
  deleteDirectorDeskRecord,
  ensureDirectorDeskRecordForId,
  ensureDirectorDeskRecords,
  getInitialDirectorDeskId,
  touchDirectorDeskRecord,
  writeActiveDirectorDeskId,
  writeDirectorDeskRecords,
  type DirectorDeskRecord,
} from "./editor/workspaces/directorDeskRegistry";
import {
  createPerformanceBenchmarkProject,
  getPerformanceBenchmarkSceneConfig,
  getPerformanceBenchmarkMode,
  getPerformanceBenchmarkPlayback,
} from "./editor/performance/performanceBenchmark";
import { getBenchmarkPerformanceProfile } from "./editor/performance/performanceProfiles";

type AppScreen = "home" | "editor";

const HOME_QUICK_START_STEPS = [
  ["打开导演台", "选择已有导演台，或点击“新建导演台”创建一个独立保存的场景。"],
  ["添加并选中对象", "使用视口上方工具栏添加角色、模型或机位；从左侧场景层级或画布中选中要编辑的对象。"],
  ["调整场景", "选择移动、旋转或缩放工具后拖动画布中的三轴控件，也可以在右侧属性面板直接输入精确数值。"],
  ["记录运动", "拖动底部时间轴到目标帧，调整人物、道具或摄像机，再点击“记录起点”或“记录当前位置”；至少记录两个点。"],
  ["预演并导出", "使用底部播放按钮检查整段运动；选中摄像机可在右侧“轨迹”页预演，确认后从顶部或摄像机属性中导出视频。"],
] as const;

const HOME_RELEASE_NOTES = [
  "人物路线支持添加、插入、删除和拖动，行走时会沿平滑曲线自然转向",
  "人物路线与摄影机轨迹可常亮显示，并支持批量移动多个轨迹点",
  "新增路径碰撞开关，可让人物贴地，并阻止人物和镜头穿过场景物体",
  "看成片时可随时暂停和拖动底部时间轴，不会再退出第一视角预览",
  "主成片 FOV 与监看小窗 FOV 已分开设置，导出使用主成片 FOV",
  "新增可拖动实时监看小窗、MP4 参考视频导出和更可靠的撤销逻辑",
] as const;

const HOME_CONTROL_GROUPS = [
  {
    title: "查看画布",
    description: "按住 Alt；macOS 使用 Option",
    controls: [
      ["Alt / Option + 左键拖动", "环绕观察场景"],
      ["Alt / Option + 中键拖动", "平移观察中心"],
      ["Alt / Option + 右键拖动", "靠近或远离场景"],
      ["滚轮", "靠近 / 远离场景"],
      ["右上角坐标控件", "切换前、后、左、右、上、下视图"],
    ],
  },
  {
    title: "选择与编辑",
    description: "场景层级、画布和属性面板保持同步",
    controls: [
      ["单击对象或场景树条目", "选中并打开对应的右侧属性"],
      ["单击画布空白处", "打开 3D 场景属性"],
      ["Shift + 单击场景树", "多选或取消选择对象"],
      ["拖动 XYZ 三轴", "移动、旋转或缩放当前对象"],
      ["Delete / Backspace", "删除当前选中对象"],
    ],
  },
  {
    title: "时间轴与记录",
    description: "人物、道具和摄像机共用同一帧范围",
    controls: [
      ["拖动播放头", "暂停并定位到指定帧"],
      ["记录起点 / 记录当前位置", "保存当前对象在该帧的状态"],
      ["播放按钮", "从起点预演镜头和对象运动"],
      ["右侧路线 / 轨迹页", "编辑人物路线或摄像机轨迹点"],
      ["⌘ / Ctrl + C", "复制选中的人物或物体"],
      ["⌘ / Ctrl + V", "粘贴并选中新副本"],
      ["⌘ / Ctrl + Z", "撤销最近一次编辑或拖动"],
    ],
  },
] as const;

const HOME_TOOL_GROUPS = [
  ["顶部栏", "返回首页、切换或新建导演台、导出全部机位视频、关闭导演台"],
  ["左侧栏", "切换透视或机位视角；搜索、选择、隐藏、锁定和删除场景对象"],
  ["视口工具栏", "变换对象、添加角色或机位、导入模型、打开模型库、设置画幅、截图和全屏"],
  ["右侧属性", "编辑场景、人物、模型或摄像机；人物含姿势、动作和路线，摄像机含轨迹和截图"],
  ["底部时间轴", "设置帧数和帧率、定位播放头、记录动作点或轨迹点、播放和删除当前点"],
] as const;

function getUrlDirectorDeskInstanceId() {
  try {
    return new URLSearchParams(window.location.search).get("instanceId")?.trim() || null;
  } catch {
    return null;
  }
}

function updateUrlDirectorDeskInstanceId(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("instanceId", id);
    } else {
      url.searchParams.delete("instanceId");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Navigation state remains usable even if the embedding host blocks History API writes.
  }
}

function createInitialDirectorDeskViewState() {
  const records = ensureDirectorDeskRecords();
  const urlInstanceId = getUrlDirectorDeskInstanceId();
  const benchmarkMode = getPerformanceBenchmarkMode(window.location.search);
  if (benchmarkMode) {
    const timestamp = new Date().toISOString();
    const benchmarkId = urlInstanceId ?? "benchmark_standard";
    const benchmarkRecord: DirectorDeskRecord = {
      id: benchmarkId,
      name: `${getPerformanceBenchmarkSceneConfig(benchmarkMode).label}性能基准（临时）`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return {
      records: [...records.filter((record) => record.id !== benchmarkId), benchmarkRecord],
      activeDeskId: benchmarkId,
      screen: "editor" as AppScreen,
    };
  }
  return {
    records,
    activeDeskId: urlInstanceId ?? getInitialDirectorDeskId(records) ?? records[0]?.id ?? "",
    screen: urlInstanceId ? "editor" : ("home" as AppScreen),
  };
}

function formatDirectorDeskUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "刚刚更新";

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "刚刚更新";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} 小时前`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const benchmarkMode = getPerformanceBenchmarkMode(window.location.search);
  const [directorDeskView, setDirectorDeskView] = useState(createInitialDirectorDeskViewState);
  const { records: directorDesks, activeDeskId, screen } = directorDeskView;
  const [allSentToCanvas, setAllSentToCanvas] = useState(false);

  const hasCaptures = useDirectorStore((state) =>
    state.project.cameras.some((c) => !c.isVirtual && (c.captures ?? []).length > 0)
  );

  function sendAllCapturesToCanvas() {
    const cams = useDirectorStore.getState().project.cameras.filter((c) => !c.isVirtual);
    postDirectorDeskCapturesToHost(
      cams.flatMap((cam) =>
        (cam.captures ?? []).map((capture) => ({
          dataUrl: capture.dataUrl,
          fileName: `${capture.name}.png`,
        }))
      )
    );
    setAllSentToCanvas(true);
    setTimeout(() => setAllSentToCanvas(false), 1500);
  }

  function openDirectorDesk(
    id: string,
    records = directorDesks,
    options: { loadScene?: boolean } = {}
  ) {
    if (!id) return;

    const { loadScene = true } = options;
    const ensured = ensureDirectorDeskRecordForId(records, id);
    const nextRecords = touchDirectorDeskRecord(ensured.records, id);
    setDirectorDeskView({ records: nextRecords, activeDeskId: id, screen: "editor" });
    writeActiveDirectorDeskId(id);
    updateUrlDirectorDeskInstanceId(id);
    if (loadScene) {
      useDirectorStore.getState().openScopedScene(id);
    }
  }

  function backToHome() {
    useDirectorStore.getState().setCameraMotionPlaying(false);
    const records = ensureDirectorDeskRecords();
    setDirectorDeskView({ records, activeDeskId, screen: "home" });
    updateUrlDirectorDeskInstanceId(null);
  }

  useEffect(() => {
    initDirectorDeskHostBridge();
    if (screen === "editor" && !benchmarkMode) {
      openDirectorDesk(activeDeskId, directorDesks);
    }

    if (benchmarkMode) {
      const state = useDirectorStore.getState();
      const benchmarkProfile = getBenchmarkPerformanceProfile(window.location.search);
      const benchmarkPlayback = getPerformanceBenchmarkPlayback(window.location.search);
      const benchmarkScene = getPerformanceBenchmarkSceneConfig(benchmarkMode);
      useDirectorStore.setState({
        ...state,
        project: createPerformanceBenchmarkProject(benchmarkMode),
        viewMode: "director",
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
        selectedCameraKeyframeId: null,
        selectedCameraKeyframeIds: [],
        selectedObjectMotionKeyframeId: null,
        showCharacterRoutes: false,
        motionStudioOpen: benchmarkScene.monitorEnabled,
        cameraMotionProgress: benchmarkPlayback.progress,
        cameraMotionPlaying: benchmarkPlayback.playing,
        ...(benchmarkProfile ? { performanceProfile: benchmarkProfile } : {}),
      });
    }

    postDirectorDeskMessageToHost({ type: "storyai:director-desk-ready" });
  }, []);

  useEffect(() => {
    function handleHostSessionOpened(event: Event) {
      const instanceId = (event as CustomEvent<{ instanceId?: string }>).detail?.instanceId;
      if (instanceId) {
        openDirectorDesk(instanceId, directorDesks, { loadScene: false });
      }
    }

    window.addEventListener(DIRECTOR_DESK_SESSION_OPENED_EVENT, handleHostSessionOpened);
    return () => window.removeEventListener(DIRECTOR_DESK_SESSION_OPENED_EVENT, handleHostSessionOpened);
  }, [directorDesks]);

  function handleCreateDesk() {
    const record = createDirectorDeskRecord(directorDesks);
    const nextRecords = [...directorDesks, record];
    writeDirectorDeskRecords(nextRecords);
    openDirectorDesk(record.id, nextRecords);
  }

  function handleDeleteDesk(desk: DirectorDeskRecord) {
    if (!window.confirm(`删除「${desk.name}」？这个导演台里的本地场景也会一起删除。`)) return;

    const result = deleteDirectorDeskRecord(directorDesks, desk.id);
    setDirectorDeskView({
      records: result.records,
      activeDeskId: result.activeId ?? result.records[0]?.id ?? "",
      screen: "home",
    });
  }

  function handleClose() {
    postDirectorDeskMessageToHost({ type: "storyai:director-desk-close" });
    backToHome();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        useDirectorStore.getState().copySelectedObjects();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        useDirectorStore.getState().pasteClipboardObjects();
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useDirectorStore.getState().undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (screen === "home") {
    return (
      <main className="director-home-shell">
        <section className="director-home-hero">
          <div>
            <p className="director-home-kicker">Standalone 3D Director Desk</p>
            <h1>选择一个导演台开始摆场景</h1>
            <p>
              每个导演台独立保存，重启后先回到这里选择，不会再直接打开上一次的无名工程。
            </p>
          </div>
          <div className="director-home-hero-actions">
            <button className="director-home-primary-button" type="button" onClick={handleCreateDesk}>
              <Plus aria-hidden="true" size={18} />
              新建导演台
            </button>
            <a className="director-home-scroll-hint" href="#director-home-guide-title">
              向下查看使用说明
              <ArrowDown aria-hidden="true" size={14} />
            </a>
          </div>
        </section>

        {directorDesks.length ? (
          <section className="director-home-grid" aria-label="导演台列表">
            {directorDesks.map((desk, index) => (
              <article
                key={desk.id}
                className={`director-home-card ${desk.id === activeDeskId ? "is-active" : ""}`}
              >
                <button className="director-home-card-main" type="button" onClick={() => openDirectorDesk(desk.id)}>
                  <span className="director-home-card-icon">
                    <Boxes aria-hidden="true" size={22} strokeWidth={1.8} />
                  </span>
                  <span className="director-home-card-content">
                    <span className="director-home-card-title">{desk.name}</span>
                    <span className="director-home-card-meta">
                      <Clock3 aria-hidden="true" size={13} />
                      {formatDirectorDeskUpdatedAt(desk.updatedAt)}
                    </span>
                  </span>
                  <span className="director-home-card-index">{String(index + 1).padStart(2, "0")}</span>
                  <ArrowRight className="director-home-card-arrow" aria-hidden="true" size={18} />
                </button>
                <button
                  className="director-home-card-delete"
                  type="button"
                  aria-label={`删除${desk.name}`}
                  onClick={() => handleDeleteDesk(desk)}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
              </article>
            ))}
          </section>
        ) : (
          <section className="director-home-empty" aria-label="空导演台列表">
            <Boxes aria-hidden="true" size={28} strokeWidth={1.6} />
            <h2>还没有导演台</h2>
            <p>点击“新建导演台”创建一个干净的 3D 场景。</p>
          </section>
        )}

        <section className="director-home-guide" aria-labelledby="director-home-guide-title">
          <header className="director-home-section-heading">
            <span><BookOpen aria-hidden="true" size={16} />第一次使用</span>
            <div>
              <h2 id="director-home-guide-title">五步完成场景和镜头</h2>
              <p>下面的步骤与当前界面一致，人物、道具和摄像机都通过同一条底部时间轴记录。</p>
            </div>
          </header>
          <ol className="director-home-steps">
            {HOME_QUICK_START_STEPS.map(([title, description], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><strong>{title}</strong><p>{description}</p></div>
              </li>
            ))}
          </ol>
          <p className="director-home-shortcuts">
            <strong>视口提示</strong>
            <kbd>Alt / Option</kbd>配合鼠标拖动查看场景
            <kbd>Shift</kbd>在左侧场景树中多选
            <kbd>Delete</kbd>删除选中对象
          </p>
        </section>

        <section className="director-home-release" aria-labelledby="director-home-release-title">
          <header className="director-home-section-heading">
            <span><Sparkles aria-hidden="true" size={16} />本次更新</span>
            <div>
              <h2 id="director-home-release-title">路线编辑、监看与导出升级</h2>
              <p>这次重点补全人物运动、镜头预演和参考视频工作流。</p>
            </div>
          </header>
          <ul className="director-home-release-list">
            {HOME_RELEASE_NOTES.map((note) => (
              <li key={note}><Check aria-hidden="true" size={15} /><span>{note}</span></li>
            ))}
          </ul>
        </section>

        <section className="director-home-controls" aria-labelledby="director-home-controls-title">
          <header className="director-home-section-heading">
            <span><Keyboard aria-hidden="true" size={16} />完整操作表</span>
            <div>
              <h2 id="director-home-controls-title">键盘、鼠标与触控板操作</h2>
              <p>普通查看需按住 Alt；macOS 对应 Option。快捷键在输入框中不会触发。</p>
            </div>
          </header>

          <div className="director-home-control-grid">
            {HOME_CONTROL_GROUPS.map((group) => (
              <article key={group.title} className="director-home-control-group">
                <header><MousePointer2 aria-hidden="true" size={15} /><div><h3>{group.title}</h3><p>{group.description}</p></div></header>
                <dl>
                  {group.controls.map(([keys, action]) => (
                    <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>
                  ))}
                </dl>
              </article>
            ))}
          </div>

          <article className="director-home-tools-guide">
            <h3>主要界面按钮</h3>
            <dl>
              {HOME_TOOL_GROUPS.map(([area, actions]) => (
                <div key={area}><dt>{area}</dt><dd>{actions}</dd></div>
              ))}
            </dl>
          </article>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <button className="top-bar-title top-bar-home-button" type="button" onClick={backToHome}>
            3D导演台
          </button>
          <span className="top-bar-version" aria-label={`当前版本 v${__APP_VERSION__}`}>v{__APP_VERSION__}</span>
          <button className="top-bar-home-nav-button" type="button" aria-label="返回首页" onClick={backToHome}>
            <House aria-hidden="true" size={14} strokeWidth={1.9} />
            首页
          </button>
          <div className="director-desk-switcher" aria-label="导演台选择器">
            <select
              className="director-desk-select"
              aria-label="选择导演台"
              value={activeDeskId}
              onChange={(event) => openDirectorDesk(event.currentTarget.value)}
            >
              {directorDesks.map((desk) => (
                <option key={desk.id} value={desk.id}>
                  {desk.name}
                </option>
              ))}
            </select>
            <button className="director-desk-create-button" type="button" onClick={handleCreateDesk}>
              <Plus aria-hidden="true" size={14} strokeWidth={1.9} />
              新建
            </button>
          </div>
        </div>
        <div className="top-bar-actions">
          <button
            className="top-bar-action-button camera-video-export-trigger"
            type="button"
            onClick={sendAllCapturesToCanvas}
            disabled={!hasCaptures}
          >
            {allSentToCanvas ? <Check aria-hidden="true" size={14} strokeWidth={1.9} /> : <Send aria-hidden="true" size={14} strokeWidth={1.9} />}
            {allSentToCanvas ? "已导入" : "将所有素材导入画布"}
          </button>
          <button
            className="top-bar-action-button"
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={handleClose}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <DirectorDeskShell>
        <DirectorCanvas />
      </DirectorDeskShell>
    </div>
  );
}
