import { SPRITE_VERTEX_FLOATS, type SpriteRecording, type SpriteSource } from "./sprite-recorder";
import { canvasVersion } from "./frozen-canvas";

/** Quads per draw call: their vertex numbers must fit a 16-bit index. */
export const MAX_SPRITE_QUADS = 16_384;
/** A texture not drawn for this many frames is released. */
const TEXTURE_IDLE_FRAMES = 600;

const VERTEX_SHADER = `
attribute vec4 a_position_uv;
attribute vec4 a_tint;
uniform vec2 u_resolution;
varying vec2 v_uv;
varying vec4 v_tint;

void main() {
  vec2 clip = a_position_uv.xy / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_position_uv.zw;
  v_tint = a_tint;
}
`;

// A radial batch's uv is the point's offset from the gradient's centre in outer radii, and its texture is the
// gradient's colour ramp, drawn by a 2D context so its colours blend exactly as the canvas blends them.
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_straight;
uniform float u_radial;
uniform float u_inner;
varying vec2 v_uv;
varying vec4 v_tint;

void main() {
  vec4 texel;
  if (u_radial > 0.5) {
    float t = clamp((length(v_uv) - u_inner) / (1.0 - u_inner), 0.0, 1.0);
    texel = texture2D(u_texture, vec2((t * 255.0 + 0.5) / 256.0, 0.5));
  } else {
    texel = texture2D(u_texture, v_uv);
    // Straight-alpha texels are premultiplied here, so every texture blends the same way.
    texel.rgb *= mix(1.0, texel.a, u_straight);
  }
  gl_FragColor = texel * v_tint;
}
`;

type SpriteTexture = { texture: WebGLTexture; smooth: boolean; straight: boolean; usedAt: number; version: number };

function isImageBitmap(source: SpriteSource): source is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap;
}

/**
 * Draws a sprite recording (sprite-recorder.ts) onto the WebGL world layer, one draw call per run of quads
 * that share a texture, filter, blend and kind. Textures are uploaded premultiplied, once per source.
 */
export function createWebGLSpritePass(
  gl: WebGLRenderingContext,
  compile: (vertex: string, fragment: string) => WebGLProgram | null,
  useAttributes: (...slots: number[]) => void,
) {
  const program = compile(VERTEX_SHADER, FRAGMENT_SHADER);
  if (!program) return null;
  const positionUv = gl.getAttribLocation(program, "a_position_uv");
  const tint = gl.getAttribLocation(program, "a_tint");
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const sampler = gl.getUniformLocation(program, "u_texture");
  const straight = gl.getUniformLocation(program, "u_straight");
  const radial = gl.getUniformLocation(program, "u_radial");
  const inner = gl.getUniformLocation(program, "u_inner");
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (positionUv < 0 || tint < 0 || !resolution || !sampler || !straight || !radial || !inner || !vertexBuffer || !indexBuffer) {
    gl.deleteProgram(program);
    return null;
  }
  const indices = new Uint16Array(MAX_SPRITE_QUADS * 6);
  for (let quad = 0, vertex = 0; quad < MAX_SPRITE_QUADS; quad += 1, vertex += 4) {
    indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], quad * 6);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.useProgram(program);
  gl.uniform1i(sampler, 0);

  const textures = new Map<SpriteSource, SpriteTexture>();
  let white: WebGLTexture | null = null;
  let frame = 0;
  let uploaded = false;
  // Whether this browser uploads an ImageBitmap with its colour already multiplied by its alpha (Chrome does);
  // measured once on a half-transparent pixel, and assumed until then.
  let bitmapsPremultiplied = true;
  probeBitmapAlpha();

  function probeBitmapAlpha() {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return;
    const source = document.createElement("canvas");
    source.width = source.height = 1;
    const paint = source.getContext("2d");
    if (!paint) return;
    paint.fillStyle = "rgba(255, 0, 0, .5)";
    paint.fillRect(0, 0, 1, 1);
    createImageBitmap(source).then(bitmap => {
      if (gl.isContextLost()) { bitmap.close(); return; }
      const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
          const pixel = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[3] > 0) bitmapsPremultiplied = pixel[0] < 192;
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
        bitmap.close();
      }
      for (const [key, entry] of textures) if (isImageBitmap(key)) entry.straight = !bitmapsPremultiplied;
    }, () => {});
  }

  function setFilter(smooth: boolean) {
    const filter = smooth ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** The one-pixel white texture solid quads are drawn with, made the first time one is. */
  function bindWhite() {
    if (!white) {
      white = gl.createTexture();
      if (!white) throw new Error("Could not create the world sprites' white texture");
      gl.bindTexture(gl.TEXTURE_2D, white);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      setFilter(false);
      uploaded = true;
    } else gl.bindTexture(gl.TEXTURE_2D, white);
  }

  /** Binds a source's texture with the filter asked for, uploading it the first time. */
  function bindSource(source: SpriteSource, smooth: boolean) {
    let entry = textures.get(source);
    // A shared canvas that says it changed (canvas-atlas.ts pages, the minimap) is uploaded again.
    if (entry && entry.version !== canvasVersion(source)) {
      gl.deleteTexture(entry.texture);
      textures.delete(source);
      entry = undefined;
    }
    if (!entry) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not create a world sprite texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      setFilter(smooth);
      // An ImageBitmap ignores the unpack flags and arrives as the browser keeps it (see probeBitmapAlpha).
      const bitmap = isImageBitmap(source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !bitmap);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        uploaded = true;
      } finally {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
      entry = { texture, smooth, straight: bitmap && !bitmapsPremultiplied, usedAt: frame, version: canvasVersion(source) };
      textures.set(source, entry);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      if (entry.smooth !== smooth) { setFilter(smooth); entry.smooth = smooth; }
    }
    entry.usedAt = frame;
    return entry;
  }

  function release(idleFrames: number) {
    for (const [source, entry] of textures) {
      if (frame - entry.usedAt < idleFrames) continue;
      gl.deleteTexture(entry.texture);
      textures.delete(source);
    }
  }

  /** Draws the recording; true when it uploaded a texture, the only time an allocation error is worth checking for. */
  function draw(recording: SpriteRecording, backingWidth: number, backingHeight: number) {
    frame += 1;
    uploaded = false;
    if (!recording.quads) return false;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, recording.vertices.subarray(0, recording.quads * SPRITE_VERTEX_FLOATS * 4), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    useAttributes(positionUv, tint);
    const stride = SPRITE_VERTEX_FLOATS * 4;
    gl.vertexAttribPointer(positionUv, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(tint, 4, gl.FLOAT, false, stride, 16);
    gl.uniform2f(resolution, backingWidth, backingHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    let blend = "";
    let straightNow = -1, radialNow = -1, innerNow = -1;
    for (const batch of recording.batches) {
      if (batch.blend !== blend) {
        blend = batch.blend;
        if (blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      let straightBatch = 0;
      if (batch.source) straightBatch = bindSource(batch.source, batch.smooth).straight ? 1 : 0;
      else bindWhite();
      const radialBatch = batch.radial === null ? 0 : 1;
      if (straightBatch !== straightNow) { gl.uniform1f(straight, straightBatch); straightNow = straightBatch; }
      if (radialBatch !== radialNow) { gl.uniform1f(radial, radialBatch); radialNow = radialBatch; }
      if (batch.radial !== null && batch.radial !== innerNow) { gl.uniform1f(inner, batch.radial); innerNow = batch.radial; }
      gl.drawElements(gl.TRIANGLES, batch.count * 6, gl.UNSIGNED_SHORT, batch.first * 12);
    }
    gl.disable(gl.BLEND);
    if (frame % 120 === 0) release(TEXTURE_IDLE_FRAMES);
    return uploaded;
  }

  return {
    slots: [positionUv, tint],
    draw,
    /** Forgets every uploaded texture (the layer's tiles were dropped, or its context went). */
    clear() {
      for (const entry of textures.values()) gl.deleteTexture(entry.texture);
      textures.clear();
      if (white) gl.deleteTexture(white);
      white = null;
    },
    textureCount: () => textures.size,
  };
}

export type WebGLSpritePass = NonNullable<ReturnType<typeof createWebGLSpritePass>>;
