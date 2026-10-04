/**
 * Datasets for Persistent Statusline Prototype
 *
 * Demonstrates domain portability between:
 * 1. AI Agent Runtime Context
 * 2. Generic Continuous Build & Test Pipeline
 */

export interface StatusMeter {
  label: string;
  value: number; // 0 - 100
  warnThreshold?: number; // default 70
  critThreshold?: number; // default 85
}

export interface ActivityEvent {
  id: string;
  type: "tool" | "agent" | "task" | "build";
  name: string;
  count?: number; // for collapsing
  status: "running" | "completed" | "warn";
  elapsedMs?: number;
  detail?: string;
}

export interface TodoStatus {
  current?: string;
  doneCount: number;
  totalCount: number;
}

export interface StatuslineDataset {
  id: string;
  title: string;
  badge: {
    label: string;
    variant: "cyan" | "purple" | "emerald" | "amber";
  };
  meter: StatusMeter;
  meta: string[];
  tools: ActivityEvent[];
  agents: ActivityEvent[];
  todos: TodoStatus;
  absoluteExpiry: string; // e.g. "21:40"
}

// Dataset A: AI Agent Runtime
export const AGENT_RUNTIME_DATASET: StatuslineDataset = {
  id: "agent-runtime",
  title: "AI Agent Session Runtime",
  badge: {
    label: "DeepSeek-V3",
    variant: "cyan",
  },
  meter: {
    label: "Context",
    value: 68, // 68% -> normal/warn boundary
    warnThreshold: 70,
    critThreshold: 85,
  },
  meta: ["8 rules", "4 MCPs", "git:(feature/ui-parts*)", "tokens: 136k / 200k"],
  tools: [
    { id: "t1", type: "tool", name: "Read", count: 4, status: "completed" },
    { id: "t2", type: "tool", name: "Grep", count: 2, status: "completed" },
    { id: "t3", type: "tool", name: "Edit: types.ts", status: "running" },
  ],
  agents: [
    {
      id: "a1",
      type: "agent",
      name: "Research Subagent",
      status: "running",
      elapsedMs: 14000,
      detail: "Scanning design tokens in AST",
    },
    {
      id: "a2",
      type: "agent",
      name: "Validator",
      status: "completed",
      elapsedMs: 2300,
      detail: "Schema conformity verified",
    },
  ],
  todos: {
    current: "Implement persistent statusline prototype",
    doneCount: 2,
    totalCount: 3,
  },
  absoluteExpiry: "21:45",
};

// Dataset B: Generic Build Runtime
export const BUILD_RUNTIME_DATASET: StatuslineDataset = {
  id: "build-pipeline",
  title: "Generic CI / Build Pipeline Runtime",
  badge: {
    label: "Vite + Cargo x64",
    variant: "purple",
  },
  meter: {
    label: "Memory RAM",
    value: 88, // 88% -> crit threshold (>85%)! Red status bar!
    warnThreshold: 75,
    critThreshold: 85,
  },
  meta: ["14 crates", "320 modules", "arch: x86_64-pc-windows", "threads: 16"],
  tools: [
    { id: "b1", type: "build", name: "rustc", count: 8, status: "completed" },
    { id: "b2", type: "build", name: "tsc --noEmit", count: 1, status: "completed" },
    { id: "b3", type: "build", name: "cargo-tauri bundle", status: "running" },
  ],
  agents: [
    {
      id: "test1",
      type: "agent",
      name: "Lib Unit Test Suite",
      status: "completed",
      elapsedMs: 58000,
      detail: "679 tests passed, 0 failed",
    },
  ],
  todos: {
    current: "Compiling release binary and NSIS bundle",
    doneCount: 4,
    totalCount: 5,
  },
  absoluteExpiry: "23:59",
};
