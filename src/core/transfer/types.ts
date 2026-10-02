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
  | "bookmark";

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
  progress: number; // 0 - 100
  status: DownloadStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ScaffoldOptions {
  templateId: string;
  templateName: string;
  projectName: string;
  targetDir: string;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "uv";
  openInCode?: boolean;
}

export interface ScaffoldResult {
  ok: boolean;
  targetPath: string;
  commandExecuted?: string;
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
