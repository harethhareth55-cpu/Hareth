# Muhasib design system

The shared look of the shop apps in this repository: the cashier POS (`cursor/cashier-pos-322f`) and the delivery ledger (`cursor/delivery-accountant-322f`). Extracted from their stylesheets and unified, with `cashier-pos` as the canonical source where they disagreed. The dark theme is new.

| File | What |
| --- | --- |
| `GUIDELINES.md` | The brand book: copy, money and number formatting, colour, type, spacing, layout, print. |
| `tokens.json` | Source of truth for every colour (light and dark), type style, spacing step, radius, size, shadow and z-index. |
| `tokens.css` | CSS custom properties generated from `tokens.json`, plus `.t-*` type classes. |
| `components.css` | Component classes (`.btn`, `.field`, `.card`, `.stat`, `.badge`, `.tabbar` …), built on the tokens. |
| `components/<Name>/` | Guideline (`README.md`) and markup example (`preview.html`) for each of the 18 components. |
| `index.html` | All components on one page, with a dark-mode toggle. Serve the folder (`python3 -m http.server`) and open it. |
| `assets/Logos/` | The two installable app icons. |

## Using it in an app

```html
<html lang="ar" dir="rtl">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/components.css">
<body class="mh">
```

Theme follows the device; set `data-theme="light"` or `"dark"` on `<html>` to force one.
