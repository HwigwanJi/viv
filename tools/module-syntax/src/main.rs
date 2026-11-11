use std::env;
use std::ffi::OsStr;
use std::io;
use std::process::{Command, ExitCode};
use std::thread;

fn check_module(node: &OsStr, file: &str) -> Option<String> {
    match Command::new(node).args(["--check", file]).output() {
        Ok(output) if output.status.success() => None,
        Ok(output) => Some(format!(
            "{file}: {}\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )),
        Err(error) => Some(format!("{file}: could not run Node.js: {error}")),
    }
}

fn run() -> io::Result<bool> {
    let node = env::args_os().nth(1).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected Node.js executable path",
        )
    })?;
    let input = io::read_to_string(io::stdin().lock())?;
    if input.is_empty() {
        return Ok(true);
    }
    let files: Vec<_> = input.split('\0').collect();
    let workers = thread::available_parallelism().map_or(1, |count| count.get().min(4));
    let node = node.as_os_str();
    let errors = thread::scope(|scope| {
        let batches: Vec<_> = files
            .chunks(files.len().div_ceil(workers))
            .map(|batch| {
                scope.spawn(move || {
                    batch
                        .iter()
                        .filter_map(|file| check_module(node, file))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        batches
            .into_iter()
            .flat_map(|batch| batch.join().expect("syntax checker worker panicked"))
            .collect::<Vec<_>>()
    });
    for error in &errors {
        eprintln!("{error}");
    }
    Ok(errors.is_empty())
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
