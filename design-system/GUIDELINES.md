Muhasib (محاسب) is the shared interface for the shop apps in this repository: the cashier POS (محاسب الكاشير) and the delivery ledger (محاسب التوصيل). It is built for Iraqi shop owners, cashiers and delivery drivers working on a phone or a counter laptop, often offline, always in Iraqi dinars and always right to left.

## Content fundamentals

- **Language.** Arabic first, in plain Iraqi-friendly Modern Standard Arabic. The delivery app may use light Iraqi dialect in helper text (ما يتعدل الطلب بعد ما يطلع مع المندوب); keep labels and buttons in standard forms (حذف, تعليق, دفع).
- **Voice.** Speak to the person at the counter as "you", briefly. Tell them what to do next: عدّ النقد الموجود في الصندوق قبل أول فاتورة.
- **Buttons** are one or two word verbs: دفع، تعليق، فتح الوردية، تفعيل، قفل. No icons inside them.
- **Errors** say what went wrong and how to fix it, in one sentence: مكتبة المسح ما تحمّلت. حدّث الصفحة وأنت متصل مرة واحدة.
- **Success** is past tense in a Toast: تم تنزيل الإكسل.
- **No emoji** in the interface. The delivery app's 📷 🛵 💰 tab glyphs are retired in favour of words.

## Money, numbers and dates

- Format every amount with `Intl.NumberFormat('ar-IQ')` and the suffix `د.ع`, rounded to whole dinars: `٣٧٬٥٠٠ د.ع`. Never show fils or decimals for money.
- Wrap every figure, barcode, PIN and phone number in `.num`: it isolates the run left to right and switches on tabular figures so amounts line up in RTL columns.
- Numeric inputs take `inputmode="numeric"` (amounts, PINs) or `"decimal"` (weights), and their text runs left to right.
- Dates and times use `ar-IQ` with `timeZone: 'Asia/Baghdad'`, short month. A missing value is `—`.

## Colour

- The ground is `bg`; content sits on `surface` cards; inputs fill with `field`. Text is `ink`, secondary text `muted`.
- `brand` (dinar green) is the one action colour: the primary button, the active chip, the selected outline. Text on it is `on-brand`. Use `brand-strong` for green text and `brand-soft` for green tints.
- The navigation chrome (Sidebar, TopBar) is `sidebar` with `on-sidebar` and `on-sidebar-muted` text.
- States always pair a word with a colour: `amber` on `amber-soft` for money owed and trials, `danger` on `danger-soft` for removals, shortages and returns, `info` on `info-soft` for new orders. `brand` green and `danger` red have the same lightness, so never rely on colour alone to tell them apart.
- The dark theme is new to this system. In it `brand` lightens to a mint green and `on-brand` turns dark; never hard-code white text on a green fill.
- Focus is a 2px solid `focus` ring, offset 2px, on every control.
- Known gap kept from the source apps: input borders in `line` are about 1.2:1 on `field` in light mode, below the 3:1 guideline for control borders. Inputs stay identifiable by their 48px height and label; raise `line` if a stricter contrast target applies.

## Type

- One family, Cairo, loaded from Google Fonts at weights 400, 600, 700 and 800, with `Noto Kufi Arabic`, `Segoe UI` and Tahoma as fallbacks (`--font-sans`).
- Use `total` (32px, 800) only for the amount due; `total-compact` (24px) on the phone pay bar; `stat-value` (18px, 700) in Stat tiles.
- One `page-title` (22px; 18px on phones) per screen. Card headings are `section`. Running text is `body`; labels and key-value rows `body-sm`; table headers and sub-lines `caption`; badges and stat labels `label`; the tab bar alone uses `tab`.
- Inputs are 16px so phones do not zoom on focus.

## Spacing, radius and elevation

- Spacing comes from the measured steps in the apps: 2, 4, 6, 8, 10, 12, 14, 16, 22, 24, 28px (`space-*`). Rows of siblings use `gap`, not margins. The default gap between related controls is `space-8`; between cards `space-14`.
- Controls round at `radius-sm` (12px), Stat tiles and list rows at `radius-md` (14px), cards and sheets at `radius-lg` (16px), pills at `radius-pill`.
- Only cards, stats, the ticket and modal sheets carry `shadow-card`. The phone pay bar lifts with `shadow-sheet`. Nothing else has a shadow.
- Touch targets are at least `control-md` (44px). Inputs and the Pay button are `control-lg` (48px).

## Layout

- Under 980px (`desktop-breakpoint`): one column with 12px gutters, a fixed TabBar at the bottom and, on the sale screen, the PayBar docked just above it. Pad for `env(safe-area-inset-bottom)`.
- From 980px: a `sidebar-width` (232px) Sidebar and the main area with 22px/28px padding. The sale screen splits into the cart and a sticky `ticket-width` (300px) ticket.
- Single-purpose apps such as the delivery ledger cap their content at `content-width` (760px) under a sticky TopBar.
- Auth and setup screens centre one card at most `gate-width` (440px) wide.
- Tables scroll sideways inside `.table-wrap`; the page never scrolls sideways.

## Iconography and marks

- The apps use no icon library. Navigation and actions are words.
- The in-app brand mark is a letter tile: the first letter of the app's Arabic name (ك for the cashier, م for delivery) in `brand` on a white 42px tile with `radius-sm`.
- The installable app icons are in the Logos group. The cashier icon is a white receipt on a green disc; the delivery icon is a QR code and stamp on a white tile over green. Use them as they are; do not redraw them.

## Print

- Receipts print at 80mm or 58mm in black on white, outside the theme. See Receipt.
- Statements and reports print full width with 8mm page margins.

## Not synced

- Fonts are hosted on Google Fonts, so no font files are stored here.
- The QR scanner (html5-qrcode) and the Excel export (SheetJS) are third-party libraries with their own UI and are not part of this system.
- The older Firebase cashier branch used an indigo accent (#4f5fe0) and 10px radii. Both were dropped in favour of the later green-only system.
- Components are static HTML and CSS renditions; the apps render them from template strings, so there is no JavaScript bundle.
