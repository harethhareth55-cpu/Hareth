# Field

A labelled input, select or textarea with an optional hint line.

Wrap the control in `<label class="field">` so the label text sits above it and tapping the label focuses it. Controls are 48px tall (`control-lg`) with 16px text so phones do not zoom on focus.

**Numbers.** Amounts, PINs, phone numbers and barcodes get `class="num"` and a numeric `inputmode`; they run left to right inside the RTL form so digits read naturally.

**States.** Add `invalid` on the `.field` and put the error in `.hint`, saying what to fix (الرمز وتأكيده مختلفين).

**Consumer provides** the label, `name`, `inputmode`, and the hint or error text.
