/**
 * Setup Center — Build Identity & Version Truth
 *
 * Provides build-time injected commit SHA, build timestamp,
 * detected runtime mode (Browser Dev, Tauri Dev, Tauri Production),
 * and cached Vault content version without relying on network or telemetry.
 */

import { isTauri } from "./ipc";
import { getCachedContentVersion } from "../core/vault/cache";

export interface BuildIdentity {
  appVersion: string;
  runtime: "Browser Dev" | "Tauri Dev" | "Tauri Production";
  commitSha: string;
  buildTime: string;
  vaultContentVersion: string;
}

export function getBuildIdentity(): BuildIdentity {
  const commitSha = typeof __APP_COMMIT_SHA__ !== "undefined" ? __APP_COMMIT_SHA__ : "unknown";
  const buildTime = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";
  const isDev = Boolean(import.meta.env.DEV);

  let runtime: "Browser Dev" | "Tauri Dev" | "Tauri Production" = "Browser Dev";
  if (isTauri()) {
    runtime = isDev ? "Tauri Dev" : "Tauri Production";
  }

  const vaultContentVersion = getCachedContentVersion() || "builtin";

  return {
    appVersion: "0.2.1",
    runtime,
    commitSha,
    buildTime,
    vaultContentVersion,
  };
}
