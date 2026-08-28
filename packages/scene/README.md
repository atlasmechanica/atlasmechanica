# @atlasmechanica/scene

Renderer-neutral presentation scenes for Atlas Mechanica.

A `MechanismScene` is derived, disposable presentation state. It may be compiled from a canonical `SimulationModel`, evaluated `ModelState`, authored parameters, traces, and temporary interaction feedback, but it is not corpus truth and contains no solver-specific state.

Semantic `layer` and `styles` fields describe intent (`mechanism`, `annotation`, `body`, `vector`, etc.) without naming SVG/CSS implementation details. Renderers consume this package; simulation adapters do not depend on it.
