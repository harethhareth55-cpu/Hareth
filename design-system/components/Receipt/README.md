# Receipt

The thermal-printer receipt at 80mm (or 58mm with `paper-58`), always black on white.

The receipt is outside the theme: it never changes in dark mode and uses only #111 text and a dashed #999 rule. Shop name and footer are centred; item rows are a borderless table. Print it from a hidden `#print-root` with `@page { margin: 8mm }`.
