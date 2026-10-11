# R0 look sheet

How the renderer spike draws terrain, plants and creatures: `report.html`, one
self-contained file. A still copy of `renderer/look.html`, which is the same sheet
with the creatures walking (`cd renderer && npm run dev`, then open `/look.html`).

- World: seed 42, 2027-08-03 (summer)
- Renderer build: `47366f13fb09`
- 102 pictures, taken after the creatures have walked for 8 s;
  those with animals in them are loops of 6 s at 10 frames a second
  (animated PNG: they play in any browser, without a script)

Regenerate with `cd renderer && npm run look`; do not edit by hand. It is a view of
the look, not a measurement: nothing here is an acceptance criterion.
