//! Feature modules.
//!
//! Each module is a *vertical slice* of the product with a narrow interface:
//!
//! ```text
//! catalog   →  the software catalog: names, executables, package ids, sources
//! detect    →  probe the machine, return EnvironmentReport
//! inventory →  the Software Intelligence Layer: what is already installed?
//! profiles  →  load Profile documents
//! install   →  turn (Profile, inventory) into an InstallPlan, then execute it
//! executor  →  run one InstallSource and record exactly what happened
//! install_log → persist what failed, so an error outlives the window
//! verify    →  turn (InstallPlan, inventory) into a VerificationReport
//! config    →  localisation + post-install configuration actions
//! bootstrap →  turn (Profile, inventory) into a *configured* environment
//! ```
//!
//! The pipeline reads left to right and each arrow is a plain data structure —
//! no module holds another's state, which is why stage 3 could implement the
//! installer without touching the inventory.
//!
//! `executor` is the only module that runs a process with the intent of changing
//! the system. It is deliberately separate from `install`, which owns the
//! *policy* (which strategy, in what order, with what fallback); `executor` owns
//! only the *mechanism* (spawn it, wait, classify the result). Keeping them
//! apart is what lets the fallback logic be tested without running anything.
//!
//! `catalog` is the one deliberate exception to "no module knows a vendor name":
//! it is *data*, and both `install` and `executor` derive their behaviour from it
//! so the three cannot drift apart.

pub mod bootstrap;
pub mod catalog;
pub mod capability;
pub mod config;
pub mod detect;
pub mod executor;
pub mod install;
pub mod install_log;
pub mod inventory;
pub mod knowledge;
pub mod license;
pub mod machine;
pub mod plugins;
pub mod profiles;
pub mod storage;
pub mod system_ops;
pub mod verify;
// The Software Intelligence Layer's tests live in their own file because they
// are the largest single body of tests in the crate, they depend on checked-in
// fixtures, and keeping them next to `inventory.rs` would triple the size of the
// module a reader has to hold in their head.
#[cfg(test)]
mod inventory_tests;

// The Execution Engine's tests live separately for the same reason, plus one
// more: several of them run real processes, and a reader opening `install.rs`
// should be able to see the scheduling policy without scrolling past process
// plumbing assertions to find it.
#[cfg(test)]
mod execution_tests;
