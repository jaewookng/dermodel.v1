import { useState, useRef, useEffect } from 'react';
import Spline from '@splinetool/react-spline';
import { Card } from '@/components/ui/card';
import { Application } from '@splinetool/runtime';
import * as THREE from 'three';

type FaceArea = 'forehead' | 'eyes' | 'cheeks' | 'nose' | 'mouth' | 'chin' | null;

// Spline scene setup logs, only in dev builds
const debug: typeof console.log = import.meta.env.DEV ? console.log : () => {};

// Map Spline object names to face areas
const splineToFaceAreaMap: Record<string, FaceArea> = {
  'face_eyes': 'eyes',
  'face_nose': 'nose',
  'face_mouth': 'mouth',
  'face_cheeks': 'cheeks',
  'face_chin': 'chin',
  'face_forehead': 'forehead',
  // face_else is not mapped as it's not a selectable area
};

// Face area information
const areaInfo = {
  forehead: {
    title: 'Forehead',
    concerns: ['Fine lines', 'Oil control', 'Texture'],
    ingredients: ['Retinol', 'Niacinamide', 'Salicylic Acid'],
    color: '#fce7f3'
  },
  eyes: {
    title: 'Eye Area',
    concerns: ['Dark circles', 'Puffiness', 'Crow\'s feet'],
    ingredients: ['Caffeine', 'Peptides', 'Hyaluronic Acid'],
    color: '#e0e7ff'
  },
  cheeks: {
    title: 'Cheeks',
    concerns: ['Dryness', 'Redness', 'Loss of firmness'],
    ingredients: ['Ceramides', 'Vitamin C', 'Collagen'],
    color: '#fef3c7'
  },
  nose: {
    title: 'Nose',
    concerns: ['Blackheads', 'Large pores', 'Oiliness'],
    ingredients: ['BHA', 'Charcoal', 'Clay'],
    color: '#d1fae5'
  },
  mouth: {
    title: 'Mouth & Lips',
    concerns: ['Dryness', 'Fine lines', 'Pigmentation'],
    ingredients: ['Shea Butter', 'Vitamin E', 'Peptides'],
    color: '#fce7f3'
  },
  chin: {
    title: 'Chin',
    concerns: ['Acne', 'Texture', 'Sensitivity'],
    ingredients: ['Tea Tree', 'Zinc', 'Allantoin'],
    color: '#f3e8ff'
  }
};

/**
 * Where the face is on screen and how big it currently looks.
 * `scale` is 1.0 at the model's reference size, so overlays can size themselves
 * with the Spline camera instead of guessing from the viewport.
 */
export interface FaceAnchor {
  x: number;
  y: number;
  scale: number;
}

// Forehead-to-chin distance (px) at which `scale` should read 1.0. Measured
// from the default desktop framing of the current scene.
const REFERENCE_FACE_SPAN_PX = 210;

interface FaceModelProps {
  onAnchorChange?: (anchor: FaceAnchor | null) => void;
}

