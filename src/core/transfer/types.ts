/**
 * Setup Center — Transfer Layer Contract & Types
 *
 * Implements the lifecycle of Transfer:
 * Discover → Transfer → Normalize → Store → Distribute → Instantiate
 */

export type TransferActionType =
  | "install"
  | "download"
  | "scaffold"
  | "sync"
  | "style-switch"
  | "bookmark"
  | "command"
  | "copy"
  | "clone"
  | "setup";

export interface TransferHistoryEntry {
  id: string;
  type: TransferActionType;
  title: string;
  targetId: string;
  targetName: string;
  timestamp: string;
  status: "success" | "warning" | "error" | "info";
  summary: string;
  metadata?: Record<string, unknown>;
}

export type DownloadStatus = "idle" | "downloading" | "completed" | "failed" | "cancelled";

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  sizeBytes?: number;
  downloadedBytes: number;
  progress?: number; // 0 - 100, undefined when total size is unknown / indeterminate
  status: DownloadStatus;
  startedAt: string;
  completedAt?: string;
  destinationPath?: string;
  sha256?: string;
  sha256Verified?: boolean;
  error?: string;
}

export interface ScaffoldOptions {
  templateId: string;
  templateName: string;
  projectName: string;
  targetDir: string;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "uv";
  openInCode?: boolean;
  steps?: import("../vault/types").ScaffoldStep[];
}

export type ScaffoldOutcome = "prepared" | "executed" | "failed";

export interface ScaffoldResult {
  ok: boolean;
  outcome: ScaffoldOutcome;
  preparedOnly: boolean;
  targetPath: string;
  commandExecuted?: string;
  steps?: import("../vault/types").ScaffoldStep[];
  message: string;
  error?: string;
}

export interface TransferInboxItem {
  id: string;
  url: string;
  title?: string;
  note?: string;
  suggestedType?: "resource" | "template" | "style" | "pattern" | "skill" | "unknown";
  suggestedCategory?: string;
  capturedAt: string;
  status: "pending" | "processed" | "rejected";
}
