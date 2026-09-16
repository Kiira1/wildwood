# Guild replay follow-up

New fights use combat version 4. Saved versions 2 and 3 retain their original
simulation and entrance schedule; captured historical outcome/duration tests
cover both. Version 4 must ship with the matching server and clients.

Fighters enter from beyond the arena at the same 90 world units/second used in
combat. The renderer projects that speed through the arena camera, without
entrance easing. Paired arrivals are spaced 0.55–1.2 seconds apart. Combat runs
while later fighters enter, and dead/hidden fighters are skipped by the painter.

Target selection uses deterministic random tie-breaks among the least-targeted
active opponents. Targets remain stable between knockouts and reinforcement
waves. Reserves cannot attack or be attacked before their arrival. Names and
identities do not influence combat, so moderation cannot alter a saved result.

Outlined name and HP text now uses a replay-owned cache with at most two canvases
per fighter. HP changes replace the same canvas; resize changes refresh its
resolution, and closing the replay releases all canvases. A 40-fighter regression
test renders 60 moving frames with 80 text rasterizations instead of 4,800.
World rendering already pauses behind the guild window. Replay presentation
remains 60 FPS, or 30 FPS when Low Performance Mode is enabled.

This reduces work and staggers arrivals; it does not guarantee fewer than 40
living fighters in every matchup. Actual phone frame rate still requires device
verification. No phone FPS result is claimed from the operation-count tests.
