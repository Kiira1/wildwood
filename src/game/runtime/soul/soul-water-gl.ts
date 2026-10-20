import { decodedImage } from "../render/decoded-image";
import { TOWN_VILLAGE_GROUND } from "../../town-village";
import { SOUL_WATER_CELLS } from "./soul-water-cells";
import { EAST_BRIDGE_DECK, foamStrength, GLINT_DRIFT, GLINT_STRENGTH, GLINT_TILE, glintStrength, glintTile, waterCellsFromBits, waterRectInView, type WaterCells } from "./soul-water";
import type { Camera } from "../render/camera";
import type { StaticWorldGroundOverlay, StaticWorldLayer, StaticWorldLayerFrame } from "../render/webgl-static-world-layer";

/** The glint tiles' size on the GPU: a power of two, so they can repeat. */
const GLINT_TEXTURE = 256;

const VERTEX_SHADER = `
attribute vec2 a_world;
uniform vec2 u_shift;
uniform vec2 u_resolution;
uniform float u_zoom;
varying vec2 v_world;

void main() {
  vec2 clip = (a_world + u_shift) * u_zoom / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_world = a_world;
}
`;

// World units are measured from a point near the view, so they stay small enough for the shader's floats.
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_water;
uniform sampler2D u_shore;
uniform sampler2D u_glint0;
uniform sampler2D u_glint1;
uniform vec4 u_masks;
uniform vec2 u_drift0;
uniform vec2 u_drift1;
uniform vec3 u_strength;
uniform vec4 u_deck;
varying vec2 v_world;

