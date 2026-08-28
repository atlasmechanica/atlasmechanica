fn main() {
    let report = atlas_ezpz_spike::benchmark_report();
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("benchmark report must serialize")
    );
}
