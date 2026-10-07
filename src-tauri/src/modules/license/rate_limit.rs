//! Local Activation Attempt Limiter & Anti-Brute-Force Protection (Issue A09).
//!
//! Mitigates guessing and automated key brute-forcing by introducing
//! exponential lockout intervals upon consecutive activation failures.

use crate::model::{AppError, AppResult};
use std::sync::{Mutex, OnceLock};

/// State of activation attempts.
#[derive(Debug, Clone)]
pub struct AttemptLimiterState {
    pub consecutive_failures: u32,
    pub last_failure_timestamp: u64,
    pub total_attempts: u64,
}

impl Default for AttemptLimiterState {
    fn default() -> Self {
        Self {
            consecutive_failures: 0,
            last_failure_timestamp: 0,
            total_attempts: 0,
        }
    }
}

/// Activation rate limiter service.
pub struct ActivationAttemptLimiter {
    state: Mutex<AttemptLimiterState>,
}

impl ActivationAttemptLimiter {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(AttemptLimiterState::default()),
        }
    }

    /// Checks if a new activation attempt is permitted at `now_secs`.
    /// Returns `Ok(())` if permitted, or an `AppError` detailing remaining backoff time.
    pub fn check_allowed(&self, now_secs: u64) -> AppResult<()> {
        let guard = self
            .state
            .lock()
            .map_err(|_| AppError::Internal("激活限流器锁异常".to_string()))?;

        let backoff_seconds = Self::calculate_backoff_seconds(guard.consecutive_failures);
        if backoff_seconds == 0 {
            return Ok(());
        }

        let elapsed = now_secs.saturating_sub(guard.last_failure_timestamp);
        if elapsed < backoff_seconds {
            let remaining = backoff_seconds - elapsed;
            return Err(AppError::Internal(format!(
                "激活尝试过于频繁：已连续失败 {} 次。为保护系统安全，请在 {} 秒后重试。",
                guard.consecutive_failures, remaining
            )));
        }

        Ok(())
    }

    /// Records an activation failure at `now_secs`.
    pub fn record_failure(&self, now_secs: u64) {
        if let Ok(mut guard) = self.state.lock() {
            guard.consecutive_failures = guard.consecutive_failures.saturating_add(1);
            guard.last_failure_timestamp = now_secs;
            guard.total_attempts = guard.total_attempts.saturating_add(1);
        }
    }

    /// Records an activation success, resetting failure backoff.
    pub fn record_success(&self) {
        if let Ok(mut guard) = self.state.lock() {
            guard.consecutive_failures = 0;
            guard.last_failure_timestamp = 0;
        }
    }

    /// Returns the backoff penalty in seconds based on consecutive failure count.
    fn calculate_backoff_seconds(failures: u32) -> u64 {
        match failures {
            0..=4 => 0,          // First 4 attempts: no delay
            5..=7 => 15,         // 5-7 attempts: 15s delay
            8..=9 => 60,         // 8-9 attempts: 1 minute delay
            10..=14 => 300,      // 10-14 attempts: 5 minutes delay
            _ => 900,            // 15+ attempts: 15 minutes delay
        }
    }

    /// Returns a snapshot of limiter metrics for diagnosis.
    pub fn snapshot(&self) -> AttemptLimiterState {
        self.state
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

static GLOBAL_LIMITER: OnceLock<ActivationAttemptLimiter> = OnceLock::new();

pub fn limiter() -> &'static ActivationAttemptLimiter {
    GLOBAL_LIMITER.get_or_init(ActivationAttemptLimiter::new)
}

/// Helper function to check whether an activation is currently allowed.
pub fn check_attempt_allowed() -> AppResult<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    limiter().check_allowed(now)
}

/// Helper function to record an activation attempt failure.
pub fn record_attempt_failure() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    limiter().record_failure(now);
}

/// Helper function to record an activation attempt success.
pub fn record_attempt_success() {
    limiter().record_success();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backoff_progression() {
        let limiter = ActivationAttemptLimiter::new();
        let base_time = 1000u64;

        // 4 failures: no delay
        for _ in 0..4 {
            assert!(limiter.check_allowed(base_time).is_ok());
            limiter.record_failure(base_time);
        }
        assert!(limiter.check_allowed(base_time).is_ok());

        // 5th failure: triggers 15s delay
        limiter.record_failure(base_time);
        assert!(limiter.check_allowed(base_time + 5).is_err());
        assert!(limiter.check_allowed(base_time + 14).is_err());
        assert!(limiter.check_allowed(base_time + 15).is_ok());

        // Success resets
        limiter.record_success();
        assert_eq!(limiter.snapshot().consecutive_failures, 0);
        assert!(limiter.check_allowed(base_time + 16).is_ok());
    }
}
