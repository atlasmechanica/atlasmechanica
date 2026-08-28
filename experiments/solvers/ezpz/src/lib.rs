use std::{collections::BTreeMap, time::Instant};

use ezpz::{
    Config, Constraint, ConstraintRequest, IdGenerator,
    datatypes::inputs::DatumPoint,
    solve,
};
use serde::{Deserialize, Serialize};

const PLAN_JSON: &str = include_str!(
    "../../../../packages/kinematics/src/fixtures/fourBarConstraintPlan.json"
);
const STRICT_CONFIG: Config = Config::new_for_atlas();

trait AtlasConfigExt {
    const fn new_for_atlas() -> Config;
}

impl AtlasConfigExt for Config {
    const fn new_for_atlas() -> Config {
        // Config's builder methods are not const, so this trait exists only to
        // make the desired policy obvious. `atlas_config()` below constructs it.
        Config::default()
    }
}

fn atlas_config() -> Config {
    Config::default()
        .with_max_iterations(100)
        .with_convergence_tolerance(1e-12)
        .with_step_tolerance(1e-14)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub input_ground_pivot: Vec2,
    pub output_ground_pivot: Vec2,
    pub crank_vector: Vec2,
    pub coupler_length: f64,
    pub rocker_length: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub branch_sign: i32,
    pub seed_b: Vec2,
    pub reference_input: f64,
    pub reference_crank_angle: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FourBarPlan {
    pub schema_version: u32,
    pub model: String,
    pub input_coordinate: String,
    pub geometry: Geometry,
    pub configurations: BTreeMap<String, Configuration>,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SolveSample {
    pub b: Vec2,
    pub converged: bool,
    pub satisfied: bool,
    pub iterations: usize,
    pub position_error: f64,
    pub branch_sign: i32,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepStats {
    pub samples: usize,
    pub failures: usize,
    pub nonconverged: usize,
    pub unsatisfied: usize,
    pub branch_mismatches: usize,
    pub max_position_error_m: f64,
    pub max_iterations: usize,
    pub elapsed_ms: f64,
    pub solves_per_second: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkReport {
    pub upstream: UpstreamInfo,
    pub model: String,
    pub warm_open_forward_reverse: SweepStats,
    pub warm_crossed_forward_reverse: SweepStats,
    pub cold_open_two_revolutions: SweepStats,
    pub cold_crossed_two_revolutions: SweepStats,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpstreamInfo {
    pub crate_name: &'static str,
    pub version: &'static str,
    pub release_commit: &'static str,
}

pub fn load_plan() -> FourBarPlan {
    serde_json::from_str(PLAN_JSON).expect("canonical Atlas four-bar constraint plan must parse")
}

fn add(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}

fn sub(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}

fn scale(v: Vec2, factor: f64) -> Vec2 {
    Vec2 {
        x: v.x * factor,
        y: v.y * factor,
    }
}

fn rotate(v: Vec2, angle: f64) -> Vec2 {
    let (sin, cos) = angle.sin_cos();
    Vec2 {
        x: cos * v.x - sin * v.y,
        y: sin * v.x + cos * v.y,
    }
}

fn magnitude(v: Vec2) -> f64 {
    v.x.hypot(v.y)
}

fn cross(a: Vec2, b: Vec2) -> f64 {
    a.x * b.y - a.y * b.x
}

fn branch_sign(a: Vec2, o4: Vec2, b: Vec2) -> i32 {
    cross(sub(o4, a), sub(b, a)).signum() as i32
}

fn driver_point(plan: &FourBarPlan, configuration: &Configuration, theta: f64) -> Vec2 {
    let crank_angle =
        configuration.reference_crank_angle + theta - configuration.reference_input;
    add(
        plan.geometry.input_ground_pivot,
        rotate(plan.geometry.crank_vector, crank_angle),
    )
}

fn exact_b(plan: &FourBarPlan, a: Vec2, requested_branch: i32) -> Option<Vec2> {
    let o4 = plan.geometry.output_ground_pivot;
    let center_delta = sub(o4, a);
    let d = magnitude(center_delta);
    let r0 = plan.geometry.coupler_length;
    let r1 = plan.geometry.rocker_length;

    if d <= f64::EPSILON || d > r0 + r1 || d < (r0 - r1).abs() {
        return None;
    }

    let x = (r0 * r0 - r1 * r1 + d * d) / (2.0 * d);
    let h2 = r0 * r0 - x * x;
    if h2 < -1e-14 {
        return None;
    }

    let direction = scale(center_delta, 1.0 / d);
    let base = add(a, scale(direction, x));
    let h = h2.max(0.0).sqrt();
    if h <= 1e-14 {
        return Some(base);
    }

    let perpendicular = Vec2 {
        x: -direction.y,
        y: direction.x,
    };
    let candidates = [
        add(base, scale(perpendicular, h)),
        sub(base, scale(perpendicular, h)),
    ];

    candidates
        .into_iter()
        .find(|candidate| branch_sign(a, o4, *candidate) == requested_branch)
}

pub fn solve_sample(
    plan: &FourBarPlan,
    configuration: &Configuration,
    theta: f64,
    guess_b: Vec2,
) -> Result<SolveSample, String> {
    let a_target = driver_point(plan, configuration, theta);
    let o4_target = plan.geometry.output_ground_pivot;

    let mut ids = IdGenerator::default();
    let a = DatumPoint::new(&mut ids);
    let o4 = DatumPoint::new(&mut ids);
    let b = DatumPoint::new(&mut ids);

    let requests = vec![
        Constraint::Fixed(a.id_x(), a_target.x),
        Constraint::Fixed(a.id_y(), a_target.y),
        Constraint::Fixed(o4.id_x(), o4_target.x),
        Constraint::Fixed(o4.id_y(), o4_target.y),
        Constraint::Distance(a, b, plan.geometry.coupler_length),
        Constraint::Distance(o4, b, plan.geometry.rocker_length),
    ]
    .into_iter()
    .map(ConstraintRequest::highest_priority)
    .collect::<Vec<_>>();

    let guesses = vec![
        (a.id_x(), a_target.x),
        (a.id_y(), a_target.y),
        (o4.id_x(), o4_target.x),
        (o4.id_y(), o4_target.y),
        (b.id_x(), guess_b.x),
        (b.id_y(), guess_b.y),
    ];

    let outcome = solve(&requests, guesses, atlas_config()).map_err(|failure| {
        format!(
            "ezpz failure: {:?}; vars={}; eqs={}",
            failure.error(),
            failure.num_vars(),
            failure.num_eqs()
        )
    })?;

    let solved = outcome.final_value_point(&b);
    let solved_b = Vec2 {
        x: solved.x,
        y: solved.y,
    };
    let exact = exact_b(plan, a_target, configuration.branch_sign)
        .ok_or_else(|| "analytic four-bar oracle has no real loop closure".to_owned())?;

    Ok(SolveSample {
        b: solved_b,
        converged: outcome.converged(),
        satisfied: outcome.is_satisfied(),
        iterations: outcome.iterations(),
        position_error: magnitude(sub(solved_b, exact)),
        branch_sign: branch_sign(a_target, o4_target, solved_b),
    })
}

fn accumulate(stats: &mut SweepStats, sample: &SolveSample, expected_branch: i32) {
    stats.samples += 1;
    if !sample.converged {
        stats.nonconverged += 1;
    }
    if !sample.satisfied {
        stats.unsatisfied += 1;
    }
    if sample.branch_sign != expected_branch {
        stats.branch_mismatches += 1;
    }
    stats.max_position_error_m = stats.max_position_error_m.max(sample.position_error);
    stats.max_iterations = stats.max_iterations.max(sample.iterations);
}

pub fn sweep_degrees(
    plan: &FourBarPlan,
    configuration: &Configuration,
    angles_degrees: impl IntoIterator<Item = i32>,
    warm_start: bool,
) -> SweepStats {
    let mut stats = SweepStats::default();
    let mut previous = configuration.seed_b;
    let started = Instant::now();

    for degrees in angles_degrees {
        let theta = f64::from(degrees).to_radians();
        let guess = if warm_start {
            previous
        } else {
            configuration.seed_b
        };

        match solve_sample(plan, configuration, theta, guess) {
            Ok(sample) => {
                accumulate(&mut stats, &sample, configuration.branch_sign);
                previous = sample.b;
            }
            Err(_) => {
                stats.samples += 1;
                stats.failures += 1;
            }
        }
    }

    let elapsed = started.elapsed();
    stats.elapsed_ms = elapsed.as_secs_f64() * 1_000.0;
    if elapsed.as_secs_f64() > 0.0 {
        stats.solves_per_second = stats.samples as f64 / elapsed.as_secs_f64();
    }
    stats
}

pub fn benchmark_report() -> BenchmarkReport {
    let plan = load_plan();
    let open = plan.configurations.get("open").expect("open configuration");
    let crossed = plan
        .configurations
        .get("crossed")
        .expect("crossed configuration");

    let forward_reverse = (0..=720).chain((0..720).rev());
    let warm_open_forward_reverse =
        sweep_degrees(&plan, open, forward_reverse.clone(), true);
    let warm_crossed_forward_reverse =
        sweep_degrees(&plan, crossed, forward_reverse, true);
    let cold_open_two_revolutions = sweep_degrees(&plan, open, 0..=720, false);
    let cold_crossed_two_revolutions = sweep_degrees(&plan, crossed, 0..=720, false);

    BenchmarkReport {
        upstream: UpstreamInfo {
            crate_name: "ezpz",
            version: "0.2.29",
            release_commit: "915882cc731da31042ce494c89b10334ee57837a",
        },
        model: plan.model.clone(),
        warm_open_forward_reverse,
        warm_crossed_forward_reverse,
        cold_open_two_revolutions,
        cold_crossed_two_revolutions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_plan_is_loaded_from_atlas_snapshot() {
        let plan = load_plan();
        assert_eq!(plan.schema_version, 1);
        assert_eq!(plan.model, "foundation:four-bar:crank-rocker");
        assert_eq!(plan.geometry.coupler_length, 0.08);
        assert_eq!(plan.geometry.rocker_length, 0.07);
    }

    #[test]
    fn warm_start_preserves_both_branches_forward_and_reverse() {
        let plan = load_plan();
        let sequence = (0..=720).chain((0..720).rev()).collect::<Vec<_>>();

        for name in ["open", "crossed"] {
            let configuration = &plan.configurations[name];
            let stats = sweep_degrees(&plan, configuration, sequence.clone(), true);
            assert_eq!(stats.failures, 0, "{name}: solver failures");
            assert_eq!(stats.nonconverged, 0, "{name}: non-converged samples");
            assert_eq!(stats.unsatisfied, 0, "{name}: unsatisfied samples");
            assert_eq!(stats.branch_mismatches, 0, "{name}: branch jumps");
            assert!(
                stats.max_position_error_m <= 1e-7,
                "{name}: max position error was {} m",
                stats.max_position_error_m
            );
        }
    }

    #[test]
    fn warm_start_hits_key_oracle_angles() {
        let plan = load_plan();
        let configuration = &plan.configurations["open"];
        let mut guess = configuration.seed_b;

        for degrees in [0, 90, 180, 270, 360] {
            let sample = solve_sample(
                &plan,
                configuration,
                f64::from(degrees).to_radians(),
                guess,
            )
            .expect("ezpz solve");
            assert!(sample.converged);
            assert!(sample.satisfied);
            assert_eq!(sample.branch_sign, 1);
            assert!(sample.position_error <= 1e-7);
            guess = sample.b;
        }
    }
}
