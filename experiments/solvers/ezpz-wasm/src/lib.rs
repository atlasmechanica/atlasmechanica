use atlas_ezpz_spike::{load_plan, solve_sample};

/// Return 0 when both canonical branches complete 0→720° without solver,
/// convergence, satisfaction, branch, or 1e-7 m accuracy failures.
#[unsafe(no_mangle)]
pub extern "C" fn atlas_validate() -> i32 {
    let plan = load_plan();
    let mut failures = 0_i32;

    for name in ["open", "crossed"] {
        let Some(configuration) = plan.configurations.get(name) else {
            return -1;
        };
        let mut guess = configuration.seed_b;

        for degrees in 0..=720 {
            let theta = f64::from(degrees).to_radians();
            match solve_sample(&plan, configuration, theta, guess) {
                Ok(sample) => {
                    if !sample.converged
                        || !sample.satisfied
                        || sample.branch_sign != configuration.branch_sign
                        || sample.position_error > 1e-7
                    {
                        failures += 1;
                    }
                    guess = sample.b;
                }
                Err(_) => failures += 1,
            }
        }
    }

    failures
}

/// Run `samples` warm-started solves and return a checksum so the work remains
/// observable to the host. Host-side JavaScript measures elapsed time.
#[unsafe(no_mangle)]
pub extern "C" fn atlas_benchmark(samples: u32) -> f64 {
    let plan = load_plan();
    let Some(configuration) = plan.configurations.get("open") else {
        return f64::NAN;
    };
    let mut guess = configuration.seed_b;
    let mut checksum = 0.0_f64;

    for sample_index in 0..samples {
        let degrees = f64::from(sample_index % 720);
        let theta = degrees.to_radians();
        let Ok(sample) = solve_sample(&plan, configuration, theta, guess) else {
            return f64::NAN;
        };
        if !sample.converged || !sample.satisfied {
            return f64::NAN;
        }
        checksum += sample.b.x + sample.b.y + sample.position_error;
        guess = sample.b;
    }

    checksum
}
