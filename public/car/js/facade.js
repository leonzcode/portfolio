// The walls' material: a MeshStandardMaterial whose fragment shader draws a facade from a few numbers a vertex
// carries (see buildings.js): floors, bays of windows with frames, a recess seen in parallax, glass that reflects
// the scene's environment (each pane a little differently), lit rooms and blinds, a ground floor of shop fronts,
// doors or lobbies, the wall's own material (brick, concrete, curtain wall, stucco, siding, metal, stone), and
// darkening near the ground. Every detail fades to its average once it is smaller than a few pixels.
// Each wall also carries its building's own window layout (aF, from buildings.js: bay width, window width and
// height, frame colour and a few features as bits), so no two streets share one template: shutters, stone
// surrounds, arched heads, fire escapes, half-timbering, ribbon windows, and terraces drawn as a row of houses each
// with its own paint and door.
import * as THREE from 'three';

// styles (aS.x) and ground floors (aS.y), shared with buildings.js
export const STYLE = { BRICK: 0, CONCRETE: 1, GLASS: 2, STUCCO: 3, WOOD: 4, METAL: 5, STONE: 6, SOFFIT: 8, ROOFING: 9 };
export const GROUND = { NONE: 0, SHOP: 1, DOOR: 2, LOBBY: 3, ROLLUP: 4, HOUSE: 5, HOUSE_FRONT: 6, HOUSE_GARAGE: 7 };
// aF.w bits: frame colour (0 the style's own, 1 white, 2 black, 3 wood) plus these
export const FBIT = { WHITE: 1, BLACK: 2, WOOD: 3, SHUTTERS: 4, FIRE: 8, SURROUND: 16, ARCH: 32, PLOTS: 64, RIBBON: 128, TIMBER: 256, PASTEL: 512, ONE: 1024, PLOT3: 2048, CROSS: 4096, BASE2: 8192, BASE1: 16384 };

const VERT_PARS = /* glsl */`
attribute vec3 aCol;
attribute vec4 aW;
attribute vec4 aB;
attribute vec3 aS;
attribute vec4 aF;
varying vec3 vCol;
varying vec4 vW;
varying vec4 vB;
varying vec3 vS;
varying vec4 vF;
varying vec3 vWPos;
varying vec3 vWNrm;
`;
const VERT = /* glsl */`
vCol = aCol; vW = aW; vB = aB; vS = aS; vF = aF;
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNrm = normalize( mat3( modelMatrix ) * objectNormal );
`;

