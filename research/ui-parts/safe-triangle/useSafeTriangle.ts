import { useState, useEffect, useCallback, RefObject } from "react";

export interface SafeTriangleOptions {
  enabled?: boolean;
  side?: "right" | "left";
  maxVerticalSpread?: number; // Caps height of the triangle base to prevent engulfing other parent items
}

export interface SafeTriangleState {
  clipPath: string;
  style: React.CSSProperties;
  debugPoints: {
    p: { x: number; y: number }; // cursor
    a: { x: number; y: number }; // near edge top corner (clamped)
    b: { x: number; y: number }; // near edge bottom corner (clamped)
  } | null;
}

/**
 * useSafeTriangle
 *
 * Implements the Linear Safe-Triangle interaction pattern:
 * When moving from parent menu item to a lateral submenu, calculates a dynamic
 * polygon between cursor P and the submenu near-edge [A, B].
 */
export function useSafeTriangle(
  submenuRef: RefObject<HTMLElement | null>,
  options: SafeTriangleOptions = {},
) {
  const { enabled = true, side = "right", maxVerticalSpread = 100 } = options;

  const [triangleState, setTriangleState] = useState<SafeTriangleState>({
    clipPath: "none",
    style: { display: "none" },
    debugPoints: null,
  });

  const updateTriangle = useCallback(
    (e: MouseEvent) => {
      if (!enabled || !submenuRef.current) {
        setTriangleState({ clipPath: "none", style: { display: "none" }, debugPoints: null });
        return;
      }

      const rect = submenuRef.current.getBoundingClientRect();
      const cursorX = e.clientX;
      const cursorY = e.clientY;

      // Determine near-edge X coordinate
      const nearX = side === "right" ? rect.left : rect.right;

      // Height capping: clamp triangle's base spread relative to cursor Y
      // so tall submenus do not block access to sibling menu items
      const nearYTop = Math.max(rect.top, cursorY - maxVerticalSpread);
      const nearYBottom = Math.min(rect.bottom, cursorY + maxVerticalSpread);

      // Check if cursor has already entered the submenu or is on the opposite side
      const hasReachedSubmenu =
        side === "right" ? cursorX >= rect.left : cursorX <= rect.right;

      if (hasReachedSubmenu) {
        // Cursor reached target: collapse safe area
        setTriangleState({ clipPath: "none", style: { display: "none" }, debugPoints: null });
        return;
      }

      // Compute bounding box containing the triangle
      const minX = Math.min(cursorX, nearX);
      const maxX = Math.max(cursorX, nearX);
      const minY = Math.min(cursorY, nearYTop);
      const maxY = Math.max(cursorY, nearYBottom);

      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);

      // Coordinates relative to the bounding box (in percentages or px)
      const relPx = (cursorX - minX);
      const relPy = (cursorY - minY);
      const relAx = (nearX - minX);
      const relAy = (nearYTop - minY);
      const relBx = (nearX - minX);
      const relBy = (nearYBottom - minY);

      const clipPath = `polygon(${relPx}px ${relPy}px, ${relAx}px ${relAy}px, ${relBx}px ${relBy}px)`;

      setTriangleState({
        clipPath,
        style: {
          position: "fixed",
          left: `${minX}px`,
          top: `${minY}px`,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: "auto", // Essential: captures pointer movement
          zIndex: 9999,
          clipPath,
        },
        debugPoints: {
          p: { x: cursorX, y: cursorY },
          a: { x: nearX, y: nearYTop },
          b: { x: nearX, y: nearYBottom },
        },
      });
    },
    [enabled, side, maxVerticalSpread, submenuRef],
  );

  useEffect(() => {
    if (!enabled) return;

    const handlePointerMove = (e: MouseEvent) => {
      updateTriangle(e);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [enabled, updateTriangle]);

  return triangleState;
}
