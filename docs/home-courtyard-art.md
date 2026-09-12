# Home courtyard

The reference direction is a warm stone courtyard in green grass, with a red
equipment workshop on the left and a blue research station on the right. The
southern approach leads through paired lanterns and planters to a circular plaza.
Phone chrome, screenshot controls, and HUD elements are not map artwork.

`src/game/runtime/home-courtyard.ts` owns the illustration. Terrain, low curbs,
plants, crates, rugs, and lanterns are painted into the existing static tile cache,
using the same code in the worker and main-thread fallback. This avoids an extra
full-screen image download and keeps decorations stable across zoom and resizing.

The existing transparent workbench sprite is retained. The research desk and
both wooden signs draw through the depth-sorted station renderer; player names,
equipment, research display, and upgrade item/timer remain live. Culling includes
the full height of the signs.

Home is 1,200 units wide and 1,500 tall. The original artwork, station interaction
coordinates, minimap paths, and arrival position shift together by (100, 250),
keeping the courtyard centered without scaling it. Client and server share the
rectangular movement bounds. Grass and border trees fill the enlarged lawn.
The minimap paths describe the expanded courtyard and entrance. The stone curbs
and small props are decorative, as with the existing Home scenery; this change
does not add server collision geometry or alter travel and station triggers.