const FRAG_PARS = /* glsl */`
varying vec3 vCol;
varying vec4 vW;
varying vec4 vB;
varying vec3 vS;
varying vec4 vF;
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNrm;

float fH( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float fNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fH( i ), fH( i + vec2( 1, 0 ) ), f.x ), mix( fH( i + vec2( 0, 1 ) ), fH( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// 1 inside [lo, hi] (2D), soft by aa
float fBox( vec2 p, vec2 lo, vec2 hi, float aa ) {
  vec2 a = smoothstep( lo - aa, lo + aa, p ) * ( 1.0 - smoothstep( hi - aa, hi + aa, p ) );
  return a.x * a.y;
}
float fBand( float x, float lo, float hi, float aa ) {
  return smoothstep( lo - aa, lo + aa, x ) * ( 1.0 - smoothstep( hi - aa, hi + aa, x ) );
}

vec3 fcCol; float fcRough; float fcMetal; vec3 fcEmit; vec2 fcJit; float fcAO; float fcArch;

// a lit screen's picture: made up, colourful, moving (never a real brand). One pattern without branches: a
// gradient or moving colour behind, rows of running text or a headline, a round shape, mixed by the screen's seed.
vec3 fScreen( vec2 q, float kind, float sd, float t, float asp ) {
  float ph = floor( t / 5.0 + sd );
  vec3 c1 = 0.5 + 0.5 * cos( 6.2832 * ( fH( vec2( sd, ph ) ) + vec3( 0.0, 0.33, 0.67 ) ) );
  vec3 c2 = 0.5 + 0.5 * cos( 6.2832 * ( fH( vec2( sd, 2.0 ) ) + vec3( 0.0, 0.33, 0.67 ) ) );
  vec2 r = q * vec2( asp, 1.0 );
  float f = sin( r.x * 3.2 + t * 0.9 ) + sin( r.y * 4.1 - t * 0.7 );
  float wv = step( 1.5, kind ) * step( kind, 2.5 );
  vec3 col = mix( mix( c1, c2, fract( q.x * 0.7 + q.y * 0.4 - t * 0.08 ) ), mix( c1, c2, 0.5 + 0.5 * sin( f * 1.6 ) ), wv );
  // running text rows (kind 1) or one headline (kind 0)
  float rows = kind > 0.5 && kind < 1.5 ? 5.0 : 1.0;
  float row = floor( q.y * rows ), ry = fract( q.y * rows );
  float x = r.x * 3.0 + t * 0.8 * ( mod( row, 2.0 ) * 2.0 - 1.0 ) * step( 1.5, rows );
  float ch = step( 0.35, fH( vec2( floor( x ), row + sd ) ) ) * mix( 1.0, step( 0.25, ry ) * step( ry, 0.75 ), step( 1.5, rows ) ) * step( 0.15, fract( x ) ) * step( fract( x ), 0.85 );
  ch *= step( kind, 1.5 ) * mix( step( 0.12, q.x ) * step( q.x, 0.88 ) * step( abs( q.y - 0.45 ), 0.14 ), 1.0, step( 1.5, rows ) );
  col = mix( col * mix( 1.0, 0.3, step( 1.5, rows ) ), vec3( 1.0 ), ch );
  // a big round shape (kind 3)
  float disc = step( 2.5, kind ) * step( length( ( q - vec2( 0.72, 0.5 ) ) * vec2( asp, 1.0 ) ), 0.32 );
  col = mix( mix( col, c1, step( 2.5, kind ) * step( q.x, 0.45 ) ), vec3( 1.0, 0.95, 0.85 ), disc );
  return col;
}

// One window (called once a fragment, so the compiler builds it once). p: metres from the window's centre across
// and from its floor up; hwid half width; sill and head heights; recess depth; Vw the view in the wall's frame;
// id the window's number; aa the pixel size (across, up); kind 1 for homes (transoms, curtains); lit the share of
// lit rooms. Returns 1 where the opening is, and sets the look there.
float fWindow( vec2 p, float hwid, float sill, float head, float depth, vec3 Vw, float id, vec2 aa, float kind, vec3 wallC, vec3 frameC, float lit ) {
  vec2 lo = vec2( -hwid, sill ), hi = vec2( hwid, head );
  vec2 oa = smoothstep( lo - aa, lo + aa, p ) * ( 1.0 - smoothstep( hi - aa, hi + aa, p ) );
  float open = oa.x * oa.y;
  // the glass plane is depth behind the wall: what is seen through this point of the opening
  vec2 g = p - Vw.xy * ( depth / max( Vw.z, 0.08 ) );
  vec2 ga = step( lo, g ) * step( g, hi );
  float onGlass = ga.x * ga.y;
  // a round head: the top of the opening is a half circle
  if ( fcArch > 0.5 ) {
    float cy = head - hwid;
    open *= 1.0 - step( cy, p.y ) * smoothstep( hwid - aa.x, hwid + aa.x, length( vec2( p.x, p.y - cy ) ) );
    onGlass *= 1.0 - step( cy, g.y ) * step( hwid, length( vec2( g.x, g.y - cy ) ) );
  }
  float fw = 0.07;
  vec2 fa = step( lo + fw, g ) * step( g, hi - fw );
  float frame = 1.0 - fa.x * fa.y;
  float wwid = 2.0 * hwid;
  frame = max( frame, step( 1.25, wwid ) * ( 1.0 - smoothstep( 0.03, 0.03 + aa.x, abs( g.x ) ) ) );
  frame = max( frame, min( kind, 1.0 ) * step( 1.3, head - sill ) * ( 1.0 - smoothstep( 0.025, 0.025 + aa.y, abs( g.y - ( sill + ( head - sill ) * ( kind > 2.5 ? 0.7 : kind > 1.5 ? 0.5 : 0.58 ) ) ) ) ) );
  // a casement's mullion down the middle (continental windows open in two leaves)
  if ( kind > 2.5 ) frame = max( frame, step( 0.7, wwid ) * ( 1.0 - smoothstep( 0.028, 0.028 + aa.x, abs( g.x ) ) ) );
  // sash windows: glazing bars, three panes across and two up in each sash
  if ( kind > 1.5 && kind < 2.5 ) {
    float lxg = ( g.x + hwid ) / max( 2.0 * hwid, 0.1 ), lyg = ( g.y - sill ) / max( head - sill, 0.1 );
    float bx = abs( fract( lxg * 3.0 + 0.5 ) - 0.5 ) / 3.0 * 2.0 * hwid, by = abs( fract( lyg * 4.0 + 0.5 ) - 0.5 ) / 4.0 * ( head - sill );
    frame = max( frame, ( 1.0 - smoothstep( 0.016, 0.016 + aa.x, bx ) ) + ( 1.0 - smoothstep( 0.016, 0.016 + aa.y, by ) ) );
  }
  float h = fH( vec2( id, id * 1.37 + 3.1 ) ), h2 = fH( vec2( id * 2.11, 7.7 ) );
  float ly = clamp( ( g.y - sill ) / max( head - sill, 0.1 ), 0.0, 1.0 );
  float lx = ( g.x + hwid ) / max( wwid, 0.1 );
  // glass: a dark room behind a reflective pane, tinted a little per window
  vec3 col = vec3( 0.11, 0.13, 0.145 ) * ( 0.7 + 0.6 * h2 );
  float rough = 0.04 + 0.06 * h2, metal = 0.6;
  vec3 emit = vec3( 0.0 );
  vec2 jit = ( vec2( h, h2 ) - 0.5 ) * 0.035;
  // a lit room
  float isLit = step( h, lit );
  emit = vec3( 1.0, 0.86, 0.66 ) * ( 0.10 + 0.12 * h2 ) * ( 0.6 + 0.4 * ly ) * isLit;
  metal = mix( metal, 0.45, isLit ); col *= mix( 1.0, 0.7, isLit );
  // blinds down to some height, or curtains drawn to the sides
  float isBl = ( 1.0 - isLit ) * step( h, lit + 0.22 ) * step( 0.75 - 0.75 * h2, ly );
  float side = ( 1.0 - smoothstep( 0.24, 0.28, lx ) ) + smoothstep( 0.72, 0.76, lx );
  float isCu = ( 1.0 - isLit ) * ( 1.0 - step( h, lit + 0.22 ) ) * step( h, lit + 0.45 ) * min( kind, 1.0 ) * step( 0.5, side );
  float slat = 0.85 + 0.15 * smoothstep( 0.3, 0.7, fract( g.y / 0.05 ) );
  vec3 blC = mix( vec3( 0.55, 0.53, 0.48 ), vec3( 0.62, 0.6, 0.58 ), h ) * mix( 1.0, slat, 1.0 - smoothstep( 0.006, 0.02, aa.y ) );
  vec3 cuC = mix( vec3( 0.7, 0.66, 0.58 ), vec3( 0.45, 0.32, 0.28 ), h2 ) * 0.8;
  float soft = max( isBl, isCu );
  col = mix( mix( col, blC, isBl ), cuC, isCu );
  rough = mix( rough, mix( 0.75, 0.9, isCu ), soft ); metal *= 1.0 - soft; jit *= 1.0 - soft;
  // interior depth: darker towards the top of the opening
  col *= mix( 0.8 + 0.25 * ( 1.0 - ly ), 1.0, soft );
  // the frame, then the reveal (the side of the recess)
  float fr = step( 0.5, frame );
  col = mix( col, frameC, fr ); rough = mix( rough, 0.5, fr ); metal *= 1.0 - fr; emit *= 1.0 - fr; jit *= 1.0 - fr;
  float rv = 1.0 - onGlass;
  col = mix( col, wallC * 0.62, rv ); rough = mix( rough, 0.9, rv ); metal *= 1.0 - rv; emit *= 1.0 - rv; jit *= 1.0 - rv;
  fcCol = mix( fcCol, col, open ); fcRough = mix( fcRough, rough, open ); fcMetal = mix( fcMetal, metal, open );
  fcEmit = mix( fcEmit, emit, open ); fcJit = mix( fcJit, jit, open );
  return open;
}

void facade() {
  float u = vW.x, L = vW.y, eave = vW.z, gy = vW.w;
  // seed is a whole number per building: rounded here, because a hash of an interpolated value differs from
  // pixel to pixel by the interpolation's rounding, which showed as white speckles over windows
  float base = vB.x, fh = vB.y, gh = vB.z, seed = floor( vB.w + 0.5 );
  float style = floor( vS.x + 0.5 ), gk = floor( vS.y + 0.5 );
  float lk = floor( vS.z + 0.5 ), flag = floor( lk / 10.0 + 0.01 ), look = lk - flag * 10.0;
  vec3 N = normalize( vWNrm );
  vec3 T = normalize( vec3( N.z, 0.0, -N.x ) );
  float y = vWPos.y;
  float v = y - base;
  float above = y - gy;
  vec3 wall = vCol;
  // screen-space sizes first, while every pixel of the quad still runs the same code; across (u) and up (v)
  // apart, so a wall seen edge-on keeps its rows of windows
  float pxu = clamp( fwidth( u ), 1e-4, 50.0 ) * 0.75, pxv = clamp( fwidth( v ), 1e-4, 50.0 ) * 0.75;
  float px = max( pxu, pxv );
  vec2 aa = vec2( pxu, pxv );
  fcCol = wall; fcRough = 0.88; fcMetal = 0.0; fcEmit = vec3( 0.0 ); fcJit = vec2( 0.0 ); fcArch = 0.0;
  fcAO = mix( 0.5, 1.0, smoothstep( -0.2, 2.2, above ) );
  // roofing (porch roofs, a dormer's cheeks, a water tower's cone): rows of shingles or tiles in the given colour
  if ( style > 8.5 ) { fcCol = wall * mix( 1.0, 0.8 + 0.2 * smoothstep( 0.0, 0.3, fract( y / 0.2 ) ), 1.0 - smoothstep( 0.01, 0.04, pxv ) ); fcRough = 0.8; fcAO = 1.0; return; }
  if ( style > 7.5 ) { fcCol = wall * 0.55; return; }
  vec3 V = normalize( cameraPosition - vWPos );
  vec3 Vw = vec3( dot( V, T ), V.y, dot( V, N ) );
  bool glass = style == 2.0;
  bool house = gk > 4.5;
  // the building's own layout (buildings.js): bits for features, and the bay layout before the wall's surface, so a
  // terrace's houses can each take their own paint
  float fBits = floor( vF.w + 0.5 );
  float bFrame = mod( fBits, 4.0 ), bShut = mod( floor( fBits / 4.0 ), 2.0 ), bFire = mod( floor( fBits / 8.0 ), 2.0 );
  float bSurr = mod( floor( fBits / 16.0 ), 2.0 ), bArch = mod( floor( fBits / 32.0 ), 2.0 ), bPlot = mod( floor( fBits / 64.0 ), 2.0 );
  float bRib = mod( floor( fBits / 128.0 ), 2.0 ), bTimber = mod( floor( fBits / 256.0 ), 2.0 ), bPastel = mod( floor( fBits / 512.0 ), 2.0 );
  float bOne = mod( floor( fBits / 1024.0 ), 2.0 ), plotBays = mod( floor( fBits / 2048.0 ), 2.0 ) > 0.5 ? 3.0 : 2.0;
  float sv = fH( vec2( seed * 13.0, 1.0 ) ), sv2 = fH( vec2( seed * 7.0, 2.0 ) );
  float bay0 = style == 0.0 ? 2.6 : style == 2.0 ? 1.5 : style == 4.0 ? 3.4 : style == 5.0 ? 6.0 : style == 3.0 ? ( house ? 3.3 : 3.0 ) : style == 1.0 ? 3.0 : 3.2;
  if ( look == 1.0 ) bay0 = 2.5; else if ( look == 2.0 ) bay0 = 2.4; else if ( look == 3.0 ) bay0 = 1.9; else if ( look == 4.0 ) bay0 = 3.2; else if ( look == 5.0 ) bay0 = 2.2;
  float bayW = vF.x > 0.0 ? vF.x : bay0 * ( 0.88 + 0.24 * sv2 );
  float margin = bOne > 0.5 ? L * 0.12 : min( 0.7, L * 0.08 );
  float span = L - 2.0 * margin;
  float nb = bOne > 0.5 ? 1.0 : max( 1.0, floor( span / bayW + 0.5 ) );
  if ( bPlot > 0.5 ) nb = max( plotBays, floor( span / bayW / plotBays + 0.5 ) * plotBays );
  float bw = span / nb;
  float bx = ( u - margin ) / bw;
  float bi = floor( bx );
  float plotI = 0.0, plotH = 0.0, plotH2 = 0.0;
  if ( bPlot > 0.5 ) { plotI = floor( bi / plotBays ); plotH = fH( vec2( plotI + seed * 0.37, 19.0 ) ); plotH2 = fH( vec2( plotI * 1.7 + seed, 23.0 ) ); }
  // a brick front over a stucco base two floors high (London's terraces): the base takes the paint, the brick its own
  float bBase = mod( floor( fBits / 8192.0 ), 2.0 );
  // (BASE1: the ground floor alone, a London terrace's painted stucco under its stock brick)
  bool onBase = ( bBase > 0.5 && v < gh + fh - 0.05 ) || ( mod( floor( fBits / 16384.0 ), 2.0 ) > 0.5 && v < gh - 0.05 );
  if ( onBase ) wall = vec3( 0.57, 0.56, 0.53 );
  if ( bPlot > 0.5 && ( bBase < 0.5 || onBase ) ) {
    // each house of the row its own: a pastel, a cream or a white (stucco), or its brick a little lighter or darker
    if ( bPastel > 0.5 ) {
      vec3 pc = 0.5 + 0.5 * cos( 6.2832 * ( plotH + vec3( 0.0, 0.33, 0.67 ) ) );
      vec3 paint = plotH2 < 0.3 ? vec3( 0.58, 0.57, 0.54 ) : plotH2 < 0.42 ? vec3( 0.56, 0.52, 0.42 ) : mix( vec3( 0.6 ), pc * 0.62, 0.42 );
      wall = mix( wall, paint, 0.85 );
    } else wall *= 0.86 + 0.28 * plotH;
  }

  // ---------- far walls ----------
  // Past 100 m (a screen past 320 m): plain rows of windows in the building's own layout, no grain of the brick or
  // the panels, no recess, no glazing bars, no reflections of their own. Most of a dense core's walls are this far,
  // and every fragment of them is shaded whether it is seen or not (the log depth buffer has no early depth test).
  float camD = length( cameraPosition - vWPos );
  if ( camD > ( flag == 1.0 || flag == 2.0 ? 320.0 : 100.0 ) ) {
    float grimeF = fNoise( vec2( u * 0.35, v * 0.9 ) + seed * 0.731 );
    vec3 surfF = wall * ( 0.94 + 0.16 * grimeF );
    surfF *= mix( 1.0, 0.82, fBand( eave - v, 0.0, 0.35, pxv ) );
    if ( house ) surfF = mix( surfF, vec3( 0.3, 0.29, 0.27 ), 1.0 - smoothstep( 0.42 - pxv, 0.42 + pxv, v ) );
    fcCol = surfF;
    if ( flag == 1.0 || flag == 2.0 ) {
      // a far screen: one colour of its picture, still lit
      if ( v > 4.2 && v < min( eave - 0.8, 48.0 ) ) {
        vec3 c = 0.5 + 0.5 * cos( 6.2832 * ( fH( vec2( seed, floor( uTime / 5.0 + seed ) ) ) + vec3( 0.0, 0.33, 0.67 ) ) ); c *= c;
        fcCol = c * 0.1; fcEmit = c * 0.7; fcRough = 0.3; fcAO = 1.0; return;
      }
    }
    if ( L < 2.2 || v > eave - 0.25 ) return;
    if ( glass ) {
      vec3 tint = mix( mix( vec3( 0.20, 0.27, 0.31 ), vec3( 0.27, 0.29, 0.30 ), sv ), wall * 1.1, 0.55 ) * ( 0.8 + 0.3 * sv2 );
      float slabF = step( 0.3, sv2 ) * fBand( fract( ( v - gh ) / fh ) * fh, fh - 0.95, fh, pxv );
      fcCol = mix( tint, tint * 0.5, slabF ); fcRough = 0.18; fcMetal = 0.42; return;
    }
    float wwF = vF.y > 0.0 ? vF.y : ( style == 1.0 ? ( sv > 0.55 ? 0.94 : 0.62 ) : style == 5.0 ? 0.5 : look == 3.0 ? 0.58 : 0.44 );
    float whF = vF.z > 0.0 ? min( vF.z, 0.92 ) : 0.55;
    if ( bRib > 0.5 ) wwF = 0.985;
    float inB = step( 0.0, bx ) * step( bx, nb ), aaF = max( pxu, pxv );
    float flF = v < gh ? -1.0 : floor( ( v - gh ) / fh );
    float lyF = fract( ( v - gh ) / fh ) * fh, sillF = ( fh - whF * fh ) * 0.62;
    float wxF = ( fract( bx ) - 0.5 ) * bw;
    float win = inB * step( gh, v ) * fBox( vec2( wxF, lyF ), vec2( -wwF * bw * 0.5, sillF ), vec2( wwF * bw * 0.5, sillF + whF * fh ), aaF );
    win *= step( v - lyF + sillF + whF * fh, eave - 0.25 );
    // the ground floor of shops and lobbies: glass between piers
    if ( v < gh && ( gk == 1.0 || gk == 3.0 ) ) win = inB * fBox( vec2( wxF, v ), vec2( -bw * 0.5 + 0.22, 0.3 ), vec2( bw * 0.5 - 0.22, gh - ( gk == 1.0 ? 1.05 : 0.45 ) ), aaF );
    else if ( v < gh && house ) win = 0.0;
    float hwF = fH( vec2( bi * 31.0 + flF * 7.0 + seed * 11.0, 4.1 ) );
    vec3 gcol = mix( vec3( 0.12, 0.14, 0.16 ) * ( 0.8 + 0.4 * hwF ), vec3( 0.5, 0.48, 0.44 ), 0.4 * step( 0.06, hwF ) * step( hwF, 0.28 ) );
    fcCol = mix( fcCol, gcol, win ); fcRough = mix( 0.88, 0.12, win ); fcMetal = 0.55 * win;
    fcEmit = vec3( 1.0, 0.86, 0.66 ) * 0.15 * step( hwF, 0.06 ) * win;
    // a shop's sign band over its window, in the near path's colours
    if ( v < gh && gk == 1.0 ) {
      float sgn = fBand( v, gh - 0.95, gh - 0.3, pxv ) * fBand( wxF, -bw * 0.5 + 0.22, bw * 0.5 - 0.22, pxu ) * inB;
      float widS = bi * 17.0 + seed * 59.0, hs = fH( vec2( widS, 9.0 ) );
      vec3 sc = hs < 0.5 ? vec3( 0.08, 0.08, 0.09 ) : mix( vec3( 0.55, 0.12, 0.1 ), vec3( 0.12, 0.25, 0.4 ), fH( vec2( widS, 4.0 ) ) );
      if ( hs > 0.85 ) sc = vec3( 0.75, 0.7, 0.6 );
      fcCol = mix( fcCol, sc, sgn );
    }
    // half-timbering: its posts at the bays' edges and its beams at the floors
    if ( bTimber > 0.5 && v > gh - 0.1 ) {
      float tb = max( 1.0 - smoothstep( 0.09, 0.09 + pxu, abs( abs( wxF ) - bw * 0.5 ) ), 1.0 - smoothstep( 0.1, 0.1 + pxv, min( lyF, fh - lyF ) ) );
      fcCol = mix( fcCol, vec3( 0.11, 0.065, 0.04 ), tb * ( 1.0 - win ) );
    }
    // Haussmann's long balconies, a dark line along their floors
    if ( look == 1.0 && ( abs( flF - 1.0 ) < 0.5 || abs( flF - 4.0 ) < 0.5 ) ) fcCol = mix( fcCol, vec3( 0.05 ), 0.6 * fBand( lyF, 0.0, 0.95, pxv ) * ( 1.0 - win * 0.5 ) );
    return;
  }

  // ---------- the wall's own surface ----------
  // (one octave of grain: the second, a fine streak, cost a sixth of a near wall's fragment and hardly showed)
  float grime = fNoise( vec2( u * 0.35, v * 0.9 ) + seed * 0.731 ) * 0.8 + 0.1;
  vec3 surf = wall * ( 0.9 + 0.16 * grime );
  float fine = 1.0 - smoothstep( 0.008, 0.03, px );
  float mid = 1.0 - smoothstep( 0.015, 0.05, px );
  if ( onBase ) {
    // (smooth stucco, with a band at the top)
    surf *= mix( 1.0, 0.82, fBand( v, gh + fh - 0.35, gh + fh - 0.05, pxv ) );
  } else if ( style == 0.0 || style == 6.0 ) {
    // brick in stretcher bond, or ashlar stone
    vec2 sz = style == 0.0 ? vec2( 0.225, 0.075 ) : vec2( 0.75, 0.38 );
    float jt = style == 0.0 ? 0.011 : 0.008;
    float row = floor( v / sz.y );
    float bu = u / sz.x + 0.5 * mod( row, 2.0 );
    vec2 bl = vec2( fract( bu ) * sz.x, fract( v / sz.y ) * sz.y );
    vec2 ba = smoothstep( vec2( jt ) - px * 0.5, vec2( jt ) + px * 0.5, bl ) * ( 1.0 - smoothstep( sz - jt - px * 0.5, sz - jt + px * 0.5, bl ) );
    float brick = ba.x * ba.y;
    float vary = fH( vec2( floor( bu ), row ) + seed );
    vec3 bc = wall * ( style == 0.0 ? 0.82 + 0.34 * vary : 0.9 + 0.18 * vary );
    vec3 mortar = style == 0.0 ? vec3( 0.62, 0.6, 0.56 ) * ( 0.8 + 0.2 * grime ) : wall * 0.75;
    // Japanese tile cladding: fine joints in the tile's own colour
    if ( floor( vS.z + 0.5 ) == 3.0 ) { mortar = wall * 1.06; bc = wall * ( 0.94 + 0.1 * vary ); }
    surf = mix( wall * ( 0.86 + 0.16 * grime ) * 0.97, mix( mortar, bc, brick ), style == 0.0 ? fine : mid );
  } else if ( style == 1.0 ) {
    // concrete panels: a joint at each floor and every few metres
    float j = max( 1.0 - smoothstep( 0.0, 0.02 + pxv, abs( fract( ( v - gh ) / fh + 0.5 ) - 0.5 ) * fh ),
                   1.0 - smoothstep( 0.0, 0.015 + pxu, abs( fract( u / 3.0 + 0.5 ) - 0.5 ) * 3.0 ) );
    surf *= 1.0 - 0.18 * j * ( 1.0 - smoothstep( 0.02, 0.08, px ) );
  } else if ( style == 4.0 ) {
    // lap siding: a shadow line under each board
    surf *= mix( 1.0, 0.72 + 0.28 * smoothstep( 0.0, 0.18, fract( v / 0.19 ) ), 1.0 - smoothstep( 0.01, 0.03, pxv ) );
  } else if ( style == 5.0 ) {
    // ribbed metal
    surf *= mix( 1.0, 0.85 + 0.1 + 0.1 * cos( u / 0.2 * 6.2832 ), 1.0 - smoothstep( 0.015, 0.05, pxu ) );
    fcRough = 0.6;
  }
  // a darker plinth near the ground (a concrete base course on houses), a cornice under a flat roof's edge
  float plinth = 1.0 - smoothstep( 0.42 - pxv, 0.42 + pxv, v );
  if ( house ) surf = mix( surf, vec3( 0.3, 0.29, 0.27 ) * ( 0.9 + 0.2 * grime ), plinth );
  else if ( gk > 0.5 && !glass ) surf *= mix( 1.0, 0.78, plinth );
  surf *= mix( 1.0, 0.82, fBand( eave - v, 0.0, 0.35, pxv ) );
  surf *= mix( 1.0, 1.08, fBand( eave - v, 0.35, 0.6, pxv ) );
  if ( look == 4.0 && v > gh + 0.05 ) {
    // a chalet's upper floors: dark vertical boards
    float bdi = floor( u / 0.17 );
    vec3 wood = vec3( 0.13, 0.075, 0.04 ) * ( 0.8 + 0.4 * fH( vec2( bdi, seed ) ) ) * ( 0.9 + 0.2 * grime );
    surf = mix( wood, wood * 0.55, ( 1.0 - smoothstep( 0.0, 0.012 + pxu, abs( fract( u / 0.17 + 0.5 ) - 0.5 ) * 0.17 ) ) * ( 1.0 - smoothstep( 0.01, 0.04, pxu ) ) );
  }
  // half-timbering (old German towns): dark timbers over a light infill, on the floors above the ground floor
  if ( bTimber > 0.5 && v > gh - 0.1 && v < eave ) {
    float tw = 0.09 + pxu;
    float fl = fract( ( v - gh ) / fh ) * fh;
    float wxT = ( fract( bx ) - 0.5 ) * bw;
    float post = 1.0 - smoothstep( tw - pxu, tw + pxu, abs( abs( wxT ) - bw * 0.5 ) );
    post = max( post, 1.0 - smoothstep( tw - pxu, tw + pxu, abs( abs( wxT ) - bw * 0.25 ) ) );
    float beam = 1.0 - smoothstep( 0.1 - pxv, 0.1 + pxv, min( fl, fh - fl ) );
    beam = max( beam, 1.0 - smoothstep( 0.07 - pxv, 0.07 + pxv, abs( fl - 0.85 ) ) );
    // braces: diagonals from the posts in the bay's outer quarters
    float q = abs( wxT ) - bw * 0.25, dg = abs( q - ( fl - 0.85 ) * bw * 0.25 / max( 0.5, fh - 0.85 ) );
    float brace = step( 0.0, q ) * step( 0.85, fl ) * ( 1.0 - smoothstep( tw * 0.8 - pxu, tw * 0.8 + pxu, dg ) ) * step( 0.5, fH( vec2( floor( bx ) + seed, floor( ( v - gh ) / fh ) ) ) );
    float timber = max( max( post, beam ), brace ) * ( 1.0 - smoothstep( 0.03, 0.08, px ) * 0.6 );
    vec3 tc = mix( vec3( 0.11, 0.065, 0.04 ), vec3( 0.2, 0.07, 0.045 ), step( 0.6, sv ) );
    surf = mix( surf, tc * ( 0.85 + 0.3 * grime ), timber );
  }
  fcCol = surf;
#ifndef FACADE_NO_SCREENS
  // lit screens over the street fronts of a commercial core (Times Square, Shibuya, Piccadilly)
  // each screen 9 to 18 m across, somewhere along the wall (flag 1), or the whole front (flag 2, Times Square)
  float pw = flag == 2.0 ? L - 1.0 : min( L - 1.0, 9.0 + 9.0 * fH( vec2( seed, 41.0 ) ) ), u0 = flag == 2.0 ? 0.5 : 0.5 + ( L - 1.0 - pw ) * fH( vec2( seed, 43.0 ) );
  if ( ( flag == 1.0 || flag == 2.0 ) && v > 4.2 && v < min( eave - 0.8, 48.0 ) && u > u0 && u < u0 + pw ) {
    float ph = 6.0 + 6.0 * fH( vec2( seed, 31.0 ) ), gap = 0.7;
    float pv = v - 4.2, pi = floor( pv / ( ph + gap ) ), py = pv - pi * ( ph + gap );
    if ( py < ph && pi < 3.0 && fH( vec2( seed + pi, 17.0 ) ) < ( flag == 2.0 ? 0.85 : 0.75 ) ) {
      vec2 q = vec2( ( u - u0 ) / pw, py / ph );
      float sd = seed * 3.0 + pi * 11.0 + floor( u / 40.0 );
      vec3 c = fScreen( q, floor( fH( vec2( sd, 3.0 ) ) * 4.0 ), sd, uTime, pw / ph );
      float edge = step( min( min( u - u0, u0 + pw - u ), min( py, ph - py ) ), 0.12 );
      c = mix( c, vec3( 0.02 ), edge );
      c = c * c * ( 0.6 + 0.6 * max( max( c.r, c.g ), c.b ) );   // vivid, as screens are, not pastel
      fcCol = c * 0.1; fcEmit = c * ( 0.85 + 0.35 * sv ) * ( 1.0 - edge ); fcRough = 0.3; fcMetal = 0.0; fcJit = vec2( 0.0 ); fcAO = 1.0;
      return;
    }
  }
  // a vertical sign down a narrow Japanese front: letters stacked in lit boxes
  if ( flag == 3.0 ) {
    float sh = min( eave - 1.0 - gh - 0.4, 14.0 );
    vec2 q = vec2( u / L, v - gh - 0.4 );
    {
      float hc = fH( vec2( seed, 9.0 ) );
      vec3 bg = hc < 0.25 ? vec3( 0.8, 0.07, 0.05 ) : hc < 0.45 ? vec3( 0.95, 0.78, 0.1 ) : hc < 0.65 ? vec3( 0.92, 0.92, 0.9 ) : hc < 0.82 ? vec3( 0.08, 0.22, 0.7 ) : vec3( 0.08, 0.5, 0.25 );
      vec3 fg = hc >= 0.45 && hc < 0.65 ? vec3( 0.75, 0.05, 0.05 ) : ( hc >= 0.25 && hc < 0.45 ? vec3( 0.05 ) : vec3( 1.0 ) );
      float row = floor( q.y / 0.9 ); vec2 c = vec2( q.x, fract( q.y / 0.9 ) );
      float a1 = fH( vec2( row, seed + 1.0 ) ), a2 = fH( vec2( row, seed + 2.0 ) ), a3 = fH( vec2( row, seed + 3.0 ) );
      float gl = step( 0.2, c.x ) * step( c.x, 0.8 ) * step( abs( c.y - ( 0.25 + 0.5 * a1 ) ), 0.06 );
      gl = max( gl, step( 0.15, c.y ) * step( c.y, 0.85 ) * step( abs( c.x - ( 0.3 + 0.4 * a2 ) ), 0.06 ) );
      gl = max( gl, step( 0.5, a3 ) * step( 0.25, c.x ) * step( c.x, 0.75 ) * step( abs( c.y - 0.8 + 0.6 * a1 ), 0.05 ) );
      float edge = step( min( min( q.x, 1.0 - q.x ), min( q.y, sh - q.y ) ), 0.05 );
      vec3 col = mix( mix( bg, fg, gl ), vec3( 0.05 ), edge );
      fcCol = col * 0.3; fcEmit = col * 1.2 * ( 1.0 - edge ); fcRough = 0.35; fcMetal = 0.0; fcJit = vec2( 0.0 );
      return;
    }
  }

  // ---------- the window grid ----------
#endif
  if ( L < ( look == 5.0 || bOne > 0.5 ? 0.9 : 2.2 ) || v > eave - 0.25 ) return;
  // per style: bay width, window width share, sill, head, recess, lit share, homes, frame colour
  vec4 P1 = vec4( 3.0, 0.48, 0.85, fh - 0.75 );   // bay, ww, sill, head
  vec3 P2 = vec3( 0.14, 0.06, 0.0 );              // depth, lit, kind
  vec3 frameC = vec3( 0.16, 0.17, 0.18 );
  if ( style == 0.0 ) { P1 = vec4( 2.6, 0.46, 0.8, fh - 0.55 ); P2 = vec3( 0.18, 0.06, 1.0 ); frameC = sv > 0.45 ? vec3( 0.86, 0.85, 0.82 ) : vec3( 0.12 ); }
  else if ( style == 1.0 ) { P1 = vec4( 3.0, sv > 0.55 ? 0.94 : 0.62, 0.9, fh - 0.6 ); P2 = vec3( 0.12, 0.06, 0.0 ); frameC = vec3( 0.32, 0.34, 0.36 ); }
  else if ( style == 2.0 ) { P1.x = 1.5; }
  else if ( style == 3.0 ) { P1 = vec4( house ? 3.3 : 3.0, house ? 0.46 : 0.42, 0.9, fh - 0.7 ); P2 = vec3( 0.12, 0.06, 1.0 ); frameC = vec3( 0.86, 0.86, 0.84 ); }
  else if ( style == 4.0 ) { P1 = vec4( 3.4, house ? 0.42 : 0.32, 0.9, fh - 0.75 ); P2 = vec3( 0.08, 0.06, 1.0 ); frameC = vec3( 0.88, 0.88, 0.85 ); }
  else if ( style == 5.0 ) { P1 = vec4( 6.0, 0.5, fh - 1.3, fh - 0.4 ); P2 = vec3( 0.05, 0.02, 0.0 ); }
  else { P1 = vec4( 3.2, 0.4, 0.7, fh - 0.45 ); P2 = vec3( 0.22, 0.06, 1.0 ); frameC = vec3( 0.18, 0.17, 0.16 ); }
  if ( look == 1.0 ) { P1 = vec4( 2.5, 0.44, 0.12, fh - 0.4 ); P2 = vec3( 0.2, 0.06, 1.0 ); frameC = vec3( 0.7, 0.68, 0.64 ); }
  else if ( look == 2.0 ) { P1 = vec4( 2.4, 0.4, 0.7, fh - 0.45 ); P2 = vec3( 0.16, 0.06, 2.0 ); frameC = vec3( 0.88, 0.88, 0.86 ); }
  else if ( look == 3.0 ) { P1 = vec4( 1.9, 0.58, 0.85, fh - 0.5 ); P2 = vec3( 0.1, 0.12, 0.0 ); frameC = vec3( 0.42, 0.44, 0.45 ); }
  else if ( look == 4.0 ) { P1 = vec4( 3.2, 0.36, 0.9, fh - 0.75 ); P2 = vec3( 0.14, 0.05, 1.0 ); frameC = vec3( 0.9, 0.89, 0.86 ); }
  else if ( look == 5.0 ) { P1 = vec4( 2.2, 0.62, 0.8, fh - 0.5 ); P2 = vec3( 0.12, 0.06, 1.0 ); frameC = vec3( 0.92, 0.92, 0.9 ); }
  // the building's own window: its width and its height in the floor, and its frames
  if ( vF.y > 0.0 ) P1.y = vF.y;
  if ( vF.z > 0.0 ) { float wh = min( vF.z, 0.92 ) * fh; P1.z = max( 0.08, ( fh - wh ) * 0.62 ); P1.w = P1.z + wh; }
  if ( bFrame > 0.5 ) frameC = bFrame < 1.5 ? vec3( 0.88, 0.88, 0.86 ) : bFrame < 2.5 ? vec3( 0.06, 0.06, 0.065 ) : vec3( 0.3, 0.19, 0.11 );
  if ( bRib > 0.5 ) { P1.y = 0.985; P2.x = 0.06; }
  if ( mod( floor( fBits / 4096.0 ), 2.0 ) > 0.5 ) P2.z = 3.0;
  fcArch = bArch;
  float ww = P1.y, sill = P1.z, head = P1.w;
  float inBays = step( 0.0, bx ) * step( bx, nb );
  float wx = ( fract( bx ) - 0.5 ) * bw;
  // detail size on screen: bays too narrow fade to rows, rows too thin fade to the average
  float lodU = smoothstep( 0.16, 0.42, pxu / bw ), lodV = smoothstep( 0.16, 0.42, pxv / fh );
  float topV = eave - 0.55;
  // floors
  float fi = v < gh ? -1.0 : floor( ( v - gh ) / fh );
  float ly = v < gh ? v - max( 0.0, gh - fh ) : fract( ( v - gh ) / fh ) * fh;

  if ( glass ) {
    // curtain wall: panes between mullions, a spandrel at each slab; the building's own colour in the glass
    vec3 tint = mix( mix( vec3( 0.20, 0.27, 0.31 ), vec3( 0.27, 0.29, 0.30 ), sv ), wall * 1.1, 0.55 ) * ( 0.8 + 0.3 * sv2 );
    if ( v < gh ) ly = v;
    float id = bi * 31.0 + fi * 7.0 + seed * 11.0;
    float hp = fH( vec2( id, 0.5 ) ), hf = fH( vec2( fi + seed * 17.0, 3.5 ) );
    float mullV = ( 1.0 - smoothstep( 0.035, 0.035 + pxu, abs( wx ) - bw * 0.5 + 0.035 ) ) * ( 1.0 - lodU );
    float slab = 1.0 - smoothstep( 0.04, 0.04 + pxv, min( ly, fh - ly ) );
    float spand = v < gh ? 0.0 : fBand( ly, fh - 0.95, fh, pxv ) * step( 0.3, sv2 );
    slab = mix( slab, 0.16 / fh, lodV );
    spand = mix( spand, 0.95 / fh * step( 0.3, sv2 ), lodV );
    // the rooms behind: blinds down in some panes, a darker ceiling band at the top of each floor
    float hb = fH( vec2( id, 6.5 ) );
    float blinds = step( hb, 0.18 ) * step( fh * ( 0.2 + 0.5 * hb / 0.18 ), ly ) * ( 1.0 - lodU ) * ( 1.0 - spand );
    float ceil = fBand( ly, fh - 1.35, fh - 0.95, pxv ) * ( 1.0 - step( 0.3, sv2 ) ) * ( 1.0 - lodV );
    vec3 gc = tint * ( 0.72 + 0.56 * mix( hp, hf, lodU ) );
    vec3 mc = mix( vec3( 0.55, 0.58, 0.6 ), vec3( 0.12, 0.13, 0.14 ), step( 0.5, sv ) );
    float mull = max( mullV, slab );
    float lit2 = step( hp, 0.05 ) * ( 1.0 - spand ) * ( 1.0 - lodU );
    vec3 gl = mix( gc * mix( 1.0, 0.6, ceil ), vec3( 0.52, 0.5, 0.46 ), blinds );
    fcCol = mix( mix( gl, tint * 0.5, spand ), mc, mull );
    fcRough = mix( mix( mix( 0.1 + 0.14 * hp, 0.7, blinds ), 0.5, mull ), 0.2, lodU * 0.5 );
    fcMetal = mix( 0.42 * ( 1.0 - blinds ), 0.2, mull );
    fcEmit = vec3( 1.0, 0.92, 0.8 ) * 0.12 * lit2 * ( 1.0 - mull );
    fcJit = ( vec2( mix( hp, hf, lodU ), fH( vec2( id, 2.5 ) ) ) - 0.5 ) * 0.03 * ( 1.0 - mull );
    return;
  }
  if ( lodV > 0.985 ) {
    // far: the grid's average, without working out a single window
    float cov = ww * ( head - sill ) / fh * step( gh, v ) * inBays;
    fcCol = mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ); fcRough = mix( 0.88, 0.15, cov ); fcMetal = 0.6 * cov;
    return;
  }

  // ---------- one window for this fragment: which, and how ----------
  vec2 wp = vec2( wx, ly );
  float whw = ww * bw * 0.5, wsill = sill, whead = head, wdep = P2.x, wid = bi * 31.0 + fi * 7.0 + seed * 11.0, wlit = P2.y, wkind = P2.z;
  float on = inBays;
  float shop = 0.0, sign = 0.0;
  vec3 signC = vec3( 0.0 ), wfr = frameC;
  float doorBay = floor( fH( vec2( seed * 3.0, 5.0 ) ) * nb );
  // a terrace: a door in each house, at one end of it
  if ( bPlot > 0.5 ) doorBay = plotI * plotBays + ( plotH2 < 0.5 ? 0.0 : plotBays - 1.0 );
  if ( v < gh && gk > 0.5 && gk < 4.5 ) {
    if ( gk == 1.0 || gk == 3.0 ) {
      // shop fronts or a lobby: big glass between piers, a sign band over the shops
      float pier = 0.22;
      wp = vec2( wx, v ); whw = bw * 0.5 - pier;
      whead = gk == 1.0 ? gh - 1.05 : gh - 0.45;
      wsill = bi == doorBay ? 0.02 : ( gk == 1.0 ? 0.45 : 0.08 );
      wdep = 0.08; wid = bi * 17.0 + seed * 59.0; wlit = 0.35; wkind = 0.0; wfr = vec3( 0.13, 0.13, 0.14 ); shop = 1.0;
      if ( gk == 1.0 ) {
        sign = fBand( v, gh - 0.95, gh - 0.3, pxv ) * fBand( wx, -bw * 0.5 + pier, bw * 0.5 - pier, pxu ) * inBays;
        float hs = fH( vec2( wid, 9.0 ) );
        signC = hs < 0.5 ? vec3( 0.08, 0.08, 0.09 ) : mix( vec3( 0.55, 0.12, 0.1 ), vec3( 0.12, 0.25, 0.4 ), fH( vec2( wid, 4.0 ) ) );
        if ( hs > 0.85 ) signC = vec3( 0.75, 0.7, 0.6 );
      }
    } else if ( gk == 2.0 ) {
      // a front door in one bay, windows in the others
      if ( bi == doorBay ) {
        float d = fBox( vec2( wx, v ), vec2( -0.5, 0.0 ), vec2( 0.5, 2.15 ), px ) * inBays;
        vec3 dc = mix( vec3( 0.28, 0.17, 0.1 ), mix( vec3( 0.1, 0.18, 0.3 ), vec3( 0.45, 0.08, 0.06 ), sv ), step( 0.5, sv2 ) );
        float fr = 1.0 - fBox( vec2( wx, v ), vec2( -0.42, 0.0 ), vec2( 0.42, 2.07 ), px );
        fcCol = mix( fcCol, mix( dc, frameC, fr ), d * ( 1.0 - lodU ) );
        fcRough = mix( fcRough, 0.55, d );
        on = 0.0;
      }
    } else {
      // roll-up doors in every other bay
      if ( mod( bi, 2.0 ) < 0.5 ) {
        float d = fBox( vec2( wx, v ), vec2( -min( 1.8, bw * 0.4 ), 0.0 ), vec2( min( 1.8, bw * 0.4 ), min( 4.0, gh - 0.6 ) ), px ) * inBays;
        float rib = 0.85 + 0.15 * smoothstep( 0.2, 0.8, fract( v / 0.12 ) );
        fcCol = mix( fcCol, vec3( 0.5, 0.52, 0.53 ) * mix( rib, 0.93, lodU ), d );
      }
      on = 0.0;
    }
  }
  if ( house && gk > 5.5 && v < fh ) {
    // a house's front: a door, and a garage door at one end when there is one; no window where they are
    float gwid = gk > 6.5 && bPlot < 0.5 ? ( L > 16.0 && sv2 > 0.45 ? 5.0 : 2.7 ) : 0.0;
    float g0 = sv < 0.5 ? 0.7 : L - 0.7 - gwid;
    float dc = gwid > 0.0 ? ( sv < 0.5 ? ( g0 + gwid + L ) * 0.5 : g0 * 0.5 ) : L * ( 0.35 + 0.3 * sv2 );
    if ( bPlot > 0.5 ) dc = margin + ( doorBay + 0.5 ) * bw;
    float uc = margin + ( bi + 0.5 ) * bw;
    if ( ( gwid > 0.0 && uc > g0 - 0.8 && uc < g0 + gwid + 0.8 ) || abs( uc - dc ) < 1.25 ) on = 0.0;
    float gm = gwid > 0.0 ? fBox( vec2( u, v ), vec2( g0, 0.0 ), vec2( g0 + gwid, 2.3 ), px ) : 0.0;
    float panel = 0.86 + 0.14 * smoothstep( 0.0, 0.06, fract( v / 0.575 ) );
    vec3 gcol = mix( vec3( 0.6, 0.59, 0.56 ), vec3( 0.36, 0.25, 0.16 ), step( 0.75, sv2 ) ) * mix( panel, 0.95, lodV );
    fcCol = mix( fcCol, gcol, gm ); fcRough = mix( fcRough, 0.6, gm );
    float dm = fBox( vec2( u, v ), vec2( dc - 0.48, 0.0 ), vec2( dc + 0.48, 2.12 ), px );
    float hd = fH( vec2( seed + plotI * bPlot * 3.1, 8.0 ) );
    vec3 dcol = hd < 0.3 ? vec3( 0.32, 0.19, 0.11 ) : hd < 0.5 ? vec3( 0.1, 0.15, 0.12 ) : hd < 0.7 ? vec3( 0.12, 0.15, 0.24 ) : hd < 0.85 ? vec3( 0.36, 0.09, 0.07 ) : vec3( 0.6, 0.58, 0.55 );
    float dfr = 1.0 - fBox( vec2( u, v ), vec2( dc - 0.4, 0.0 ), vec2( dc + 0.4, 2.04 ), px );
    fcCol = mix( fcCol, mix( dcol, frameC, dfr ), dm ); fcRough = mix( fcRough, 0.55, dm );
  }
  // the top floor must fit under the roof
  if ( shop < 0.5 && v - ly + head > topV + 0.3 ) on = 0.0;
  if ( on < 0.001 ) return;
  // bays too narrow to see: the windows become a band along their row
  vec2 waa = aa;
  float o = fWindow( wp, mix( whw, bw * 0.5, lodU ), wsill, whead, wdep, Vw, wid, waa, wkind, wall, wfr, wlit ) * on;
  if ( shop < 0.5 && on > 0.5 && lodU < 0.9 ) {
    // stone surrounds: a lintel over the window and a sill under it, a little wider than the opening
    if ( bSurr > 0.5 ) {
      float sr = fBox( wp, vec2( -whw - 0.1, whead ), vec2( whw + 0.1, whead + 0.24 ), aa.y ) + fBox( wp, vec2( -whw - 0.08, wsill - 0.1 ), vec2( whw + 0.08, wsill ), aa.y );
      sr = min( sr, 1.0 ) * ( 1.0 - o );
      vec3 sc = style == 0.0 ? vec3( 0.55, 0.53, 0.49 ) : wall * 1.12;
      fcCol = mix( fcCol, sc, sr ); fcRough = mix( fcRough, 0.8, sr );
    }
    // shutters either side, in the house's colour for them
    if ( bShut > 0.5 ) {
      float sw = whw * 0.55;
      float sh = fBox( vec2( abs( wp.x ), wp.y ), vec2( whw + 0.03, wsill ), vec2( whw + 0.03 + sw, whead ), aa.x ) * ( 1.0 - o );
      float hs = fH( vec2( seed, 12.0 ) );
      vec3 shc = hs < 0.3 ? vec3( 0.05, 0.06, 0.055 ) : hs < 0.5 ? vec3( 0.07, 0.17, 0.1 ) : hs < 0.65 ? vec3( 0.05, 0.08, 0.17 ) : hs < 0.78 ? vec3( 0.25, 0.05, 0.04 ) : hs < 0.9 ? vec3( 0.55, 0.55, 0.52 ) : vec3( 0.28, 0.33, 0.2 );
      float louvre = 0.85 + 0.15 * smoothstep( 0.2, 0.8, fract( wp.y / 0.06 ) );
      shc *= mix( louvre, 0.93, smoothstep( 0.004, 0.015, aa.y ) );
      fcCol = mix( fcCol, shc, sh ); fcRough = mix( fcRough, 0.6, sh ); fcEmit *= 1.0 - sh;
    }
  }
  if ( lodU > 0.0 ) {
    float cov = mix( 1.0, ww, step( shop, 0.5 ) );
    vec3 avg = mix( fcCol, mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ), o );
    fcCol = mix( fcCol, avg, lodU ); fcEmit *= 1.0 - lodU; fcJit *= 1.0 - lodU;
  }
  fcCol = mix( fcCol, signC, sign * ( 1.0 - lodU ) );
  fcRough = mix( fcRough, 0.5, sign );
#ifndef FACADE_NO_BALC
  if ( bFire > 0.5 && v >= gh + 0.3 && lodV < 0.92 ) {
    // a fire escape down the middle of the front: an iron balcony at each floor, a ladder between them
    float k0 = floor( nb * 0.5 ) - 1.0;
    float inF = step( k0, bi ) * step( bi, k0 + 1.0 );
    if ( inF > 0.5 ) {
      float fx = bx - k0;                 // 0..2 across the two bays
      float plat = 1.0 - smoothstep( 0.05, 0.05 + pxv, abs( ly - 0.02 ) );
      float rail = 1.0 - smoothstep( 0.025, 0.025 + pxv, abs( ly - 0.95 ) );
      float bal = ( 1.0 - smoothstep( 0.012, 0.012 + pxu, abs( fract( u / 0.14 ) - 0.5 ) * 0.14 ) ) * step( ly, 0.95 ) * 0.55;
      float ends = 1.0 - smoothstep( 0.03, 0.03 + pxu, min( fx, 2.0 - fx ) * bw );
      // the ladder runs from this floor's balcony up to the next, across the left bay
      float lad = step( fx, 1.0 ) * ( 1.0 - smoothstep( 0.04, 0.04 + pxu, abs( fx * bw - ly / fh * bw ) ) );
      float m = max( max( max( plat, rail ), max( bal, ends ) ), lad ) * ( 1.0 - lodU * 0.5 );
      float shade = ( 1.0 - smoothstep( 0.05, 0.4, ly ) ) * 0.35;
      fcCol = mix( fcCol * ( 1.0 - shade ), vec3( 0.04, 0.04, 0.045 ), m ); fcRough = mix( fcRough, 0.5, m ); fcMetal = mix( fcMetal, 0.4, m ); fcEmit *= 1.0 - m; fcJit *= 1.0 - m;
    }
  }
  if ( ( look == 1.0 || look == 4.0 ) && v >= gh && lodV < 0.9 ) {
    // balconies: Haussmann's iron ones all along the 2nd and 5th floors and in front of the other windows,
    // a chalet's wooden one along every upper floor
    float full = look == 4.0 ? step( 4.0, L ) : ( abs( fi - 1.0 ) < 0.5 || abs( fi - 4.0 ) < 0.5 ? 1.0 : 0.0 );
    float bh = look == 4.0 ? 1.05 : 0.95;
    float inW = step( abs( wx ), whw + 0.1 ) * inBays;
    float band = step( ly, bh ) * max( full * step( margin, u ) * step( u, L - margin ), look == 1.0 ? inW * step( sill - 0.05, ly ) * step( ly, sill + 0.9 ) : 0.0 );
    if ( band > 0.5 ) {
      float yl = look == 1.0 && full < 0.5 ? ly - sill : ly;
      float rails = max( step( bh - 0.08, yl ), step( yl, 0.06 ) * full );
      float bars = look == 4.0 ? step( 0.035, abs( fract( u / 0.13 ) - 0.5 ) * 0.13 ) : 1.0 - step( 0.025, abs( fract( u / 0.11 ) - 0.5 ) * 0.11 );
      float rail = look == 4.0 ? max( rails, bars ) : max( rails, bars );
      vec3 rc = look == 4.0 ? vec3( 0.2, 0.12, 0.06 ) : vec3( 0.05, 0.05, 0.055 );
      float m = rail * ( 1.0 - lodU * 0.6 );
      fcCol = mix( fcCol, rc, m ); fcRough = mix( fcRough, look == 4.0 ? 0.85 : 0.45, m ); fcMetal = mix( fcMetal, look == 4.0 ? 0.0 : 0.3, m ); fcEmit *= 1.0 - m; fcJit *= 1.0 - m;
    }
  }
#endif
  if ( lodV > 0.0 ) {
    float cov = ww * ( head - sill ) / fh;
    fcCol = mix( fcCol, mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ), lodV );
    fcRough = mix( fcRough, mix( 0.88, 0.15, cov ), lodV );
    fcMetal = mix( fcMetal, 0.6 * cov, lodV );
    fcEmit *= 1.0 - lodV;
    fcJit *= 1.0 - lodV;
  }
}
`;

