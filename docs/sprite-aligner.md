# Character Studio

Open **launchers/Open Sprite Aligner.command**, or run `npm run art:align` and visit
http://127.0.0.1:4174/public/sprite-aligner.html. Keep its terminal open.
Source changes refresh the tool automatically.

Choose an outfit and skin tone. The left preview shows the current game alignment;
the right preview shows your changes. Both call the game's actual character renderer,
using the same item art, body cache, layering, skin colors, walking and weapon poses.
Use 1× to inspect the renderer's world size, or zoom in to align details.

**Head & eyes → Edit eyes** selects the independently editable eye pair. Position,
size, angle and eye spacing save per helmet, so fitting one helmet does not change
the others. The eyes inherit the head shape's position, scale and animation.
**Helmet view → Ghost helmet / Hide helmet** reveals the face while fitting it;
the reference preview stays solid. This visibility aid is not exported.

The head uses the edited 65 × 50 **expansion-head-template.png**, originally
extracted from the expansion Parts PSD, with its outline and transparency preserved. Its position is registered
against the shared 118 × 106 helmet export canvas. The original character pack's
heads have different proportions and are not used as helmet-fit templates.
**Vendor ghost overlay → Expansion pack · helmet template** compares the source
mask at native size. The overlay follows head motion and facing and is not exported.
The PSD has no eyes; our separately editable eye pair remains a game layer.
Source measurements for Wood, Alpha Tester, Fire Metal and Dark Metal helmets are
in **docs/qa/expansion-head-measurements.json**. Existing saved head and helmet
adjustments still apply in the right preview; the left current-game view shows the
corrected baseline without those draft offsets.

The current game head uses the approved **2px right** adjustment. A saved head
adjustment replaces that default, so the existing +2px draft is applied once.
Source defaults show the unadjusted PSD position.

The **Weapon library** includes expansion categories found in the local vendor
folder. Previous/Next cycles through variants, loading only the selected image.
An exact artwork match picks up that item's current in-game settings automatically.
Weapons not used in the game are explicitly marked as vendor art.

**Compare** switches the reference between current game settings and source
defaults. Source defaults use natural image dimensions at the renderer's standard
anchors (helmet bottom 144, chest bottom 168, weapon top 116). **Starting alignment**
chooses the baseline for your edits; each baseline keeps separate adjustments.
The size and anchor values appear below the inspector. Original body/leg placement
is shared between modes. Source defaults do not imply a separate vendor animation
system: all previews use the game's existing held-weapon/throw/bow animation paths.

Select a layer, then drag it or use the horizontal, vertical and size controls.
Arrow keys nudge the focused preview; Shift moves five source pixels. Nudges and
dragging follow screen direction even when the character or weapon is mirrored.
Choose a layer in the sidebar to reach parts hidden behind other equipment.

Switch poses and facing to check the adjustment. Play/Pause and Step freeze
animation for precise edits. Undo, Redo and Reset layer recover previous work.

**Angle °** rotates the selected layer. For weapons, **Set grip point** lets you
click the handle; changing this point preserves the current placement. The guide
cross marks the grip. Rotation, sizing and **Flip weapon** then pivot around it.
Escape cancels grip selection. **Turn around** mirrors the character and attached
weapon together; aim is relative (Forward/Backward), so it turns with the actor.
Angles, flips and grip points are stored per item and included in exports.

Edits automatically save to **art-source/alignments/character-alignment.json**
after a short pause. **Save to project** saves immediately, without a file picker.
The previous file is backed up at
**local-data/sprite-aligner-backups/character-alignment.previous.json**.
Browser drafts remain as an offline fallback. Opening the tool in a fresh browser
loads the project file. If another tab changes it, automatic saving pauses and
lets you load the saved version or explicitly save your draft instead.

**Files & source artwork → Download JSON copy** keeps a portable copy; Import
restores one. Saving preserves alignment proposals in the project; applying them
to the live game still requires integrating and releasing the chosen settings.
The optional renderer `alignment` argument uses source-pixel offsets and a
uniform scale about each layer's chosen pivot.

The original vendor source library is linked under **Files & source artwork**.
It is retained for browsing source packs; use Character Studio to check the
current in-game appearance. The enemy aligner remains a separate tool.

Checks: `npm run typecheck:coop`, `npm run art:align:build`, and
`npx vitest run src/game/player-appearance.test.ts src/game/player-layer-alignment.test.ts src/tools/sprite-aligner/state.test.ts`.
The build command validates the tool bundle; run the development server to use
the local artwork library.

Sword presentation defaults live in **src/game/equipment-alignment.ts**, promoted
from the exported Sword 020 Black alignment. Tag a weapon presentation with
`weaponCategory: "SWORD"` to inherit the grip, offset and angle; its own `alignment`
can override that default. Editor adjustments take precedence over both. All
expansion swords inherit this in Current game mode; Source defaults remain raw.
