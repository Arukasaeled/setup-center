//! Task Coordination, Mutation Lease, Process Table, and Single Instance Guard
//!
//! Provides:
//! 1. `NamedSingleInstanceGuard`: Windows named mutex (`Local\SetupCenter.<SID>.app.aistudent.setup`)
//!    cross-process single instance protection.
//! 2. `JobObjectGuard`: Windows Job Object managing child process tree lifetime with kill-on-close.
//! 3. `ProcessTable`: Generation-checked process registration preventing race conditions.
//! 4. `TaskManager` & `MutationLease`: Unified mutual exclusion for all system-mutating operations
//!    (Install, Bootstrap, Plugin, Template, Clean) with RAII Drop cleanup.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::modules::executor::CancelFlag;

// ---------------------------------------------------------------------------
// 1. Windows Named Mutex Single Instance Guard
// ---------------------------------------------------------------------------

pub struct NamedSingleInstanceGuard {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// Safety: The HANDLE is exclusive to this instance and safe to pass across threads
unsafe impl Send for NamedSingleInstanceGuard {}
unsafe impl Sync for NamedSingleInstanceGuard {}

impl NamedSingleInstanceGuard {
    /// Attempts to acquire the Windows Named Mutex for the current user session.
    /// Fails immediately if another instance already holds the mutex.
    pub fn acquire() -> Result<Self, String> {
        #[cfg(windows)]
        {
            let sid = get_current_user_sid()?;
            let mutex_name = format!("Local\\SetupCenter.{sid}.app.aistudent.setup\0");
            let wide_name: Vec<u16> = mutex_name.encode_utf16().collect();

            unsafe {
                let handle = windows_sys::Win32::System::Threading::CreateMutexW(
                    std::ptr::null(),
                    0, // FALSE: do not request initial ownership, just create/open
                    wide_name.as_ptr(),
                );

                if handle == 0 || handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
                    let err = windows_sys::Win32::Foundation::GetLastError();
                    return Err(format!("无法创建单实例互斥体 (错误代码 {err})"));
                }

                if windows_sys::Win32::Foundation::GetLastError()
                    == windows_sys::Win32::Foundation::ERROR_ALREADY_EXISTS
                {
                    windows_sys::Win32::Foundation::CloseHandle(handle);
                    return Err(
                        "已有另一个 Setup Center 实例正在当前用户会话中运行，已退出第二实例。"
                            .into(),
                    );
                }

                Ok(Self { handle })
            }
        }

        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }
}

impl Drop for NamedSingleInstanceGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if self.handle != 0
                && self.handle != windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE
            {
                unsafe {
                    windows_sys::Win32::Foundation::CloseHandle(self.handle);
                }
            }
        }
    }
}

#[cfg(windows)]
fn get_current_user_sid() -> Result<String, String> {
    unsafe {
        let mut token: windows_sys::Win32::Foundation::HANDLE = 0;
        let cur_proc = windows_sys::Win32::System::Threading::GetCurrentProcess();
        if windows_sys::Win32::System::Threading::OpenProcessToken(
            cur_proc,
            windows_sys::Win32::Security::TOKEN_QUERY,
            &mut token,
        ) == 0
        {
            let err = windows_sys::Win32::Foundation::GetLastError();
            return Err(format!("OpenProcessToken 失败 (错误代码 {err})"));
        }

        let mut len = 0u32;
        windows_sys::Win32::Security::GetTokenInformation(
            token,
            windows_sys::Win32::Security::TokenUser,
            std::ptr::null_mut(),
            0,
            &mut len,
        );

        if len == 0 {
            windows_sys::Win32::Foundation::CloseHandle(token);
            return Err("GetTokenInformation 获取长度失败".into());
        }

        let mut buf = vec![0u8; len as usize];
        if windows_sys::Win32::Security::GetTokenInformation(
            token,
            windows_sys::Win32::Security::TokenUser,
            buf.as_mut_ptr() as *mut _,
            len,
            &mut len,
        ) == 0
        {
            let err = windows_sys::Win32::Foundation::GetLastError();
            windows_sys::Win32::Foundation::CloseHandle(token);
            return Err(format!("GetTokenInformation 失败 (错误代码 {err})"));
        }
        windows_sys::Win32::Foundation::CloseHandle(token);

        let token_user = &*(buf.as_ptr() as *const windows_sys::Win32::Security::TOKEN_USER);
        let mut sid_str: *mut u16 = std::ptr::null_mut();
        if windows_sys::Win32::Security_Authorization::ConvertSidToStringSidW(
            token_user.User.Sid,
            &mut sid_str,
        ) == 0
        {
            let err = windows_sys::Win32::Foundation::GetLastError();
            return Err(format!("ConvertSidToStringSidW 失败 (错误代码 {err})"));
        }

        let mut utf16_slice = Vec::new();
        let mut ptr = sid_str;
        while *ptr != 0 {
            utf16_slice.push(*ptr);
            ptr = ptr.add(1);
        }
        windows_sys::Win32::System::Memory::LocalFree(sid_str as _);

        String::from_utf16(&utf16_slice).map_err(|e| format!("SID UTF-16 解码失败: {e}"))
    }
}

