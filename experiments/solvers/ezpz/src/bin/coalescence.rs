use ezpz::{
    Config, Constraint, ConstraintRequest, IdGenerator,
    datatypes::inputs::DatumPoint,
    solve,
};
use serde::Serialize;

use atlas_ezpz_spike::{Vec2, load_plan};

const ATLAS_POSITION_TOLERANCE_M: f64 = 1e-8;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct StrategyStats {
    samples: usize,
    failures: usize,
    nonconverged: usize,
    unsatisfied: usize,
    wrong_root_samples: usize,
    max_position_error_m: f64,
    max_iterations: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    model: &'static str,
    atlas_position_tolerance_m: f64,
    geometry: GeometrySummary,
    previous_only: StrategyStats,
    linear_extrapolation: StrategyStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeometrySummary {
    ground_length_m: f64,
    crank_length_m: f64,
    coupler_length_m: f64,
    rocker_length_m: f64,
    start_angle_deg: f64,
    end_angle_deg: f64,
    step_deg: f64,
}

fn config() -> Config {
    Config::default()
        .with_max_iterations(100)
        .with_convergence_tolerance(1e-12)
        .with_step_tolerance(1e-14)
}

fn add(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 { x: a.x + b.x, y: a.y + b.y }
}

fn sub(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 { x: a.x - b.x, y: a.y - b.y }
}

fn scale(v: Vec2, f: f64) -> Vec2 {
    Vec2 { x: v.x * f, y: v.y * f }
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

fn solve_b(
    a_target: Vec2,
    o4_target: Vec2,
    coupler_length: f64,
    rocker_length: f64,
    guess_b: Vec2,
) -> Result<(Vec2, bool, bool, usize), String> {
    let mut ids = IdGenerator::default();
    let a = DatumPoint::new(&mut ids);
    let o4 = DatumPoint::new(&mut ids);
    let b = DatumPoint::new(&mut ids);

    let requests = vec![
        Constraint::Fixed(a.id_x(), a_target.x),
        Constraint::Fixed(a.id_y(), a_target.y),
        Constraint::Fixed(o4.id_x(), o4_target.x),
        Constraint::Fixed(o4.id_y(), o4_target.y),
        Constraint::Distance(a, b, coupler_length),
        Constraint::Distance(o4, b, rocker_length),
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

    let outcome = solve(&requests, guesses, config())
        .map_err(|failure| format!("{:?}", failure.error()))?;
    let solved = outcome.final_value_point(&b);
    Ok((
        Vec2 { x: solved.x, y: solved.y },
        outcome.converged(),
        outcome.is_satisfied(),
        outcome.iterations(),
    ))
}

fn run(extrapolate: bool) -> StrategyStats {
    let plan = load_plan();
    let o2 = plan.geometry.input_ground_pivot;
    let o4 = plan.geometry.output_ground_pivot;
    let ground_vector = sub(o4, o2);
    let ground_length = magnitude(ground_vector);
    let crank_length = magnitude(plan.geometry.crank_vector);
    let coupler_length = ground_length;
    let rocker_length = crank_length;

    let start_quarter_deg = -120;
    let end_quarter_deg = 120;
    let mut stats = StrategyStats::default();
    let mut previous: Option<Vec2> = None;
    let mut previous_previous: Option<Vec2> = None;

    for quarter_deg in start_quarter_deg..=end_quarter_deg {
        let degrees = f64::from(quarter_deg) / 4.0;
        let theta = degrees.to_radians();
        let a = add(o2, rotate(plan.geometry.crank_vector, theta));
        let expected_b = add(a, ground_vector);

        let guess = match (extrapolate, previous, previous_previous) {
            (true, Some(last), Some(before_last)) => add(last, sub(last, before_last)),
            (_, Some(last), _) => last,
            _ => expected_b,
        };

        stats.samples += 1;
        match solve_b(a, o4, coupler_length, rocker_length, guess) {
            Ok((solved_b, converged, satisfied, iterations)) => {
                if !converged {
                    stats.nonconverged += 1;
                }
                if !satisfied {
                    stats.unsatisfied += 1;
                }
                let error = magnitude(sub(solved_b, expected_b));
                stats.max_position_error_m = stats.max_position_error_m.max(error);
                if error > 1e-6 {
                    stats.wrong_root_samples += 1;
                }
                stats.max_iterations = stats.max_iterations.max(iterations);
                previous_previous = previous;
                previous = Some(solved_b);
            }
            Err(_) => {
                stats.failures += 1;
                previous_previous = previous;
                previous = None;
            }
        }
    }

    stats
}

fn accepted(stats: &StrategyStats) -> bool {
    stats.failures == 0
        && stats.nonconverged == 0
        && stats.unsatisfied == 0
        && stats.wrong_root_samples == 0
        && stats.max_position_error_m <= ATLAS_POSITION_TOLERANCE_M
}

fn main() {
    let plan = load_plan();
    let ground_length = magnitude(sub(
        plan.geometry.output_ground_pivot,
        plan.geometry.input_ground_pivot,
    ));
    let crank_length = magnitude(plan.geometry.crank_vector);

    let report = Report {
        model: "derived exact parallelogram root-coalescence stress",
        atlas_position_tolerance_m: ATLAS_POSITION_TOLERANCE_M,
        geometry: GeometrySummary {
            ground_length_m: ground_length,
            crank_length_m: crank_length,
            coupler_length_m: ground_length,
            rocker_length_m: crank_length,
            start_angle_deg: -30.0,
            end_angle_deg: 30.0,
            step_deg: 0.25,
        },
        previous_only: run(false),
        linear_extrapolation: run(true),
    };

    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("coalescence report must serialize")
    );

    if !accepted(&report.linear_extrapolation) {
        eprintln!(
            "linear-extrapolation continuation failed Atlas tolerance: {:?}",
            report.linear_extrapolation
        );
        std::process::exit(1);
    }
}