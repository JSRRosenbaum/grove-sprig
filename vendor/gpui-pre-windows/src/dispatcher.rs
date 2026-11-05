use std::{
    ffi::c_void,
    ptr::NonNull,
    sync::atomic::{AtomicUsize, Ordering},
    thread::{ThreadId, current},
    time::{Duration, Instant},
};

use anyhow::Context;
use gpui_util::ResultExt;
use windows::Win32::{
    Foundation::{FILETIME, LPARAM, WPARAM},
    Media::{timeBeginPeriod, timeEndPeriod},
    System::Threading::{
        CloseThreadpoolTimer, CreateThreadpoolTimer, GetCurrentThread, PTP_CALLBACK_INSTANCE,
        PTP_TIMER, SetThreadPriority, SetThreadpoolTimer, THREAD_PRIORITY_TIME_CRITICAL,
        TP_CALLBACK_ENVIRON_V3, TP_CALLBACK_PRIORITY, TP_CALLBACK_PRIORITY_HIGH,
        TP_CALLBACK_PRIORITY_LOW, TP_CALLBACK_PRIORITY_NORMAL, TrySubmitThreadpoolCallback,
    },
    UI::WindowsAndMessaging::PostMessageW,
};

use crate::{HWND, SafeHwnd, WM_GPUI_TASK_DISPATCHED_ON_MAIN_THREAD};
use gpui::{
    PlatformDispatcher, Priority, PriorityQueueReceiver, PriorityQueueSender, RunnableVariant,
    TimerResolutionGuard,
};

pub(crate) const MAIN_TASK_BUDGET: Duration = Duration::from_millis(10);
const WAKE_POSTED: usize = 1;
const SIZE_MOVE_LOOP: usize = 2;

pub(crate) struct WindowsDispatcher {
    // The low bit tracks a posted or active wake; the remaining bits count
    // nested native move/size loops on this dispatcher's UI thread.
    wake_state: AtomicUsize,
    main_sender: PriorityQueueSender<RunnableVariant>,
    main_thread_id: ThreadId,
    pub(crate) platform_window_handle: SafeHwnd,
    validation_number: usize,
}

impl WindowsDispatcher {
    pub(crate) fn new(
        main_sender: PriorityQueueSender<RunnableVariant>,
        platform_window_handle: HWND,
        validation_number: usize,
    ) -> Self {
        let main_thread_id = current().id();
        let platform_window_handle = platform_window_handle.into();

        WindowsDispatcher {
            main_sender,
            main_thread_id,
            platform_window_handle,
            validation_number,
            wake_state: AtomicUsize::new(0),
        }
    }

    pub(crate) fn enter_size_move(&self) {
        self.wake_state.fetch_add(SIZE_MOVE_LOOP, Ordering::SeqCst);
    }

    pub(crate) fn exit_size_move(&self) {
        let previous = self.wake_state.fetch_sub(SIZE_MOVE_LOOP, Ordering::SeqCst);
        debug_assert!(previous >= SIZE_MOVE_LOOP);
        if previous < 2 * SIZE_MOVE_LOOP {
            // A producer may have claimed the old wake and not posted it yet.
            // Post independently on final exit rather than waiting for it.
            self.mark_wake_active();
            self.post_foreground_wake();
        }
    }

    pub(crate) fn in_size_move(&self) -> bool {
        self.wake_state.load(Ordering::SeqCst) >= SIZE_MOVE_LOOP
    }

    pub(crate) fn clear_wake(&self) {
        self.wake_state.fetch_and(!WAKE_POSTED, Ordering::SeqCst);
    }

    pub(crate) fn mark_wake_active(&self) {
        self.wake_state.fetch_or(WAKE_POSTED, Ordering::SeqCst);
    }

    pub(crate) fn wake_foreground(&self) {
        // Claim the wake only if no move/size loop and no wake are active.
        // The single atomic state closes the enqueue-versus-final-exit race.
        if self
            .wake_state
            .compare_exchange(0, WAKE_POSTED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            self.post_foreground_wake();
        }
    }

    fn post_foreground_wake(&self) {
        if let Err(error) = unsafe {
            PostMessageW(
                Some(self.platform_window_handle.as_raw()),
                WM_GPUI_TASK_DISPATCHED_ON_MAIN_THREAD,
                WPARAM(self.validation_number),
                LPARAM(0),
            )
        } {
            self.clear_wake();
            log::error!("unable to post foreground task wake: {error}");
        }
    }

    pub(crate) fn run_modal_timer_tasks(
        &self,
        receiver: &PriorityQueueReceiver<RunnableVariant>,
        mut execute: impl FnMut(RunnableVariant),
    ) {
        let start = Instant::now();
        let mut runnables = receiver.clone().try_iter();
        while let Some(Ok(runnable)) = runnables.next() {
            execute(runnable);
            if self.in_size_move() && start.elapsed() >= MAIN_TASK_BUDGET {
                break;
            }
        }
    }