// ---------------------------------------------------------------------------
// 2. Windows Job Object Process Guard
// ---------------------------------------------------------------------------

pub struct JobObjectGuard {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

unsafe impl Send for JobObjectGuard {}
unsafe impl Sync for JobObjectGuard {}

impl JobObjectGuard {
    pub fn new() -> Result<Self, String> {
        #[cfg(windows)]
        {
            unsafe {
                let job = windows_sys::Win32::System::JobObjects::CreateJobObjectW(
                    std::ptr::null(),
                    std::ptr::null(),
                );
                if job == 0 || job == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
                    let err = windows_sys::Win32::Foundation::GetLastError();
                    return Err(format!("创建 Job Object 失败 (错误代码 {err})"));
                }

                let mut info: windows_sys::Win32::System::JobObjects::JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
                    std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags =
                    windows_sys::Win32::System::JobObjects::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let res = windows_sys::Win32::System::JobObjects::SetInformationJobObject(
                    job,
                    windows_sys::Win32::System::JobObjects::JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<
                        windows_sys::Win32::System::JobObjects::JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    >() as u32,
                );

                if res == 0 {
                    let err = windows_sys::Win32::Foundation::GetLastError();
                    windows_sys::Win32::Foundation::CloseHandle(job);
                    return Err(format!("配置 Job Object 失败 (错误代码 {err})"));
                }

                Ok(Self { handle: job })
            }
        }

        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }

    #[cfg(windows)]
    pub fn assign_process(
        &self,
        process_handle: windows_sys::Win32::Foundation::HANDLE,
    ) -> Result<(), String> {
        unsafe {
            let res = windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                self.handle,
                process_handle,
            );
            if res == 0 {
                let err = windows_sys::Win32::Foundation::GetLastError();
                return Err(format!("分配进程至 Job Object 失败 (错误代码 {err})"));
            }
            Ok(())
        }
    }

    pub fn terminate(&self, exit_code: u32) -> Result<(), String> {
        #[cfg(windows)]
        {
            unsafe {
                let res = windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    self.handle,
                    exit_code,
                );
                if res == 0 {
                    let err = windows_sys::Win32::Foundation::GetLastError();
                    return Err(format!("终止 Job Object 失败 (错误代码 {err})"));
                }
                Ok(())
            }
        }

        #[cfg(not(windows))]
        {
            let _ = exit_code;
            Ok(())
        }
    }
}

impl std::fmt::Debug for JobObjectGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        #[cfg(windows)]
        write!(f, "JobObjectGuard({:?})", self.handle)?;
        #[cfg(not(windows))]
        write!(f, "JobObjectGuard")?;
        Ok(())
    }
}

