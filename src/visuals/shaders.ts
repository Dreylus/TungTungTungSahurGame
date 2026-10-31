export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Main board shader: territory colours, borders and per-pixel effects. */
export const SCENE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uOwner;
uniform usampler2D uAge;
uniform sampler2D uPal;
uniform sampler2D uHeat;
uniform sampler2D uBack;
uniform vec2 uGrid;
uniform vec2 uRes;
uniform vec2 uOff;
uniform float uScale;
uniform float uTime;
uniform float uTick;
uniform float uDpr;
uniform int uStyle;
uniform int uFlags;
out vec4 outColor;

const int F_MP = 1, F_TRAIL = 2, F_HEAT = 4, F_PULSE = 8, F_PAT = 16, F_BACK = 32, F_AGE = 64, F_WRAP = 128;

uint ownerAt(ivec2 c) {
  ivec2 g = ivec2(uGrid);
  if ((uFlags & F_WRAP) != 0) c = ((c % g) + g) % g;
  else if (c.x < 0 || c.y < 0 || c.x >= g.x || c.y >= g.y) return 255u;
  return texelFetch(uOwner, c, 0).r;
}
vec3 pal(uint o) { return texelFetch(uPal, ivec2(int(o), 0), 0).rgb; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
vec3 inferno(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0015, 0.0005, 0.014), b = vec3(0.47, 0.11, 0.43), c = vec3(0.93, 0.41, 0.15), d = vec3(0.99, 0.99, 0.64);
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
}
float pattern(uint o, vec2 q) {
  int k = int(o - 1u) % 8;
  if (k == 0) return 0.0;
  if (k == 1) return step(0.5, fract((q.x + q.y) * 0.25));
  if (k == 2) return step(0.5, fract(q.y * 0.25));
  if (k == 3) return step(0.5, fract(q.x * 0.25));
  if (k == 4) return 1.0 - step(0.32, length(fract(q * 0.25) - 0.5));
  if (k == 5) return step(0.5, fract((q.x - q.y) * 0.25));
  if (k == 6) { vec2 f = step(0.5, fract(q * 0.125)); return abs(f.x - f.y); }
  return max(step(0.75, fract(q.x * 0.25)), step(0.75, fract(q.y * 0.25)));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 g = (p - uOff) / uScale;
  bool mp = (uFlags & F_MP) != 0;
  bool paper = uStyle >= 3;
  if (uStyle == 3) g += (vec2(noise(g * 0.13 + 3.1), noise(g * 0.13 + 7.7)) - 0.5) * 1.7;
  ivec2 c = ivec2(floor(g));
  uint o = ownerAt(c);
  vec3 bgc = paper ? vec3(0.91, 0.88, 0.80) : vec3(0.016, 0.02, 0.036);
  if (o == 255u) {
    vec3 col = bgc;
    if (!paper) {
      vec2 d = fract(p / (18.0 * uDpr)) - 0.5;
      col += 0.03 * smoothstep(0.09, 0.0, length(d));
    } else col *= 0.94 + 0.06 * noise(p * 0.08);
    outColor = vec4(col, 1.0);
    return;
  }
  uint r = ownerAt(c + ivec2(1, 0)), l = ownerAt(c - ivec2(1, 0));
  uint d = ownerAt(c + ivec2(0, 1)), u = ownerAt(c - ivec2(0, 1));
  bool edge = r != o || l != o || d != o || u != o;
  vec2 f = fract(g);
  float side = 1.0;
  if (r != o) side = min(side, 1.0 - f.x);
  if (l != o) side = min(side, f.x);
  if (d != o) side = min(side, 1.0 - f.y);
  if (u != o) side = min(side, f.y);
  float lineW = clamp(1.3 * uDpr / uScale, 0.0, 0.5);
  float zoomed = step(3.5, uScale);
  float onLine = edge ? mix(1.0, step(side, lineW), zoomed) : 0.0;
  vec3 col;
  float emit = 0.0;
  if (o == 254u) {
    float n = noise(g * 0.6);
    col = paper ? vec3(0.42, 0.38, 0.34) + n * 0.05 : vec3(0.15, 0.16, 0.2) + n * 0.05;
    col += onLine * (paper ? -0.12 : 0.07);
  } else if (o == 0u) {
    col = paper ? vec3(0.95, 0.93, 0.87) : vec3(0.05, 0.06, 0.095);
    if (uScale > 7.0 && !paper) col += 0.022 * (1.0 - step(0.05, min(f.x, f.y)));
    if ((uFlags & F_BACK) != 0) {
      vec3 b = texture(uBack, (g + 0.5) / uGrid).rgb;
      col = paper ? mix(col, b, 0.4) : mix(col, b * 0.5, 0.85);
    }
    if (paper) col *= 0.95 + 0.05 * noise(p * 0.1);
  } else {
    vec3 base = pal(o);
    col = base;
    if (mp) {
      float a = float(texelFetch(uAge, c, 0).r);
      float age = mod(uTick - a + 65536.0, 65536.0);
      if ((uFlags & F_AGE) != 0) col = mix(base * 1.1 + 0.03, base * 0.74, smoothstep(0.0, 1500.0, age));
      if ((uFlags & F_PULSE) != 0) col *= 1.0 + 0.075 * sin(uTime * 2.3 + float(o) * 1.7 + (g.x + g.y) * 0.04);
      if ((uFlags & F_TRAIL) != 0) {
        float young = exp(-age / 16.0);
        col = mix(col, vec3(1.0), young * 0.5);
        emit = max(emit, young * 0.9);
      }
    }
    if ((uFlags & F_BACK) != 0) {
      float lum = dot(texture(uBack, (g + 0.5) / uGrid).rgb, vec3(0.299, 0.587, 0.114));
      col *= 0.55 + lum * 0.85;
    }
    if ((uFlags & F_PAT) != 0) col *= 1.0 - 0.38 * pattern(o, p / (2.0 * uDpr));
    if (uStyle == 2) {
      float e = edge ? mix(1.0, onLine, zoomed) : 0.0;
      col = base * 0.16 + base * 1.7 * e;
      emit = max(emit, e);
    } else if (uStyle == 4) {
      col = mix(vec3(0.95, 0.92, 0.85), col, 0.52) * (0.88 + 0.12 * noise(p * 0.35));
      float hatch = step(0.5, fract((p.x + p.y) / (5.0 * uDpr)));
      col *= 1.0 - 0.06 * hatch;
      if (onLine > 0.5) col = vec3(0.07, 0.07, 0.09);
    } else if (uStyle == 3) {
      float w = noise(g * 0.07 + float(o) * 3.0) * 0.32 + noise(p * 0.04) * 0.14;
      col = mix(vec3(0.95, 0.92, 0.85), col, 0.5 + w);
      if (edge) col *= 0.7;
    } else if (edge) {
      col = mp ? col * 1.18 + 0.04 : col * 0.74;
      emit = max(emit, mp ? 0.7 : 0.0);
    }
  }
  if ((uFlags & F_HEAT) != 0) {
    float h = texture(uHeat, (g + 0.5) / uGrid).r;
    col = mix(col, inferno(h), smoothstep(0.02, 0.55, h) * 0.7);
  }
  outColor = vec4(col, emit);
}`;

export const BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
void main() {
  // Only emissive pixels (frontiers, fresh growth) feed the bloom: the
  // scene pass stores emission strength in alpha.
  vec4 a = texture(uSrc, vUv + uTexel * vec2(-1, -1)), b = texture(uSrc, vUv + uTexel * vec2(1, -1));
  vec4 c2 = texture(uSrc, vUv + uTexel * vec2(-1, 1)), d = texture(uSrc, vUv + uTexel * vec2(1, 1));
  vec3 c = (a.rgb * a.a + b.rgb * b.a + c2.rgb * c2.a + d.rgb * d.a) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.3, l + 0.3), 1.0);
}`;

