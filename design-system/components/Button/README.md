# Button

A tappable action in one of four tones: primary green, secondary outline, ghost text and danger.

Use one primary button per view for the step that moves money or stock forward (دفع, فتح الوردية, تفعيل). Put Cancel and other ways out in `secondary`; use `danger` only for removals (حذف) and voids.

**Markup.** `<button class="btn">`, plus a modifier: `secondary`, `ghost`, `danger`; size with `small` (40px) or `large` (48px, 18px text, the Pay button). `selected` outlines a picked option. Group with `.btn-row`, which makes siblings share the width.

**Consumer provides** the label (a verb, two words at most), `type`, and `disabled` while a write is in flight.

- Default height is `control-md` (44px); never go under `control-sm`.
- Labels are short Arabic verbs. No icons inside buttons.
- Disabled is 50% opacity, not a different colour.
