# R2 creature sheet

How the renderer draws animals (R2): the phenotype port against the sim, and the
styles to choose between side by side: `report.html`, one self-contained file. A still
copy of `renderer/creatures.html` (`cd renderer && npm run dev`, then `/creatures.html`).

- World: seed 42, 2027-08-03 (summer)
- Renderer build: `6a1a70f7c352-dirty`
- 240 pictures, taken after the creatures have walked for 8 s;
  those with animals in them are loops of 6 s at 10 frames a second
  (animated PNG: they play in any browser, without a script)

Regenerate with `cd renderer && npm run creatures`; do not edit by hand. It is a view of
the look, not a measurement: nothing here is an acceptance criterion.