export const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270;
  c += texture(uSrc, vUv + uDir * 1.3846153).rgb * 0.3162162;
  c += texture(uSrc, vUv - uDir * 1.3846153).rgb * 0.3162162;
  c += texture(uSrc, vUv + uDir * 3.2307692).rgb * 0.0702702;
  c += texture(uSrc, vUv - uDir * 3.2307692).rgb * 0.0702702;
  outColor = vec4(c, 1.0);
}`;

export const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform int uStyle;
uniform float uTime;
uniform vec2 uRes;
uniform float uSlow;
uniform float uVig;
uniform float uFlash;
in vec2 vUv;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  if (uStyle == 1) {
    vec2 cc = uv - 0.5;
    uv = 0.5 + cc * (1.0 + 0.11 * dot(cc, cc) * 4.0) * 0.965;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec3 col = texture(uScene, uv).rgb;
  if (uStyle == 1) {
    float ca = 1.6 / uRes.x;
    col.r = texture(uScene, uv + vec2(ca, 0.0)).r;
    col.b = texture(uScene, uv - vec2(ca, 0.0)).b;
  }
  col += texture(uBloom, uv).rgb * uBloomAmt;
  if (uStyle == 1) {
    col *= 0.78 + 0.22 * sin(uv.y * uRes.y * 1.25);
    col *= 0.92 + 0.08 * sin(uv.x * uRes.x * 2.0944);
    col *= 1.12;
  }
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * uVig;
  if (uSlow > 0.0) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(l) * vec3(1.02, 1.0, 1.12), uSlow * 0.5);
  }
  col += uFlash * 0.25;
  col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.018;
  outColor = vec4(col, 1.0);
}`;
