// SPDX-License-Identifier: AGPL-3.0-or-later
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let action = std::env::args().nth(1).unwrap_or_else(|| "check".into());
    let scripts: &[&[&str]] = match action.as_str() {
        "check" => &[&["run", "validate"], &["test"]],
        _ => {
            eprintln!("usage: cargo xtask check");
            return ExitCode::FAILURE;
        }
    };
    for args in scripts {
        match Command::new("npm").args(*args).status() {
            Ok(status) if status.success() => {}
            Ok(status) => return ExitCode::from(status.code().unwrap_or(1) as u8),
            Err(error) => {
                eprintln!("unable to run npm: {error}");
                return ExitCode::FAILURE;
            }
        }
    }
    ExitCode::SUCCESS
}
