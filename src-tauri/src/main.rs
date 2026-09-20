// Hide the console window in release builds. In debug we keep it so probe
// output and panics are visible while developing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_student_setup_lib::run()
}
