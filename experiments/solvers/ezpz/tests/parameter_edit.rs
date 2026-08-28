use atlas_ezpz_spike::{load_plan, solve_sample};

#[test]
fn warm_start_preserves_configuration_across_link_length_edit() {
    let plan = load_plan();
    let configuration = plan.configurations["open"].clone();
    let theta = 45_f64.to_radians();

    let baseline = solve_sample(&plan, &configuration, theta, configuration.seed_b)
        .expect("baseline solve");
    assert!(baseline.converged);
    assert!(baseline.satisfied);
    assert_eq!(baseline.branch_sign, configuration.branch_sign);

    let mut edited = plan.clone();
    edited.geometry.coupler_length = 0.085;
    let changed = solve_sample(&edited, &configuration, theta, baseline.b)
        .expect("edited-geometry solve");
    assert!(changed.converged);
    assert!(changed.satisfied);
    assert_eq!(changed.branch_sign, configuration.branch_sign);
    assert!(changed.position_error <= 1e-8);

    let restored = solve_sample(&plan, &configuration, theta, changed.b)
        .expect("restored-geometry solve");
    assert!(restored.converged);
    assert!(restored.satisfied);
    assert_eq!(restored.branch_sign, configuration.branch_sign);
    assert!(restored.position_error <= 1e-8);
}