void main() {
  if (v_world.x >= u_deck.x && v_world.x < u_deck.z && v_world.y >= u_deck.y && v_world.y < u_deck.w) discard;
  vec2 mask = (v_world + u_masks.xy) * u_masks.zw;
  float glint0 = texture2D(u_glint0, (v_world + u_drift0) / ${GLINT_TILE.toFixed(1)}).a * u_strength.x;
  float glint1 = texture2D(u_glint1, (v_world + u_drift1) / ${GLINT_TILE.toFixed(1)}).a * u_strength.y;
  float light = (1.0 - (1.0 - glint0) * (1.0 - glint1)) * texture2D(u_water, mask).a * ${GLINT_STRENGTH.toFixed(2)};
  float foam = texture2D(u_shore, mask).a * u_strength.z;
  float alpha = 1.0 - (1.0 - light) * (1.0 - foam);
  gl_FragColor = vec4(alpha, alpha, alpha, alpha);
}
`;

type Programs = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  textures: WebGLTexture[];
  uniforms: Record<"shift" | "resolution" | "zoom" | "masks" | "drift0" | "drift1" | "strength" | "deck", WebGLUniformLocation | null>;
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("WildStat river shader failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/** One texture from an image or canvas, alpha only for the masks (both are white). */
function upload(gl: WebGLRenderingContext, source: TexImageSource, format: number, wrap: number) {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, source);
  return texture;
}

function setUp(gl: WebGLRenderingContext, water: HTMLImageElement, shore: HTMLImageElement): Programs | null {
  // An older GPU's textures may be smaller than the masks: the canvas draws the river there.
  const largest = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (Math.max(water.naturalWidth, water.naturalHeight, shore.naturalWidth, shore.naturalHeight) > largest) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER), fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    // Slot 0, which the world layer's own quad also uses.
    gl.bindAttribLocation(program, 0, "a_world");
    gl.linkProgram(program);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  const buffer = gl.createBuffer();
  if (!program || !buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    return null;
  }
  const textures = [
    upload(gl, decodedImage(water), gl.ALPHA, gl.CLAMP_TO_EDGE), upload(gl, decodedImage(shore), gl.ALPHA, gl.CLAMP_TO_EDGE),
    upload(gl, glintTile(7, GLINT_TEXTURE), gl.ALPHA, gl.REPEAT), upload(gl, glintTile(29, GLINT_TEXTURE), gl.ALPHA, gl.REPEAT),
  ];
  // An upload that failed (out of memory) leaves only an error flag, which may be the world layer's own: throwing
  // hands the whole world back to the canvas, as the layer does for its own failed uploads.
  const error = gl.getError();
  if (error !== gl.NO_ERROR || textures.some(texture => !texture)) {
    for (const texture of textures) if (texture) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    if (error !== gl.NO_ERROR) throw new Error(`River texture upload failed (WebGL 0x${error.toString(16)})`);
    return null;
  }
  gl.useProgram(program);
  for (const [unit, name] of ["u_water", "u_shore", "u_glint0", "u_glint1"].entries()) gl.uniform1i(gl.getUniformLocation(program, name), unit);
  const uniform = (name: string) => gl.getUniformLocation(program, `u_${name}`);
  return {
    gl, program, buffer, textures: textures as WebGLTexture[],
    uniforms: { shift: uniform("shift"), resolution: uniform("resolution"), zoom: uniform("zoom"), masks: uniform("masks"),
      drift0: uniform("drift0"), drift1: uniform("drift1"), strength: uniform("strength"), deck: uniform("deck") },
  };
}

/**
 * The village river's light and foam drawn by the WebGL world layer, right after the ground's tiles: the masks and
 * glints are textures uploaded once, so a frame costs the CPU a few calls instead of the canvas's pixel work. Each
 * call says whether the river is handled; when not, the canvas draws it (soul-water.ts).
 */
export function createSoulWaterGL(options: {
  camera: Camera;
  water: () => HTMLImageElement | undefined;
  shore: () => HTMLImageElement | undefined;
  time: () => number;
  active: () => boolean;
}) {
  let programs: Programs | null = null;
  /** The context it was last set up on: a failure is not retried every frame. */
  let triedOn: WebGLRenderingContext | null = null;
  let cells: WaterCells | null = null;
  const vertices = new Float32Array(12);

  return function drawSoulWaterGL(gl: WebGLRenderingContext, frame: StaticWorldLayerFrame) {
    if (!options.active()) return false;
    const water = options.water(), shore = options.shore();
    if (!water?.complete || water.naturalWidth <= 0 || !shore?.complete || shore.naturalWidth <= 0) return false;
    if (programs?.gl !== gl) {
      if (triedOn === gl) return false;
      triedOn = gl;
      programs = setUp(gl, water, shore);
      if (!programs) return false;
    }
    const { camera } = options, area = TOWN_VILLAGE_GROUND;
    const view = {
      left: Math.max(area.x, camera.x), top: Math.max(area.y, camera.y),
      right: Math.min(area.x + area.w, camera.x + frame.width / frame.zoom), bottom: Math.min(area.y + area.h, camera.y + frame.height / frame.zoom),
    };
    if (view.left >= view.right || view.top >= view.bottom) return true;
    cells ??= waterCellsFromBits(SOUL_WATER_CELLS, TOWN_VILLAGE_GROUND);
    const wet = waterRectInView(cells, view);
    if (!wet) return true;
    // Measured from the tile corner nearest the view's, so the shader's numbers stay small.
    const originX = Math.floor(camera.x / GLINT_TILE) * GLINT_TILE, originY = Math.floor(camera.y / GLINT_TILE) * GLINT_TILE;
    const left = wet.left - originX, top = wet.top - originY, right = wet.right - originX, bottom = wet.bottom - originY;
    vertices.set([left, top, right, top, left, bottom, left, bottom, right, top, right, bottom]);
    const t = options.time(), deck = EAST_BRIDGE_DECK, { uniforms } = programs;
    const wrap = (value: number) => ((value % GLINT_TILE) + GLINT_TILE) % GLINT_TILE;
    gl.useProgram(programs.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, programs.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    const attributeOn = gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uniforms.shift, originX - camera.x, originY - camera.y);
    gl.uniform2f(uniforms.resolution, frame.width, frame.height);
    gl.uniform1f(uniforms.zoom, frame.zoom);
    gl.uniform4f(uniforms.masks, originX - area.x, originY - area.y, 1 / area.w, 1 / area.h);
    gl.uniform2f(uniforms.drift0, wrap(originX - t * GLINT_DRIFT[0][0]), wrap(originY - t * GLINT_DRIFT[0][1]));
    gl.uniform2f(uniforms.drift1, wrap(originX - t * GLINT_DRIFT[1][0]), wrap(originY - t * GLINT_DRIFT[1][1]));
    gl.uniform3f(uniforms.strength, glintStrength(t, 0), glintStrength(t, 1), foamStrength(t));
    gl.uniform4f(uniforms.deck, deck.left - originX, deck.top - originY, deck.right - originX, deck.bottom - originY);
    for (const [unit, texture] of programs.textures.entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Left as the world layer keeps it.
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    if (!attributeOn) gl.disableVertexAttribArray(0);
    return true;
  };
}

/**
 * Hands the river to the WebGL world layer, and returns the canvas's draw for it: that draws only when the layer did
 * not draw the river this frame (no WebGL, the layer off, or the river's set-up failed).
 */
export function routeRiver(layer: StaticWorldLayer | null | undefined, onGPU: StaticWorldGroundOverlay, onCanvas: () => void) {
  let drawn = false;
  layer?.setGroundOverlay?.((gl, frame) => (drawn = onGPU(gl, frame)));
  return function drawRiver() {
    if (!drawn || !layer?.active()) onCanvas();
    drawn = false;
  };
}