impl Drop for JobObjectGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if self.handle != 0
                && self.handle != windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE
            {
                unsafe {
                    windows_sys::Win32::Foundation::CloseHandle(self.handle);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Process Table (Generation-Checked & Identity-Verified)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ProcessRegistration {
    pub task_id: String,
    pub attempt_id: String,
    pub generation: u64,
    pub pid: u32,
    pub job: Option<Arc<JobObjectGuard>>,
    pub registered_at: Instant,
}

#[derive(Default)]
pub struct ProcessTable {
    entries: Mutex<HashMap<String, ProcessRegistration>>,
    generation_counter: AtomicU64,
}

impl ProcessTable {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            generation_counter: AtomicU64::new(1),
        }
    }

    /// Allocates a new monotonically increasing generation identifier.
    pub fn next_generation(&self) -> u64 {
        self.generation_counter.fetch_add(1, Ordering::SeqCst)
    }

    /// Registers a child process under (task_id, attempt_id, generation).
    /// Rejects duplicate registration for the same attempt_id.
    pub fn register(
        &self,
        task_id: &str,
        attempt_id: &str,
        generation: u64,
        pid: u32,
        job: Option<Arc<JobObjectGuard>>,
    ) -> Result<(), String> {
        let mut map = self
            .entries
            .lock()
            .map_err(|e| format!("进程表锁破坏: {e}"))?;

        if map.contains_key(attempt_id) {
            return Err(format!("attemptId '{attempt_id}' 已在进程表中，拒绝重复注册"));
        }

        map.insert(
            attempt_id.to_string(),
            ProcessRegistration {
                task_id: task_id.to_string(),
                attempt_id: attempt_id.to_string(),
                generation,
                pid,
                job,
                registered_at: Instant::now(),
            },
        );
        Ok(())
    }

    /// Unregisters an entry, strictly checking that the generation matches.
    /// Older or mismatched task attempts cannot delete entries belonging to newer attempts.
    pub fn unregister(&self, attempt_id: &str, generation: u64) -> bool {
        let Ok(mut map) = self.entries.lock() else {
            return false;
        };

        if let Some(entry) = map.get(attempt_id) {
            if entry.generation == generation {
                map.remove(attempt_id);
                return true;
            }
        }
        false
    }

    /// Finds all PIDs registered under the specified task_id.
    pub fn pids_for_task(&self, task_id: &str) -> Vec<u32> {
        let Ok(map) = self.entries.lock() else {
            return Vec::new();
        };
        map.values()
            .filter(|e| e.task_id == task_id)
            .map(|e| e.pid)
            .collect()
    }

    /// Cancels all processes and jobs registered under the specified attempt_id or task_id.
    pub fn cancel(&self, attempt_or_task_id: &str) -> Result<bool, String> {
        let entries_to_cancel: Vec<ProcessRegistration> = {
            let Ok(map) = self.entries.lock() else {
                return Ok(false);
            };
            map.values()
                .filter(|e| e.attempt_id == attempt_or_task_id || e.task_id == attempt_or_task_id)
                .cloned()
                .collect()
        };

        if entries_to_cancel.is_empty() {
            return Ok(false);
        }

        for entry in entries_to_cancel {
            if let Some(ref job) = entry.job {
                let _ = job.terminate(1);
            }
            #[cfg(windows)]
            {
                let mut cmd = std::process::Command::new("taskkill");
                cmd.args(["/F", "/T", "/PID", &entry.pid.to_string()]);
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
                let _ = cmd.output();
            }
            #[cfg(not(windows))]
            {
                let mut cmd = std::process::Command::new("kill");
                cmd.args(["-9", &entry.pid.to_string()]);
                let _ = cmd.output();
            }
        }
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// 4. MutationLease & Unified Task Manager
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MutationKind {
    Install,
    Bootstrap,
    Plugin,
    Template,
    Clean,
}

impl MutationKind {
    pub fn label(self) -> &'static str {
        match self {
            MutationKind::Install => "软件安装",
            MutationKind::Bootstrap => "开发环境配置",
            MutationKind::Plugin => "插件执行",
            MutationKind::Template => "模板生成",
            MutationKind::Clean => "缓存清理",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskFinalStatus {
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConflictError {
    pub active_task_id: String,
    pub active_kind: MutationKind,
    pub message: String,
}

pub struct ActiveTaskState {
    pub task_id: String,
    pub request_id: Option<String>,
    pub kind: MutationKind,
    pub cancel_flag: CancelFlag,
    pub started_at: Instant,
    pub job_object: Option<Arc<JobObjectGuard>>,
}

/// RAII Lease representing ownership of the system mutation lock.
/// Dropping the lease releases the mutation lock so tasks are never stuck busy on error or panic.
pub struct MutationLease {
    pub task_id: String,
    pub request_id: Option<String>,
    pub kind: MutationKind,
    pub cancel_flag: CancelFlag,
    pub job_object: Option<Arc<JobObjectGuard>>,
    manager: Arc<TaskManager>,
    completed: AtomicBool,
}

impl MutationLease {
    /// Marks the task as completed with an explicit final status and releases the lease.
    pub fn finish(self, status: TaskFinalStatus) {
        self.completed.store(true, Ordering::SeqCst);
        self.manager.release_lease(&self.task_id, status);
    }

    /// Accesses the task's dedicated cooperative cancellation flag.
    pub fn cancel_flag(&self) -> &CancelFlag {
        &self.cancel_flag
    }
}

impl Drop for MutationLease {
    fn drop(&mut self) {
        if !self.completed.load(Ordering::SeqCst) {
            // Task dropped prematurely (e.g. error, worker panic, early return)
            self.manager.release_lease(&self.task_id, TaskFinalStatus::Interrupted);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEventPayload {
    pub task_id: String,
    pub sequence: u64,
    pub stream: String,
    pub text: String,
    pub timestamp: String,
    pub truncated: bool,
    pub exit_code: Option<i32>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusView {
    pub task_id: String,
    pub status: String,
    pub active_kind: Option<MutationKind>,
    pub exit_code: Option<i32>,
}

pub struct TaskManager {
    active: Mutex<Option<ActiveTaskState>>,
    process_table: ProcessTable,
    event_buffer: Mutex<HashMap<String, Vec<TaskEventPayload>>>,
    event_seq: AtomicU64,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            process_table: ProcessTable::new(),
            event_buffer: Mutex::new(HashMap::new()),
            event_seq: AtomicU64::new(0),
        }
    }

    pub fn emit_event(&self, task_id: &str, stream: &str, text: &str) {
        let seq = self.event_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = TaskEventPayload {
            task_id: task_id.to_string(),
            sequence: seq,
            stream: stream.to_string(),
            text: text.to_string(),
            timestamp: crate::modules::detect::now_iso8601(),
            truncated: false,
            exit_code: None,
            status: None,
        };
        if let Ok(mut map) = self.event_buffer.lock() {
            let buf = map.entry(task_id.to_string()).or_default();
            buf.push(event);
            if buf.len() > 1000 {
                buf.remove(0);
            }
        }
    }

    pub fn get_task_events(&self, task_id: &str, after_sequence: u64) -> Vec<TaskEventPayload> {
        if let Ok(map) = self.event_buffer.lock() {
            if let Some(buf) = map.get(task_id) {
                return buf
                    .iter()
                    .filter(|e| e.sequence > after_sequence)
                    .cloned()
                    .collect();
            }
        }
        Vec::new()
    }

    pub fn query_task(&self, task_id: &str) -> TaskStatusView {
        if let Ok(active) = self.active.lock() {
            if let Some(ref act) = *active {
                if act.task_id == task_id {
                    return TaskStatusView {
                        task_id: task_id.to_string(),
                        status: "running".to_string(),
                        active_kind: Some(act.kind),
                        exit_code: None,
                    };
                }
            }
        }
        TaskStatusView {
            task_id: task_id.to_string(),
            status: "succeeded".to_string(),
            active_kind: None,
            exit_code: Some(0),
        }
    }

    /// Attempts to acquire an exclusive MutationLease for a mutating task.
    /// Rejects if ANY mutating task is already in progress (mutual exclusion in all directions).
    pub fn try_begin_mutation(
        self: &Arc<Self>,
        kind: MutationKind,
        request_id: Option<String>,
    ) -> Result<MutationLease, TaskConflictError> {
        let mut lock = self.active.lock().map_err(|e| TaskConflictError {
            active_task_id: "unknown".into(),
            active_kind: kind,
            message: format!("任务管理器互斥锁破坏: {e}"),
        })?;

        if let Some(ref active) = *lock {
            return Err(TaskConflictError {
                active_task_id: active.task_id.clone(),
                active_kind: active.kind,
                message: format!(
                    "当前正在执行任务 '{}'（{}），无法同时启动新的任务（{}）。",
                    active.task_id,
                    active.kind.label(),
                    kind.label()
                ),
            });
        }

        let now = Instant::now();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let task_id = format!("task-{nanos}-{}", std::process::id());
        let cancel_flag = CancelFlag::new();
        let job_object = JobObjectGuard::new().ok().map(Arc::new);

        *lock = Some(ActiveTaskState {
            task_id: task_id.clone(),
            request_id: request_id.clone(),
            kind,
            cancel_flag: cancel_flag.clone(),
            started_at: now,
            job_object: job_object.clone(),
        });

        Ok(MutationLease {
            task_id,
            request_id,
            kind,
            cancel_flag,
            job_object,
            manager: Arc::clone(self),
            completed: AtomicBool::new(false),
        })
    }

    /// Internal release called on finish() or Drop.
    fn release_lease(&self, task_id: &str, _status: TaskFinalStatus) {
        if let Ok(mut lock) = self.active.lock() {
            if let Some(ref active) = *lock {
                if active.task_id == task_id {
                    *lock = None;
                }
            }
        }
    }

    /// Cancels a task by its task_id. Sets cooperative cancel flag and terminates process tree.
    pub fn cancel_task(&self, task_id: &str) -> Result<bool, String> {
        let (found, cancel_flag, job_opt) = {
            let lock = self.active.lock().map_err(|e| format!("锁破坏: {e}"))?;
            match lock.as_ref() {
                Some(active) if active.task_id == task_id => (
                    true,
                    Some(active.cancel_flag.clone()),
                    active.job_object.clone(),
                ),
                _ => (false, None, None),
            }
        };

        if !found {
            return Ok(false);
        }

        if let Some(flag) = cancel_flag {
            flag.cancel();
        }

        // Terminate full process tree using Windows Job Object if available
        if let Some(job) = job_opt {
            let _ = job.terminate(1);
        }

        // Also terminate any registered individual PIDs
        let pids = self.process_table.pids_for_task(task_id);
        for pid in pids {
            #[cfg(windows)]
            {
                let mut cmd = std::process::Command::new("taskkill");
                cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                cmd.creation_flags(crate::modules::detect::CREATE_NO_WINDOW);
                let _ = cmd.output();
            }
            #[cfg(not(windows))]
            {
                let mut cmd = std::process::Command::new("kill");
                cmd.args(["-9", &pid.to_string()]);
                let _ = cmd.output();
            }
        }

        Ok(true)
    }

    /// Checks if a mutation is currently running.
    pub fn is_busy(&self) -> bool {
        self.active
            .lock()
            .ok()
            .map(|l| l.is_some())
            .unwrap_or(false)
    }

    /// Returns the active task id, if any.
    pub fn active_task_id(&self) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|l| l.as_ref().map(|a| a.task_id.clone()))
    }

    /// Returns the active mutation kind, if any.
    pub fn active_kind(&self) -> Option<MutationKind> {
        self.active
            .lock()
            .ok()
            .and_then(|l| l.as_ref().map(|a| a.kind))
    }

    pub fn process_table(&self) -> &ProcessTable {
        &self.process_table
    }
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_table_generation_check() {
        let table = ProcessTable::new();
        let gen1 = table.next_generation();
        assert!(table.register("task-1", "attempt-1", gen1, 1001, None).is_ok());

        // Duplicate registration for same attempt is rejected
        assert!(table.register("task-1", "attempt-1", gen1, 1002, None).is_err());

        // Wrong generation cannot unregister
        assert!(!table.unregister("attempt-1", gen1 + 99));

        // Matching generation unregisters cleanly
        assert!(table.unregister("attempt-1", gen1));
    }

    #[test]
    fn task_manager_mutual_exclusion_and_drop_cleanup() {
        let manager = Arc::new(TaskManager::new());
        assert!(!manager.is_busy());

        let lease1 = manager.try_begin_mutation(MutationKind::Install, None).unwrap();
        assert!(manager.is_busy());
        assert_eq!(manager.active_kind(), Some(MutationKind::Install));

        // Concurrent mutation rejected
        let conflict = manager.try_begin_mutation(MutationKind::Bootstrap, None);
        assert!(conflict.is_err());

        // Drop lease1 cleans up
        drop(lease1);
        assert!(!manager.is_busy());

        // Now new mutation succeeds
        let lease2 = manager.try_begin_mutation(MutationKind::Bootstrap, None).unwrap();
        assert!(manager.is_busy());
        lease2.finish(TaskFinalStatus::Succeeded);
        assert!(!manager.is_busy());
    }
}
