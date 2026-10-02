/**
 * Setup Center — Direct Asset Downloader
 *
 * Downloads external archives, fonts, tools, and code templates.
 * Provides progressive feedback, cancellation support, and Transfer history logging.
 */

import type { DownloadTask } from "./types";
import { TransferHistory } from "./history";

type DownloadListener = (tasks: DownloadTask[]) => void;

class AssetDownloaderManager {
  private tasks: Map<string, DownloadTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private listeners: Set<DownloadListener> = new Set();

  public subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  public getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  private notify(): void {
    const list = this.getTasks();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.error("[Downloader] Listener error:", err);
      }
    }
  }

  /**
   * Start downloading an asset
   */
  public async startDownload(url: string, filename: string, title?: string): Promise<DownloadTask> {
    const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: DownloadTask = {
      id: taskId,
      url,
      filename,
      downloadedBytes: 0,
      progress: 0,
      status: "downloading",
      startedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, task);
    this.notify();

    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    try {
      // If running inside browser or Tauri webview, we can stream or trigger download
      // Simulating a robust chunked fetch with progress tracking
      const res = await fetch(url, { signal: controller.signal, mode: "cors" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentLength = res.headers.get("content-length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
      task.sizeBytes = totalBytes;

      if (!res.body) {
        // Fallback for bodies without reader
        const blob = await res.blob();
        this.saveBlob(blob, filename);
        task.progress = 100;
        task.status = "completed";
        task.completedAt = new Date().toISOString();
      } else {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            task.downloadedBytes = received;
            if (totalBytes && totalBytes > 0) {
              task.progress = Math.min(99, Math.round((received / totalBytes) * 100));
            } else {
              // Simulated incremental progress if no content-length
              task.progress = Math.min(95, Math.round(received / 1024 / 10));
            }
            this.notify();
          }
        }

        const blob = new Blob(chunks as unknown as BlobPart[]);
        this.saveBlob(blob, filename);
        task.progress = 100;
        task.status = "completed";
        task.completedAt = new Date().toISOString();
      }

      TransferHistory.record({
        type: "download",
        title: "资产下载完成",
        targetId: taskId,
        targetName: title || filename,
        status: "success",
        summary: `成功下载文件「${filename}」(${Math.round(task.downloadedBytes / 1024)} KB)`,
        metadata: { url, filename, sizeBytes: task.downloadedBytes },
      });

      this.notify();
      return task;
    } catch (err) {
      if (controller.signal.aborted) {
        task.status = "cancelled";
        task.error = "用户取消下载";
        TransferHistory.record({
          type: "download",
          title: "下载已取消",
          targetId: taskId,
          targetName: title || filename,
          status: "warning",
          summary: `已取消「${filename}」的下载任务`,
        });
      } else {
        task.status = "failed";
        const msg = err instanceof Error ? err.message : String(err);
        task.error = msg;
        TransferHistory.record({
          type: "download",
          title: "下载失败",
          targetId: taskId,
          targetName: title || filename,
          status: "error",
          summary: `下载「${filename}」时遇到错误: ${msg}`,
        });
      }
      this.notify();
      return task;
    } finally {
      this.abortControllers.delete(taskId);
    }
  }

  /**
   * Cancel an active download task
   */
  public cancelDownload(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
      return true;
    }
    return false;
  }

  private saveBlob(blob: Blob, filename: string): void {
    if (typeof document === "undefined") return;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}

export const AssetDownloader = new AssetDownloaderManager();
