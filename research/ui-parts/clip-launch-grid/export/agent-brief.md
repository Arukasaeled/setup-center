# Agent Implementation Brief: Clip Launch Grid

## Core Mental Model
Use when building multi-channel or multi-stage orchestration interfaces where:
1. Channels run in parallel but can each only execute ONE task/item at a time (Mutual Exclusion).
2. Sets of tasks across channels form synchronized phases or scenes (Row Trigger).
3. The user needs random access to individual cells without being bound to a linear stepper.

## State Representation
```ts
interface GridState {
  // Keyed by trackId. Value is active slotId or null.
  // Mutually exclusive: changing a track's value overwrites its previous active slot.
  activeTracks: Record<string, string | null>;
}
```

## Critical Invariants
- When a cell is triggered: `activeTracks[trackId] = (current === cellId) ? null : cellId`.
- When a row is launched: for every track, if cell exists in row -> activate it; if not -> clear track UNLESS cell has `hasStop: false`.
- Grid styling must use pure CSS Grid with `grid-template-columns: var(--scene-width) repeat(var(--tracks-count), 1fr)`.