    fn dispatch_on_threadpool(&self, priority: TP_CALLBACK_PRIORITY, runnable: RunnableVariant) {
        let environ = TP_CALLBACK_ENVIRON_V3 {
            Version: 3,
            CallbackPriority: priority,
            Size: size_of::<TP_CALLBACK_ENVIRON_V3>() as u32,
            ..Default::default()
        };

        // If the thread pool never runs our callback, the matching `from_raw` is never called, which leaks the runnable.
        // Dropping the scheduled runnable would cancel its task and make the next poll of any awaiter panic. Since we expect
        // the scenario to usually happen during shutdown, this leak is acceptable.
        let context = runnable.into_raw().as_ptr() as *mut c_void;

        unsafe {
            TrySubmitThreadpoolCallback(Some(run_work_callback), Some(context), Some(&environ))
                .log_err();
        }
    }

    fn dispatch_on_threadpool_after(&self, runnable: RunnableVariant, duration: Duration) {
        let context = runnable.into_raw().as_ptr() as *mut c_void;

        unsafe {
            if let Ok(timer) = CreateThreadpoolTimer(Some(run_timer_callback), Some(context), None)
            {
                // Negative FILETIME expresses a relative delay in 100ns ticks
                let ticks = (duration.as_nanos() / 100).min(i64::MAX as u128) as i64;
                let due = (-ticks) as u64;
                let due_time = FILETIME {
                    dwLowDateTime: due as u32,
                    dwHighDateTime: (due >> 32) as u32,
                };
                SetThreadpoolTimer(timer, Some(&due_time), 0, None);
            }
        }
    }

    #[inline(always)]
    pub(crate) fn execute_runnable(runnable: RunnableVariant) {
        let location = runnable.metadata().location;
        let spawned = runnable.metadata().spawned;
        gpui::profiler::update_running_task(spawned, location);
        runnable.run();
        gpui::profiler::save_task_timing();
    }
}

impl PlatformDispatcher for WindowsDispatcher {
    fn is_main_thread(&self) -> bool {
        current().id() == self.main_thread_id
    }

    fn dispatch(&self, runnable: RunnableVariant, priority: Priority) {
        let priority = match priority {
            Priority::RealtimeAudio => {
                panic!("RealtimeAudio priority should use spawn_realtime, not dispatch")
            }
            Priority::High => TP_CALLBACK_PRIORITY_HIGH,
            Priority::Medium => TP_CALLBACK_PRIORITY_NORMAL,
            Priority::Low => TP_CALLBACK_PRIORITY_LOW,
        };
        self.dispatch_on_threadpool(priority, runnable);
    }

    fn dispatch_on_main_thread(&self, runnable: RunnableVariant, priority: Priority) {
        match self.main_sender.send(priority, runnable) {
            Ok(_) => self.wake_foreground(),
            Err(runnable) => {
                // NOTE: Runnable may wrap a Future that is !Send.
                //
                // This is usually safe because we only poll it on the main thread.
                // However if the send fails, we know that:
                // 1. main_receiver has been dropped (which implies the app is shutting down)
                // 2. we are on a background thread.
                // It is not safe to drop something !Send on the wrong thread, and
                // the app will exit soon anyway, so we must forget the runnable.
                std::mem::forget(runnable);
            }
        }
    }

    fn dispatch_after(&self, duration: Duration, runnable: RunnableVariant) {
        self.dispatch_on_threadpool_after(runnable, duration);
    }

    fn spawn_realtime(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(move || {
            // SAFETY: always safe to call
            let thread_handle = unsafe { GetCurrentThread() };

            // SAFETY: thread_handle is a valid handle to the current thread
            unsafe { SetThreadPriority(thread_handle, THREAD_PRIORITY_TIME_CRITICAL) }
                .context("thread priority")
                .log_err();

            f();
        });
    }

    fn increase_timer_resolution(&self) -> TimerResolutionGuard {
        unsafe {
            timeBeginPeriod(1);
        }
        gpui_util::defer(Box::new(|| unsafe {
            timeEndPeriod(1);
        }))
    }
}

unsafe extern "system" fn run_work_callback(
    _instance: PTP_CALLBACK_INSTANCE,
    context: *mut c_void,
) {
    let runnable = unsafe { RunnableVariant::from_raw(NonNull::new_unchecked(context as *mut ())) };
    WindowsDispatcher::execute_runnable(runnable);
}

unsafe extern "system" fn run_timer_callback(
    _instance: PTP_CALLBACK_INSTANCE,
    context: *mut c_void,
    timer: PTP_TIMER,
) {
    let runnable = unsafe { RunnableVariant::from_raw(NonNull::new_unchecked(context as *mut ())) };
    WindowsDispatcher::execute_runnable(runnable);
    unsafe { CloseThreadpoolTimer(timer) };
}
