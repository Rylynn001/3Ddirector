import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { MOUSE, PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getCameraPlaybackSnapshot } from "../schema/cameraPlayback";
import { getCameraMotionSnapshot } from "../schema/cameraMotion";
import { getCameraRigPositionFromViewSnapshot, getCameraViewSnapshotFromShot } from "../schema/cameraGeometry";
import { getRuntimePlaybackProgress } from "../runtime/playbackRuntime";
import { useDirectorStore, type CameraShotSnapshot } from "../store/directorStore";

export function ViewportNavigation({ controlsRef, freeSnapshot, onFreeChange, onCameraSnapshot, disabled }: {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  freeSnapshot: CameraShotSnapshot;
  onFreeChange: (snapshot: CameraShotSnapshot) => void;
  onCameraSnapshot: (snapshot: CameraShotSnapshot) => void;
  disabled: boolean;
}) {
  const { camera, gl } = useThree();
  const viewMode = useDirectorStore((state) => state.viewMode);
  const viewportCameraId = useDirectorStore((state) => state.viewportCameraId);
  const shot = useDirectorStore((state) => state.project.cameras.find((item) =>
    item.id === (state.viewportCameraId ?? state.project.activeCameraId)
  ));
  const progress = useDirectorStore((state) => state.cameraMotionProgress);
  const playing = useDirectorStore((state) => state.cameraMotionPlaying);
  const locked = useDirectorStore((state) => state.project.objects.some((item) => item.linkedCameraId === shot?.id && item.locked));
  const rotateSpeed = useDirectorStore((state) => state.viewportRotateSensitivity);
  const zoomSpeed = useDirectorStore((state) => state.viewportZoomSensitivity);
  const navigating = useRef(false);
  const syncing = useRef(false);
  const lastSeek = useRef<string | null>(null);
  const lastShot = useRef(shot);

  useEffect(() => {
    if (viewMode === "camera" && !shot) useDirectorStore.getState().setViewportCamera(null);
  }, [viewMode, shot]);

  function apply(snapshot: CameraShotSnapshot) {
    syncing.current = true;
    const perspective = camera as PerspectiveCamera;
    perspective.position.set(...snapshot.position);
    perspective.fov = snapshot.fov;
    perspective.lookAt(...snapshot.target);
    perspective.updateProjectionMatrix();
    perspective.updateMatrixWorld();
    controlsRef.current?.target.set(...snapshot.target);
    controlsRef.current?.update();
    if (snapshot.rotation) {
      camera.rotation.set(...snapshot.rotation);
      camera.updateMatrixWorld();
    }
    if (viewMode === "camera") onCameraSnapshot(snapshot);
    syncing.current = false;
  }

  useLayoutEffect(() => {
    if (disabled || navigating.current) return;
    if (viewMode !== "camera" || !shot) {
      apply(freeSnapshot);
      lastSeek.current = null;
      return;
    }
    const seek = `${shot.id}:${progress}`;
    const state = useDirectorStore.getState();
    const hasKeys = Boolean(shot.motionPath?.keyframes.length);
    apply(hasKeys && (lastSeek.current !== seek || playing || lastShot.current?.transform === shot.transform)
      ? shot.motionPath!.keyframes.length === 1
        ? getCameraMotionSnapshot(shot, progress)
        : getCameraPlaybackSnapshot(shot, state.project.objects, progress, state.project.scene)
      : getCameraViewSnapshotFromShot(shot));
    lastSeek.current = seek;
    lastShot.current = shot;
  }, [viewMode, viewportCameraId, shot, progress, playing, freeSnapshot, disabled]);

  useFrame(() => {
    if (!playing || viewMode !== "camera" || !shot || disabled) return;
    const state = useDirectorStore.getState();
    apply(getCameraPlaybackSnapshot(shot, state.project.objects, getRuntimePlaybackProgress(), state.project.scene));
  });

  useEffect(() => {
    const canvas = gl.domElement;
    function prepareNavigation(event: PointerEvent) {
      const controls = controlsRef.current;
      if (!controls) return;
      controls.mouseButtons = event.altKey
        ? { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.DOLLY }
        : { LEFT: undefined, MIDDLE: undefined, RIGHT: undefined };
    }
    canvas.addEventListener("pointerdown", prepareNavigation, true);
    return () => canvas.removeEventListener("pointerdown", prepareNavigation, true);
  }, [gl, controlsRef]);

  return <OrbitControls
    ref={controlsRef}
    makeDefault
    enabled={!disabled && (viewMode !== "camera" || (!playing && !locked))}
    enableDamping={false}
    rotateSpeed={rotateSpeed}
    zoomSpeed={zoomSpeed}
    mouseButtons={{ LEFT: undefined, MIDDLE: undefined, RIGHT: undefined }}
    onStart={() => {
      if (syncing.current) return;
      navigating.current = true;
      if (viewMode === "camera") useDirectorStore.getState().beginUndoBatch();
    }}
    onEnd={() => {
      if (!navigating.current) return;
      navigating.current = false;
      if (viewMode === "camera") useDirectorStore.getState().endUndoBatch();
    }}
    onChange={() => {
      if (syncing.current || !navigating.current || !controlsRef.current) return;
      const perspective = camera as PerspectiveCamera;
      const snapshot: CameraShotSnapshot = {
        position: perspective.position.toArray(),
        target: controlsRef.current.target.toArray(),
        fov: perspective.fov,
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
      };
      if (viewMode !== "camera" || !shot) {
        onFreeChange(snapshot);
        return;
      }
      const state = useDirectorStore.getState();
      onCameraSnapshot(snapshot);
      if (state.project.objects.some((item) => item.linkedCameraId === shot.id && item.locked)) return;
      const position = getCameraRigPositionFromViewSnapshot(snapshot);
      state.updateCamera(shot.id, {
        transform: { ...shot.transform, position, rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z] },
        target: snapshot.target,
        targetMode: "manual",
        targetObjectId: null,
      });
    }}
  />;
}
