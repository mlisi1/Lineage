# Concept

Lineage is an idle desk gadget: a small procedurally generated island where creatures and
plants evolve over **years** of real time. It sits on a work desk, runs 24/7, and writes
its own history.

## Pillars

- **Slow, real time.** One sim second is one wall second on the device. Nothing resets
  except at the end of a world.
- **Life evolves.** Creatures (genome → procedural body, small neural brain, evolution
  plus lifetime learning) and plants (8-gene genome, succession) change over generations.
  Rare genes give an extreme bonus at a real cost.
- **The owner is the sun.** Presence at the desk sets daylight; absences are nights,
  weekends are the Long Night, holidays are dark ages. Seasons follow the real calendar.
- **One rare intervention.** A covered switch triggers a god power with a 7-day cooldown.
- **History is the product.** A chronicle of dated entries and a bestiary of every species
  that ever lived.

## Time model

Sim time is seconds since world creation. Subsystems tick on their own schedules from
`sim/config/default.toml` `[schedule]`: creatures at a behaviour rate, flora and terrain on
coarse ticks. Fast-forward runs the same code with large steps. The sim never reads the
clock; the server injects time through `World.step(dt)` and real-world inputs as events
through `World.apply(event)`.

## World lifecycle

A world starts from a seed as a new continent. If life collapses, an apocalypse plays, the
world is archived (chronicle, bestiary, phylogeny, final map) and a new continent is
generated with a new seed. Worlds are numbered.

## Outputs

- One continuous scene on the 7" desk screen: documentary camera and captions.
- Phone web app with the same renderer, plus chronicle, bestiary and stats.
- Push notifications for major events.
- A daily public journal (static site) that also backs up the save off-device.

## Open

- Collapse criteria for ending a world (M10).
- Archive retention policy on the device.
