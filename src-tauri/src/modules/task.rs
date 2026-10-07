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

                if handle.is_null() || handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
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
            if !self.handle.is_null()
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
        let mut token: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
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
        if windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW(
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
        windows_sys::Win32::Foundation::LocalFree(sid_str as _);

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
                if job.is_null() || job == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
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

    pub fn active_processes(&self) -> Result<u32, String> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::JobObjects::*;
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
            if QueryInformationJobObject(
                self.handle,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            ) == 0 {
                return Err(format!("无法确认进程树是否退出：{}", std::io::Error::last_os_error()));
            }
            Ok(info.ActiveProcesses)
        }
        #[cfg(not(windows))]
        { Err("当前平台无法通过 Job Object 确认进程树状态".into()) }
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
            if !self.handle.is_null()
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
            let map = self.entries.lock().map_err(|e| format!("进程表锁破坏: {e}"))?;
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
                job.terminate(1)?;
                continue;
            }
            return Err(format!("执行 {} 缺少受控进程树句柄，不能仅凭 PID 终止或确认回收", entry.attempt_id));
        }
        Ok(true)
    }

    pub fn confirm_exited(&self, task_id: &str) -> Result<(), String> {
        let mut map = self.entries.lock().map_err(|e| format!("进程表锁破坏: {e}"))?;
        for entry in map.values().filter(|e| e.task_id == task_id) {
            let job = entry.job.as_ref().ok_or("缺少进程树句柄，无法确认旧执行已结束")?;
            if job.active_processes()? != 0 { return Err("旧任务仍有进程运行，不能恢复".into()); }
        }
        map.retain(|_, entry| entry.task_id != task_id);
        Ok(())
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

pub use crate::model::TaskStatus;
pub type TaskFinalStatus = TaskStatus;

#[derive(Debug, Clone)]
pub struct TaskRecord {
    pub task_id: String,
    pub status: TaskStatus,
    pub active_kind: Option<MutationKind>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct TaskAnomalyBlocker {
    pub task_id: String,
    pub reason: String,
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
    pub manager: Arc<TaskManager>,
    completed: AtomicBool,
}

impl MutationLease {
    /// Marks the task as completed with an explicit final status and releases the lease.
    pub fn finish(self, status: TaskStatus) {
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
            self.manager.release_lease(&self.task_id, TaskStatus::Interrupted);
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
    completed_tasks: Mutex<HashMap<String, TaskRecord>>,
    anomaly_blocker: Mutex<Option<TaskAnomalyBlocker>>,
    process_table: ProcessTable,
    event_buffer: Mutex<HashMap<String, Vec<TaskEventPayload>>>,
    event_seq: AtomicU64,
    event_sink: Mutex<Option<Arc<dyn Fn(&TaskEventPayload) + Send + Sync>>>,
    retained_children: Mutex<HashMap<String, Vec<std::process::Child>>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            completed_tasks: Mutex::new(HashMap::new()),
            anomaly_blocker: Mutex::new(None),
            process_table: ProcessTable::new(),
            event_buffer: Mutex::new(HashMap::new()),
            event_seq: AtomicU64::new(0),
            event_sink: Mutex::new(None),
            retained_children: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_event_sink(&self, sink: impl Fn(&TaskEventPayload) + Send + Sync + 'static) {
        if let Ok(mut slot) = self.event_sink.lock() { *slot = Some(Arc::new(sink)); }
    }

    pub fn emit_event(&self, task_id: &str, stream: &str, text: &str) {
        self.record_event(task_id, stream, text, None, None);
    }

    fn record_event(&self, task_id: &str, stream: &str, text: &str, status: Option<TaskStatus>, exit_code: Option<i32>) {
        let seq = self.event_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = TaskEventPayload {
            task_id: task_id.to_string(),
            sequence: seq,
            stream: stream.to_string(),
            text: text.to_string(),
            timestamp: crate::modules::detect::now_iso8601(),
            truncated: false,
            exit_code,
            status: status.map(|s| s.as_str().to_string()),
        };
        if let Ok(mut map) = self.event_buffer.lock() {
            let buf = map.entry(task_id.to_string()).or_default();
            buf.push(event.clone());
            if buf.len() > 1000 {
                buf.remove(0);
            }
        }
        let sink = self.event_sink.lock().ok().and_then(|s| s.clone());
        if let Some(sink) = sink { sink(&event); }
    }

    pub fn retain_child(&self, task_id: &str, child: std::process::Child) {
        // Retain the native child handle until exit is observed; never replace it with a bare PID.
        let mut roots = self.retained_children.lock().unwrap_or_else(|e| e.into_inner());
        roots.entry(task_id.to_string()).or_default().push(child);
    }

    pub fn confirm_task_reclaimed(&self, task_id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|e| format!("任务锁破坏: {e}"))?;
        if active.as_ref().is_some_and(|a| a.task_id == task_id) {
            return Err("旧任务仍在执行，不能恢复".into());
        }
        let mut roots = self.retained_children.lock().map_err(|e| format!("进程句柄锁破坏: {e}"))?;
        if let Some(children) = roots.get_mut(task_id) {
            for child in children.iter_mut() {
                if child.try_wait().map_err(|e| format!("读取旧进程状态失败: {e}"))?.is_none() {
                    return Err("旧任务根进程仍未退出，不能恢复".into());
                }
            }
        }
        self.process_table.confirm_exited(task_id)?;
        roots.remove(task_id);
        Ok(())
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
        if let Ok(completed) = self.completed_tasks.lock() {
            if let Some(rec) = completed.get(task_id) {
                return TaskStatusView {
                    task_id: task_id.to_string(),
                    status: rec.status.as_str().to_string(),
                    active_kind: rec.active_kind,
                    exit_code: rec.exit_code,
                };
            }
        }
        TaskStatusView {
            task_id: task_id.to_string(),
            status: "notFound".to_string(),
            active_kind: None,
            exit_code: None,
        }
    }

    /// Attempts to acquire an exclusive MutationLease for a mutating task.
    /// Rejects if ANY mutating task is already in progress or if an anomaly blocker is active.
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
        let blocker_lock = self.anomaly_blocker.lock().map_err(|e| TaskConflictError {
            active_task_id: "unknown".into(), active_kind: kind,
            message: format!("异常状态锁破坏，不能开始新的变更：{e}"),
        })?;
        if let Some(ref blocker) = *blocker_lock {
            return Err(TaskConflictError {
                active_task_id: blocker.task_id.clone(), active_kind: kind,
                message: format!("任务 '{}' 的异常尚未解除：{}。请先从恢复入口处理。", blocker.task_id, blocker.reason),
            });
        }

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
        let job_guard = JobObjectGuard::new().map_err(|e| TaskConflictError {
            active_task_id: "none".into(),
            active_kind: kind,
            message: format!("无法创建受管理的 Job Object: {e}"),
        })?;
        let job_object = Some(Arc::new(job_guard));

        *lock = Some(ActiveTaskState {
            task_id: task_id.clone(),
            request_id: request_id.clone(),
            kind,
            cancel_flag: cancel_flag.clone(),
            started_at: now,
            job_object: job_object.clone(),
        });

        drop(blocker_lock);
        drop(lock);
        self.record_event(&task_id, "status", "任务已开始", Some(TaskStatus::Running), None);

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
    pub fn release_lease(&self, task_id: &str, status: TaskStatus) {
        self.release_lease_with_exit_code(task_id, status, None);
    }

    pub fn release_lease_with_exit_code(&self, task_id: &str, mut status: TaskStatus, exit_code: Option<i32>) {
        let mut released = false;
        if let Ok(mut lock) = self.active.lock() {
            if let Some(ref active) = *lock {
                if active.task_id == task_id {
                    let kind = active.kind;
                    if self.has_anomaly_blocker().is_some_and(|blocker| blocker.task_id == task_id)
                        && status != TaskStatus::Interrupted {
                        status = TaskStatus::NeedsAttention;
                    }
                    if status == TaskStatus::NeedsAttention && self.has_anomaly_blocker().is_none() {
                        self.set_anomaly_blocker(task_id, "任务需要人工介入，不能开始新的变更");
                    }
                    *lock = None;
                    released = true;
                    if let Ok(mut completed) = self.completed_tasks.lock() {
                        completed.insert(
                            task_id.to_string(),
                            TaskRecord {
                                task_id: task_id.to_string(),
                                status,
                                active_kind: Some(kind),
                                exit_code,
                            },
                        );
                    }
                }
            }
        }
        if released {
            self.record_event(task_id, "status", &format!("任务结束：{}", status.as_str()), Some(status), exit_code);
        }
    }

    pub fn set_anomaly_blocker(&self, task_id: &str, reason: &str) {
        if let Ok(mut lock) = self.anomaly_blocker.lock() {
            *lock = Some(TaskAnomalyBlocker {
                task_id: task_id.to_string(),
                reason: reason.to_string(),
            });
        }
    }

    pub fn clear_anomaly_blocker(&self) {
        if let Ok(mut lock) = self.anomaly_blocker.lock() {
            *lock = None;
        }
    }

    pub fn clear_anomaly_for(&self, task_id: &str) -> Result<(), String> {
        let mut blocker = self.anomaly_blocker.lock().map_err(|e| format!("异常标记锁破坏: {e}"))?;
        if blocker.as_ref().is_some_and(|b| b.task_id != task_id) {
            return Err("另一个任务的异常尚未处理，不能由本次恢复清除".into());
        }
        *blocker = None;
        Ok(())
    }

    pub fn has_anomaly_blocker(&self) -> Option<TaskAnomalyBlocker> {
        self.anomaly_blocker.lock().ok().and_then(|l| l.clone())
    }

    pub fn register_process(
        &self,
        task_id: &str,
        attempt_id: &str,
        generation: u64,
        pid: u32,
        job: Option<Arc<JobObjectGuard>>,
    ) -> Result<(), String> {
        self.process_table.register(task_id, attempt_id, generation, pid, job)
    }

    pub fn unregister_process(&self, attempt_id: &str, generation: u64) -> bool {
        self.process_table.unregister(attempt_id, generation)
    }

    pub fn next_process_generation(&self) -> u64 {
        self.process_table.next_generation()
    }

    pub fn pids_for_task(&self, task_id: &str) -> Vec<u32> {
        self.process_table.pids_for_task(task_id)
    }

    /// Cancels a task by its task_id. Sets cooperative cancel flag and terminates process tree.
    pub fn cancel_task(&self, task_id: &str) -> Result<bool, String> {
        let (mut found, cancel_flag, job) = {
            let active = self.active.lock().map_err(|e| format!("任务锁破坏: {e}"))?;
            match active.as_ref().filter(|a| a.task_id == task_id) {
                Some(task) => (true, Some(task.cancel_flag.clone()), task.job_object.clone()),
                None => (false, None, None),
            }
        };
        if let Some(flag) = cancel_flag { flag.cancel(); }
        let mut errors = Vec::new();
        let mut tree_termination_requested = false;
        if let Some(job) = job {
            match job.terminate(1) {
                Ok(()) => tree_termination_requested = true,
                Err(error) => errors.push(error),
            }
        }
        match self.process_table.cancel(task_id) {
            Ok(cancelled) => { found |= cancelled; tree_termination_requested |= cancelled; }
            Err(error) => { tree_termination_requested = false; errors.push(error); }
        }
        let mut roots = self.retained_children.lock().map_err(|e| format!("进程句柄锁破坏: {e}"))?;
        if let Some(children) = roots.get_mut(task_id) {
            found = true;
            for child in children {
                match child.try_wait() {
                    Ok(Some(_)) => {}
                    Ok(None) if !tree_termination_requested => { if let Err(error) = child.kill() { errors.push(format!("终止进程失败: {error}")); } }
                    Ok(None) => {},
                    Err(error) => errors.push(format!("读取进程状态失败: {error}")),
                }
            }
        }
        drop(roots);
        if !errors.is_empty() {
            let reason = errors.join("；");
            self.set_anomaly_blocker(task_id, &reason);
            return Err(reason);
        }
        Ok(found)
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

    pub fn active_task_id_for(&self, kind: MutationKind) -> Option<String> {
        self.active.lock().ok().and_then(|active| {
            active.as_ref().filter(|task| task.kind == kind).map(|task| task.task_id.clone())
        })
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
