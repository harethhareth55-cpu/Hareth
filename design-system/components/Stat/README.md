# Stat

A tile with one labelled figure, shown three across at the top of the sale and report screens.

`.stats` lays tiles in a 3-column grid (one column under 640px except on the sale screen, which stays at three and shrinks). A tile can be a `<button>` when it links to its detail screen.

**Variants.** `warn` paints the tile `amber-soft` for money owed. A red `<em>` line under the figure flags an overdue part; `.low` turns a count red.

**Consumer provides** the label (`label` style), the figure already formatted in dinars, and an optional alert line.
