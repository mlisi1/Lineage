# Creatures

## Genome and body (M4)

A genome of body genes plus rare-gene slots maps to a procedural body through a
phenotype function. The same spec drives `fauna/phenotype.py` and the renderer; a
cross-language test checks both agree (R2). Trade-offs hold: bigger is costlier.

Bodies are chains of circles (spine) with limbs, mouth, eyes, armour, patterns and rare
overlays, animated procedurally (chain follow, leg IK, fins).

## Life (M4)

Movement on terrain, metabolism, eating plants or meat, sexual reproduction with mate
compatibility, mutation, asexual fallback, population cap.

## Brain and learning (M4–M5)

A small neural brain, evolved at first. M5 adds lifetime learning: reward-modulated
policy updates with eligibility traces and exploration noise, with learning-rate and
exploration genes. "Time to competence" measures how fast a newborn learns to feed.

## Species (M6)

Daily genome clustering with persistent ids, speciation and extinction detection,
syllable names derived from the genome with lineage-aware daughter names, a phylogeny.

## Rare genes (M7)

Rare genes carry an extreme bonus and a real cost (e.g. venom, glow, hibernation,
photosynthesis) and a visual signature for the renderer. None should reach fixation for
long.

## Open

- Gene list and ranges; brain inputs and outputs.
- Full rare gene table (creatures and plants).
