import { writeFileSync } from 'node:fs';
import { buildSmoothCurve, SMOOTH_CURVE_FILE } from './balance/smooth-curve';

// npx tsx scripts/build-smooth-curve.ts — rewrites shared/smooth-curve.ts from its committed source revision.
writeFileSync(SMOOTH_CURVE_FILE, buildSmoothCurve());
