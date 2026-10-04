# Agent Implementation Brief: Safe-Triangle Submenu

## Core Mental Model
Use when building cascading context menus, mega menus, or flyouts where diagonal mouse movement from parent to submenu causes annoying premature closure due to crossing intervening elements.

## Algorithm & Architecture
1. **P-A-B Points**:
   - Point P: `(e.clientX, e.clientY)`
   - Point A: `(nearEdgeX, Math.max(submenu.top, P.y - maxSpread))`
   - Point B: `(nearEdgeX, Math.min(submenu.bottom, P.y + maxSpread))`
2. **DOM Representation**:
   - A single `div` element with `position: fixed`, bounding box covering `min(P, A, B)` to `max(P, A, B)`.
   - `clipPath: polygon(P, A, B)` mapped relative to the bounding box.
   - `pointer-events: auto` to capture cursor hovering while moving toward the submenu.
3. **Height Capping**:
   - `maxSpread` (e.g. 90px) prevents a tall submenu from casting a massive triangular shadow over the entire parent menu list, allowing intentional vertical navigation to adjacent items.