// seconds, for the screens; buildings.js sets it before the walls are drawn
export const FACADE_TIME = { value: 0 };

export function makeFacadeMaterial(opts = {}) {
  // the sky's hemisphere light already lights the walls from above; the environment adds reflections more than fill
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: opts.envMapIntensity ?? 0.8 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = FACADE_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfacade();\ndiffuseColor.rgb = fcCol;' + (m.userData.dbg ? '\n' + m.userData.dbg : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fcRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fcMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 fN = normalize( vWNrm );
  vec3 fT = vec3( fN.z, 0.0, -fN.x );
  normal = normalize( normal + ( viewMatrix * vec4( fT * fcJit.x + vec3( 0.0, fcJit.y, 0.0 ), 0.0 ) ).xyz );
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fcEmit;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
// light bounced up from the street and the facing buildings: a wall in shade is lit by more than the sky alone
// (without it shaded faces came out near black)
reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 0.19, 0.18, 0.16 );
reflectedLight.indirectDiffuse *= fcAO;
reflectedLight.indirectSpecular *= mix( 1.0, fcAO, 0.6 );
reflectedLight.directDiffuse *= mix( 1.0, fcAO, 0.45 );
reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( 1.5 ) );`);
  };
  m.customProgramCacheKey = () => 'facade19' + (m.userData.dbg || '');
  return m;
}
