# Brown 003 page source note

The initial Brown 003 catalog copy is based on movement 3 of Henry T. Brown's *507 Mechanical Movements* as represented by the current online transcription at https://507movements.com/mm_003.html.

Brown describes transmission between shafts at right angles using guide pulleys, and explicitly states that two guide pulleys are arranged side by side, one for each leaf of the belt. The standard engineering term for a belt drive between pulleys whose axes are at right angles is a **quarter-turn drive** (also called a right-angle belt drive).

Important modeling boundary: Brown 003 is spatial. The current Atlas belt model is intentionally planar and represents one driver pulley, one driven pulley, and open/crossed routing. It must not be reused as a fake physical model for this occurrence.

The canonical `quarter-turn-belt-drive` subject therefore starts with simulation status `planned`. The reserved model/adapter identifiers (`foundation:belt-drive:quarter-turn-guided` and `atlas.spatial-belt.v0`) describe the intended boundary; they are not claims that a spatial adapter is already registered.

Issue #69 tracks promotion of Brown 003 from `mapped` to `interactive` once Atlas can represent perpendicular shaft axes and the two passive guide pulleys honestly.
