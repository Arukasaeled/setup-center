/**
 * The first-run entry choice: how the customer answered the activation gate.
 *
 * ## Why this is not in the store
 *
 * The gate's answer must survive a restart, and the store has no persistence
 * middleware — it is a plain `create()` with no hydration, deliberately, because
 * the rest of its state is per-run flow state that *should* reset. Adding
 * `persist` to the whole store to remember one flag would make every field of the
 * store durable, which is the opposite of what those fields want.
 *
 * So the flag lives here, on its own, with `localStorage` as the only storage.
 * It is one string; it does not need a Rust command, a database, or a file in
 * `%LOCALAPPDATA%`.
 *
 * ## Precedence
 *
 * A licence beats this flag, always. The flag records "the customer has already
 * been asked", not "the customer is on FREE" — someone who chose FREE and later
 * activated a key is PRO, and must not be described as FREE because an old flag
 * says so. Callers decide the gate from `licenseActive || entry !== null`; this
 * module only stores the answer to having been asked.
 *
 * ## Failure
 *
 * `localStorage` can throw (`SecurityError` in locked-down contexts, quota
 * errors). Every access is guarded: an unavailable store means the flag reads as
 * absent, so the gate shows again. That is the safe direction — showing the gate
 * twice is recoverable; skipping it for someone who never saw it is not.
 */

const KEY = "setup-center.entry";

/** The value stored once the customer has answered the gate. */
export type EntryChoice = "free";

/**
 * Reads the recorded first-run choice.
 *
 * Returns `null` when the customer has not answered yet, when the stored value
 * is not one we wrote, or when storage is unavailable.
 */
export function readEntryChoice(): EntryChoice | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "free" ? "free" : null;
  } catch {
    return null;
  }
}

/**
 * Records that the customer chose FREE.
 *
 * Returns whether the write succeeded. The caller should proceed to the
 * dashboard either way — a failed write means the gate reappears next launch,
 * which is annoying but not broken, and refusing to continue would be worse.
 */
export function writeFreeChoice(): boolean {
  try {
    window.localStorage.setItem(KEY, "free");
    return true;
  } catch {
    return false;
  }
}

/** Clears the recorded choice, so the gate is shown again. Used by tests. */
export function clearEntryChoice(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: the flag is already unreadable, which is the desired end
    // state.
  }
}
