//! Bounded child-process execution for terminal commands.
//!
//! `Command::output()` has no deadline and buffers everything in memory: a hung command freezes
//! the caller forever and a chatty one can exhaust memory. This runs the child with a wall-clock
//! timeout, kills the *whole process tree* when it expires, and caps captured output.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub struct Captured {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub truncated: bool,
}

fn read_capped<R: Read + Send + 'static>(
    mut reader: R,
    cap: usize,
) -> thread::JoinHandle<(Vec<u8>, bool)> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut truncated = false;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if kept.len() < cap {
                        let take = n.min(cap - kept.len());
                        kept.extend_from_slice(&buf[..take]);
                        if take < n {
                            truncated = true;
                        }
                    } else {
                        // Keep draining so the child never blocks on a full pipe.
                        truncated = true;
                    }
                }
            }
        }
        (kept, truncated)
    })
}

#[cfg(unix)]
fn configure(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    // Own process group, so a timeout can signal the shell *and* everything it started.
    cmd.process_group(0);
}

#[cfg(windows)]
fn configure(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(any(unix, windows)))]
fn configure(_cmd: &mut Command) {}

fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        // Negative pid = the whole process group created in `configure`.
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

pub fn run_bounded(
    mut cmd: Command,
    timeout: Duration,
    max_bytes: usize,
) -> Result<Captured, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure(&mut cmd);
    let mut child = cmd.spawn().map_err(|err| err.to_string())?;
    let out = child.stdout.take().map(|pipe| read_capped(pipe, max_bytes));
    let err = child.stderr.take().map(|pipe| read_capped(pipe, max_bytes));

    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= timeout => {
                timed_out = true;
                kill_tree(&mut child);
                break child.wait().ok();
            }
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(error) => return Err(error.to_string()),
        }
    };

    // Grandchildren that outlive the shell would keep the pipes open; after a kill the readers end.
    let (stdout, out_truncated) = out
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    let (stderr, err_truncated) = err
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    Ok(Captured {
        code: status.and_then(|s| s.code()).unwrap_or(-1),
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        timed_out,
        truncated: out_truncated || err_truncated,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn sh(script: &str) -> Command {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", script]);
        cmd
    }

    #[test]
    fn captures_output_and_exit_code() {
        let out = run_bounded(
            sh("echo hello; echo oops 1>&2; exit 3"),
            Duration::from_secs(5),
            10_000,
        )
        .unwrap();
        assert_eq!(out.code, 3);
        assert_eq!(out.stdout.trim(), "hello");
        assert_eq!(out.stderr.trim(), "oops");
        assert!(!out.timed_out && !out.truncated);
    }

    #[test]
    fn a_hung_command_is_killed_at_the_deadline() {
        let started = Instant::now();
        let out = run_bounded(sh("sleep 30"), Duration::from_millis(300), 1_000).unwrap();
        assert!(out.timed_out);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn the_whole_process_tree_dies_not_just_the_shell() {
        // The shell starts a background grandchild that would hold stdout open for 30s.
        let started = Instant::now();
        let out = run_bounded(
            sh("(sleep 30; echo late) & sleep 30"),
            Duration::from_millis(300),
            1_000,
        )
        .unwrap();
        assert!(out.timed_out);
        assert!(!out.stdout.contains("late"));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn output_is_capped_and_the_child_is_not_blocked() {
        let out = run_bounded(
            sh("yes x | head -c 3000000"),
            Duration::from_secs(20),
            4_096,
        )
        .unwrap();
        assert_eq!(out.stdout.len(), 4_096);
        assert!(out.truncated);
        assert_eq!(out.code, 0);
    }

    #[test]
    fn a_missing_program_is_an_error_not_a_panic() {
        assert!(run_bounded(
            Command::new("/definitely/not/here"),
            Duration::from_secs(1),
            10
        )
        .is_err());
    }
}