// Main FaceModel component with Spline zone interaction
export const FaceModel = ({ onAnchorChange }: FaceModelProps = {}) => {
  const [activeArea, setActiveArea] = useState<FaceArea>(null);
  const [hoveredArea, setHoveredArea] = useState<FaceArea>(null);
  const [isLoading, setIsLoading] = useState(true);
  const splineRef = useRef<Application | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the projection loop never needs re-creating.
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;

  // ═══════════════════════════════════════════════════════════════════════
  // CORE: Spline Load Event Handler
  // Sets up raycasting for facial zone detection
  // ═══════════════════════════════════════════════════════════════════════
  const onSplineLoad = (splineApp: Application) => {
    setIsLoading(false);
    splineRef.current = splineApp;

    const app = splineApp as any;

    debug('🎬 Spline app loaded');
    debug('📦 Available keys:', Object.keys(app));
    debug('🔍 Has renderer:', !!app.renderer);
    debug('🔍 Has scene:', !!app.scene);

    // Wait for renderer and scene to be ready (with retry mechanism)
    const setupRaycaster = () => {
      // Try multiple ways to access renderer and scene
      const renderer = app.renderer || app._renderer || app.webgl?.renderer;
      const scene = app.scene || app._scene || app.webgl?.scene;
      const canvas = renderer?.domElement || app.canvas || document.querySelector('canvas');

      if (!canvas || !scene) {
        debug(`⏳ Waiting... Canvas: ${!!canvas}, Scene: ${!!scene}, Renderer: ${!!renderer}`);
        return false;
      }

      debug('✓ Renderer and scene ready, setting up raycaster');

      // ─────────────────────────────────────────────────────────────────────
      // Scene References (using already extracted variables)
      // ─────────────────────────────────────────────────────────────────────
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const objectToFaceAreaMap = new Map<any, FaceArea>();
      // Top-level object per Spline zone name, used as anchor landmarks.
      const zoneRoots = new Map<string, any>();

      // ─────────────────────────────────────────────────────────────────────
      // Section 1: Face Zone Object Mapping
      // ─────────────────────────────────────────────────────────────────────
      const markObjectWithFaceArea = (obj: any, objectName: string, faceArea: FaceArea) => {
        (obj as any).__faceAreaName = objectName;
        (obj as any).__faceArea = faceArea;
        if (!obj.name) obj.name = objectName;
        objectToFaceAreaMap.set(obj, faceArea);
      };

      const populateObjectMap = () => {
        objectToFaceAreaMap.clear();

        Object.keys(splineToFaceAreaMap).forEach(objectName => {
          const splineObject = splineApp.findObjectByName(objectName);
          if (!splineObject) {
            console.warn(`⚠️ Missing object in scene: ${objectName}`);
            return;
          }

          debug(`✓ Found Spline object: ${objectName}`);
          const faceArea = splineToFaceAreaMap[objectName];

          // Extract underlying Three.js object
          const threeObject = (splineObject as any).nativeObject ||
                             (splineObject as any)._object ||
                             splineObject;

          if (threeObject?.isObject3D) {
            zoneRoots.set(objectName, threeObject);
            markObjectWithFaceArea(threeObject, objectName, faceArea);
            threeObject.traverse((child: any) =>
              markObjectWithFaceArea(child, objectName, faceArea)
            );
          } else {
            // Fallback: Search scene by name
            scene.traverse((obj: any) => {
              if (obj.name === objectName) {
                if (!zoneRoots.has(objectName)) zoneRoots.set(objectName, obj);
                markObjectWithFaceArea(obj, objectName, faceArea);
                obj.traverse((child: any) =>
                  markObjectWithFaceArea(child, objectName, faceArea)
                );
              }
            });
          }
        });

        debug(`✓ Mapped ${objectToFaceAreaMap.size} objects to face areas`);
      };

      // Populate immediately and with delays for late-loading objects
      [0, 100, 500].forEach(delay => setTimeout(populateObjectMap, delay));

      // ─────────────────────────────────────────────────────────────────────
      // Section 2: Camera Positioning & Rotation Control Lockdown
      // ─────────────────────────────────────────────────────────────────────
      const setupCamera = () => {
        try {
          const camera = app.camera;
          if (camera && camera.position) {
            // Move camera closer by reducing the z position
            // Original z might be around 1000-1500, we'll move it to about 70% of original
            const currentZ = camera.position.z;
            const newZ = currentZ * 0.4; // Move 60% closer

            camera.position.set(
              camera.position.x,
              camera.position.y,
              newZ
            );

            debug(`✓ Camera moved closer: z from ${currentZ.toFixed(2)} to ${newZ.toFixed(2)}`);
          }
        } catch (error) {
          console.warn('Could not adjust camera position:', error);
        }
      };

      // Adjust camera position
      setupCamera();

      // ─────────────────────────────────────────────────────────────────────
      // Section 3: Raycasting Utilities
      // ─────────────────────────────────────────────────────────────────────
      const getCamera = (): any => {
        if (app.camera) return app.camera;

        let camera: any = null;
        scene.traverse((obj: any) => {
          if (obj.isCamera && !camera) camera = obj;
        });
        return camera;
      };

      const getInteractableObjects = (): any[] => {
        const objects: any[] = [];
        scene.traverse((object: any) => {
          if (object.visible && (object.isMesh || object.geometry)) {
            objects.push(object);
          }
        });
        return objects;
      };

      const findFaceAreaFromObject = (object: any): FaceArea | null => {
        let current: any = object;

        while (current) {
          // Check map first (fastest)
          if (objectToFaceAreaMap.has(current)) {
            return objectToFaceAreaMap.get(current) || null;
          }

          // Check stored metadata
          const storedArea = (current as any).__faceArea;
          if (storedArea) return storedArea;

          // Check by name
          const areaName = (current as any).__faceAreaName || current.name;
          if (areaName && splineToFaceAreaMap[areaName]) {
            return splineToFaceAreaMap[areaName];
          }

          current = current.parent;
        }

        return null;
      };

      const performRaycast = (): FaceArea | null => {
        const camera = getCamera();
        if (!camera) {
          console.warn('Camera not found for raycasting');
          return null;
        }

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(getInteractableObjects(), true);

        return intersects.length > 0
          ? findFaceAreaFromObject(intersects[0].object)
          : null;
      };

      const updateMousePosition = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      };

      // ─────────────────────────────────────────────────────────────────────
      // Section 3.5: Face Anchor Projection
      // Projects the face's bounding box into screen space each frame so
      // overlays can track the model's true position and apparent size through
      // camera moves and window resizes, rather than guessing with percentages.
      // ─────────────────────────────────────────────────────────────────────
      // Two anatomical landmarks, measured from geometry rather than object
      // transforms: every zone mesh sits at the scene origin (the shape lives in
      // the geometry, and the parent rig carries the scale), so object world
      // positions are all identical and useless here.
      const anchorLocal = new THREE.Vector3();
      const foreheadWorld = new THREE.Vector3();
      const chinWorld = new THREE.Vector3();
      const anchorProjected = new THREE.Vector3();
      const anchorEdge = new THREE.Vector3();
      let lastAnchor = { x: 0, y: 0, scale: 0 };

      // World-space centre of a zone mesh's geometry.
      const zoneCentre = (obj: any, out: THREE.Vector3): boolean => {
        const geometry = obj?.geometry;
        if (!geometry) return false;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        if (!bb) return false;
        anchorLocal.set(
          (bb.min.x + bb.max.x) / 2,
          (bb.min.y + bb.max.y) / 2,
          (bb.min.z + bb.max.z) / 2
        );
        obj.updateWorldMatrix?.(true, false);
        out.copy(anchorLocal).applyMatrix4(obj.matrixWorld);
        return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
      };

      // Where to put the bubble if the projection can't be trusted (see below).
      const fallbackAnchor = (viewW: number, viewH: number): FaceAnchor => ({
        x: viewW * 0.32,
        y: viewH * 0.44,
        scale: Math.min(Math.max(viewH / 720, 0.7), 1.3),
      });

      const emitAnchor = () => {
        // The canvas is a full-screen `fixed inset-0`, so any of these is an
        // equivalent measure -- but a hidden or not-yet-laid-out tab reports 0
        // for some of them, which would strand the overlay at the origin.
        const rect = canvas.getBoundingClientRect();
        const viewW =
          rect.width || canvas.clientWidth || window.innerWidth ||
          document.documentElement.clientWidth;
        const viewH =
          rect.height || canvas.clientHeight || window.innerHeight ||
          document.documentElement.clientHeight;
        if (!viewW || !viewH) return;

        const camera = getCamera();
        const forehead = zoneRoots.get('face_forehead');
        const chin = zoneRoots.get('face_chin');

        let next: FaceAnchor | null = null;

        if (
          camera &&
          zoneCentre(forehead, foreheadWorld) &&
          zoneCentre(chin, chinWorld)
        ) {
          anchorProjected.copy(foreheadWorld).project(camera);
          anchorEdge.copy(chinWorld).project(camera);

          const foreheadPx = {
            x: ((anchorProjected.x + 1) / 2) * viewW,
            y: ((1 - anchorProjected.y) / 2) * viewH,
          };
          const chinPx = {
            x: ((anchorEdge.x + 1) / 2) * viewW,
            y: ((1 - anchorEdge.y) / 2) * viewH,
          };
          const spanPx = Math.hypot(chinPx.x - foreheadPx.x, chinPx.y - foreheadPx.y);

          // Trust the projection only when it lands somewhere believable. Spline
          // owns the camera and can hand us stale matrices (or a camera type we
          // don't control); rather than fling the bubble off-screen, fall back.
          const onScreen =
            Math.abs(anchorProjected.x) < 1.2 && Math.abs(anchorProjected.y) < 1.6 &&
            Math.abs(anchorEdge.x) < 1.2 && Math.abs(anchorEdge.y) < 1.6;

          if (onScreen && Number.isFinite(spanPx) && spanPx > 30 && spanPx < viewH * 2) {
            next = {
              x: (foreheadPx.x + chinPx.x) / 2,
              y: (foreheadPx.y + chinPx.y) / 2,
              scale: Math.min(Math.max(spanPx / REFERENCE_FACE_SPAN_PX, 0.6), 1.8),
            };
          }
        }

        if (!next) next = fallbackAnchor(viewW, viewH);

        // Skip sub-pixel churn so React isn't re-rendering the overlay for noise.
        if (
          Math.abs(next.x - lastAnchor.x) < 0.5 &&
          Math.abs(next.y - lastAnchor.y) < 0.5 &&
          Math.abs(next.scale - lastAnchor.scale) < 0.005
        ) {
          return;
        }
        lastAnchor = next;
        onAnchorChangeRef.current?.(next);
      };

      const safeEmitAnchor = () => {
        try {
          emitAnchor();
        } catch (error) {
          console.warn('Error projecting face anchor:', error);
        }
      };

      let anchorRaf = 0;
      let lastAnchorTick = 0;
      const anchorTick = (t: number) => {
        anchorRaf = requestAnimationFrame(anchorTick);
        // ~20fps is plenty for a floating overlay and keeps this off the
        // render-critical path.
        if (t - lastAnchorTick < 50) return;
        lastAnchorTick = t;
        safeEmitAnchor();
      };
      anchorRaf = requestAnimationFrame(anchorTick);

      // rAF is paused or throttled whenever the tab isn't visible, so back it
      // with a slow interval: the overlay corrects itself on the next tick
      // instead of waiting for a frame that may never come. emitAnchor() no-ops
      // when nothing moved, so this is nearly free.
      const anchorInterval = setInterval(safeEmitAnchor, 500);
      // And once immediately, so the bubble lands correctly on first paint.
      [0, 150, 600].forEach((delay) => setTimeout(safeEmitAnchor, delay));

      // ─────────────────────────────────────────────────────────────────────
      // Section 4: Mouse Event Handling
      // ─────────────────────────────────────────────────────────────────────
      let mouseDownTime = 0;
      let mouseDownX = 0;
      let mouseDownY = 0;
      let isDragging = false;

      const handleMouseDown = (event: MouseEvent) => {
        mouseDownTime = Date.now();
        mouseDownX = event.clientX;
        mouseDownY = event.clientY;
        isDragging = false;
        updateMousePosition(event);
      };

      const handleMouseMove = (event: MouseEvent) => {
        updateMousePosition(event);

        // Detect dragging
        if (mouseDownTime > 0) {
          const distance = Math.hypot(
            event.clientX - mouseDownX,
            event.clientY - mouseDownY
          );
          if (distance > 5) isDragging = true;
        }

        // Update hover state
        try {
          const faceArea = performRaycast();
          if (faceArea) {
            setHoveredArea(faceArea);
            document.body.style.cursor = 'pointer';
          }
        } catch (error) {
          console.warn('Error in hover raycasting:', error);
        }
      };

      const handleMouseUp = (event: MouseEvent) => {
        const clickDuration = Date.now() - mouseDownTime;
        const moveDistance = Math.hypot(
          event.clientX - mouseDownX,
          event.clientY - mouseDownY
        );

        // Only process as click if not a drag
        if (!isDragging && clickDuration < 300 && moveDistance < 5) {
          updateMousePosition(event);

          try {
            const faceArea = performRaycast();
            if (faceArea) {
              setActiveArea(prev => prev === faceArea ? null : faceArea);
              debug(`✓ Clicked on face area: ${faceArea}`);
            }
          } catch (error) {
            console.warn('Error in click raycasting:', error);
          }
        }

        mouseDownTime = 0;
        isDragging = false;
      };

      const handleMouseLeave = () => {
        setHoveredArea(null);
        document.body.style.cursor = 'auto';
        mouseDownTime = 0;
        isDragging = false;
      };

      // ─────────────────────────────────────────────────────────────────────
      // Section 5: Event Listener Registration & Cleanup
      // ─────────────────────────────────────────────────────────────────────
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseLeave);

      app.__raycasterCleanup = () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseLeave);
        cancelAnimationFrame(anchorRaf);
        clearInterval(anchorInterval);
      };

      debug('✓ Raycaster set up for click and hover detection');

      return true; // Setup successful
    };

    // Try to setup raycaster with extended retry mechanism
    const retrySetup = (attempt: number = 1, maxAttempts: number = 10) => {
      if (setupRaycaster()) {
        debug(`✓ Raycaster setup successful on attempt ${attempt}`);
        return;
      }

      if (attempt >= maxAttempts) {
        console.warn('⚠️  Raycaster setup skipped - scene not ready');
        debug('💡 Face zone interactions may not work without raycaster');
        debug('🔍 App structure:', {
          appKeys: Object.keys(app).join(', '),
          hasRenderer: !!app.renderer,
          hasScene: !!app.scene,
          canvasInDOM: !!document.querySelector('canvas'),
        });
        // Don't block the app from loading - raycasting is optional
        return;
      }

      const delay = Math.min(100 * attempt, 1000); // Progressive delay up to 1s
      setTimeout(() => retrySetup(attempt + 1, maxAttempts), delay);
    };

    retrySetup();
  };

  // Event handlers are no longer needed - raycaster handles everything
  // Keeping empty handlers to avoid warnings
  const onSplineMouseDown = () => {};
  const onSplineMouseHover = () => {};
  const onSplineMouseExit = () => {};


  // Cleanup on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    container.addEventListener('contextmenu', preventContextMenu);

    return () => {
      container.removeEventListener('contextmenu', preventContextMenu);
      
      // Cleanup raycaster event listeners
      if (splineRef.current) {
        const app = splineRef.current as any;
        if (app.__raycasterCleanup) {
          app.__raycasterCleanup();
        }
        if (app.__rotationLockInterval) {
          clearInterval(app.__rotationLockInterval);
        }
      }
    };
  }, []);

  return (
    <>
      {/* Spline 3D Model Container */}
      <div
        ref={containerRef}
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        className="fixed inset-0 w-full h-full"
      >
        <Spline
          scene="https://prod.spline.design/ObB3WG6BMBOBetPq/scene.splinecode"
          onLoad={onSplineLoad}
          onMouseDown={onSplineMouseDown}
          onMouseOver={onSplineMouseHover}
          onMouseOut={onSplineMouseExit}
          className="w-full h-full"
        />
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="fixed inset-0 flex items-center justify-center bg-white z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-500 mb-4 mx-auto"></div>
            <p className="text-sm text-gray-600">Loading 3D model...</p>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredArea && (
        <div className="fixed top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-md z-20 pointer-events-none">
          <p className="text-sm font-medium text-gray-700">{areaInfo[hoveredArea].title}</p>
        </div>
      )}
      
      {/* Area Information Card - Shows when a zone is clicked */}
      {activeArea && (
        <div className="fixed bottom-6 left-6 w-80 animate-fade-in z-20">
          <Card className="p-4 bg-white/95 backdrop-blur-sm border-gray-200 shadow-xl">
            {/* Close button */}
            <button
              onClick={() => setActiveArea(null)}
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
            
            <h3 className="font-semibold text-lg text-gray-800 mb-2 pr-6">
              {areaInfo[activeArea].title}
            </h3>
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-gray-600 mb-1">Common Concerns:</h4>
                <div className="flex flex-wrap gap-1">
                  {areaInfo[activeArea].concerns.map((concern, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-rose-100 text-rose-700 text-xs rounded-full"
                    >
                      {concern}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-600 mb-1">Recommended Ingredients:</h4>
                <div className="flex flex-wrap gap-1">
                  {areaInfo[activeArea].ingredients.map((ingredient, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-violet-100 text-violet-700 text-xs rounded-full font-medium cursor-pointer hover:bg-violet-200 transition-colors"
                      onClick={() => {
                        debug('Search for ingredient:', ingredient);
                      }}
                    >
                      {ingredient}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Instructions overlay */}
      <div className="fixed bottom-6 right-6 text-sm text-gray-500 bg-white/80 backdrop-blur-sm px-3 py-2 rounded-lg">
        <p className="md:hidden">Touch face areas to explore</p>
        <p className="hidden md:block">Click on face areas to explore</p>
      </div>
    </>
  );
};