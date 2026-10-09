# Presence and god powers

## The owner is the sun (M8)

A PIR sensor reports presence; hold logic lives upstream (device/server), and the sim
receives `PresenceChanged` events.

- Present → day; leaving in the evening → dusk; absent → night.
- Weekends are the **Long Night**; holidays are **dark ages**.
- After N days of darkness a moonlight floor keeps some light.
- Seasons follow the real calendar (UTC internally).

## God powers (M8)

A covered toggle switch triggers one intervention — meteor, rain, seed, ark — with a
7-day cooldown kept in sim state and shown by an LED.

## Targets

- The office schedule measurably selects for night traits compared with always-present.
- A 3-week absence leaves life alive in `[≥ 80%]` of seeds.

## Open

- How the switch selects which god power fires.
- Holiday calendar source (injected as events or config).
