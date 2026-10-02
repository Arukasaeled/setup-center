/**
 * Core Content Subsystem Boundary
 *
 * Defines the contract boundary for static and future remote content
 * distribution (software packages, style bundles, learning modules).
 */

export interface RemoteContentEndpoint {
  manifestUrl: string;
  checkIntervalMs?: number;
}

export interface RemoteUpdateStatus {
  lastCheckedAt: string | null;
  hasUpdate: boolean;
  targetVersion?: string;
}
