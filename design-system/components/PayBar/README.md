# PayBar

The amount due and the Pay button: a sticky ticket column on desktop, docked above the tab bar on phones.

On desktop, `.ticket` is a 300px (`ticket-width`) card that holds the customer field, secondary actions and the `total` figure above a full-width primary button. Under 980px the same content becomes `.paybar`, rounded on its top corners only and lifted with `shadow-sheet`.

**Consumer provides** the formatted total and the Pay handler. The total always carries `.num`.
