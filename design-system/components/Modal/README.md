# Modal

A sheet over a scrim for a confirmation or a short form that must finish before the user goes on.

On phones the sheet rises from the bottom; from 980px it centres. It is at most 520px (`sheet-width`) wide. Actions sit in `.modal-actions`, sharing the width, with the confirming action last (left in RTL).

**Consumer provides** the title, body and two actions. Never use the browser's `confirm()`.
