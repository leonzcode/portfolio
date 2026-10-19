// The walls' material: a MeshStandardMaterial whose fragment shader draws a facade from a few numbers a vertex
// carries (see buildings.js): floors, bays of windows with frames, a recess seen in parallax, glass that reflects
// the scene's environment (each pane a little differently), lit rooms and blinds, a ground floor of shop fronts,
// doors or lobbies, the wall's own material (brick, concrete, curtain wall, stucco, siding, metal, stone), and
// darkening near the ground. Every detail fades to its average once it is smaller than a few pixels.
import * as THREE from 'three';

// styles (aS.x) and ground floors (aS.y), shared with buildings.js
export const STYLE = { BRICK: 0, CONCRETE: 1, GLASS: 2, STUCCO: 3, WOOD: 4, METAL: 5, STONE: 6, SOFFIT: 8 };
export const GROUND = { NONE: 0, SHOP: 1, DOOR: 2, LOBBY: 3, ROLLUP: 4, HOUSE: 5, HOUSE_FRONT: 6, HOUSE_GARAGE: 7 };

const VERT_PARS = /* glsl */`
attribute vec3 aCol;
attribute vec4 aW;
attribute vec4 aB;
attribute vec2 aS;
varying vec3 vCol;
varying vec4 vW;
varying vec4 vB;
varying vec2 vS;
varying vec3 vWPos;
varying vec3 vWNrm;
`;
const VERT = /* glsl */`
vCol = aCol; vW = aW; vB = aB; vS = aS;
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNrm = normalize( mat3( modelMatrix ) * objectNormal );
`;

const FRAG_PARS = /* glsl */`
varying vec3 vCol;
varying vec4 vW;
varying vec4 vB;
varying vec2 vS;
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

vec3 fcCol; float fcRough; float fcMetal; vec3 fcEmit; vec2 fcJit; float fcAO;

// one window: wx (metres from its centre, across), wy (metres from the floor), opening half width hwid, sill and
// head heights, recess depth, the view in the wall's frame. Returns 1 where the opening is, sets the look.
float fWindow( vec2 p, float hwid, float sill, float head, float depth, vec3 Vw, float id, float px, float kind, vec3 wallC, vec3 frameC, float lit ) {
  float open = fBox( p, vec2( -hwid, sill ), vec2( hwid, head ), px );
  if ( open <= 0.0 ) return 0.0;
  // the glass plane is depth behind the wall: what is seen through this point of the opening
  vec2 g = p - Vw.xy * ( depth / max( Vw.z, 0.08 ) );
  float onGlass = fBox( g, vec2( -hwid, sill ), vec2( hwid, head ), px );
  float fw = 0.07;
  float frame = 1.0 - fBox( g, vec2( -hwid + fw, sill + fw ), vec2( hwid - fw, head - fw ), px );
  // mullion and transom
  float wwid = 2.0 * hwid;
  if ( wwid > 1.25 ) frame = max( frame, 1.0 - smoothstep( 0.03, 0.03 + px, abs( g.x ) ) );
  if ( kind > 0.5 && head - sill > 1.3 ) frame = max( frame, 1.0 - smoothstep( 0.025, 0.025 + px, abs( g.y - ( sill + ( head - sill ) * 0.58 ) ) ) );
  float h = fH( vec2( id, id * 1.37 + 3.1 ) ), h2 = fH( vec2( id * 2.11, 7.7 ) );
  float ly = ( g.y - sill ) / max( head - sill, 0.1 );
  float lx = ( g.x + hwid ) / max( wwid, 0.1 );
  // glass: dark interior, a reflective coated pane, tinted a little per window
  vec3 gc = vec3( 0.11, 0.13, 0.145 ) * ( 0.7 + 0.6 * h2 );
  float gr = 0.04 + 0.06 * h2, gm = 0.6;
  vec3 ge = vec3( 0.0 );
  vec2 jit = ( vec2( h, h2 ) - 0.5 ) * 0.035;
  if ( h < lit ) {
    // a lit room
    ge = vec3( 1.0, 0.86, 0.66 ) * ( 0.10 + 0.12 * h2 ) * ( 0.6 + 0.4 * ly );
    gm = 0.45; gc *= 0.7;
  } else if ( h < lit + 0.22 ) {
    // blinds down to some height
    float down = 0.25 + 0.75 * h2;
    if ( ly > 1.0 - down ) {
      float slat = 0.85 + 0.15 * smoothstep( 0.3, 0.7, fract( g.y / 0.05 ) );
      gc = mix( vec3( 0.55, 0.53, 0.48 ), vec3( 0.62, 0.6, 0.58 ), h ) * mix( 1.0, slat, 1.0 - smoothstep( 0.006, 0.02, px ) );
      gr = 0.75; gm = 0.0; jit = vec2( 0.0 );
    }
  } else if ( kind > 0.5 && h < lit + 0.45 ) {
    // curtains drawn to the sides
    float side = ( 1.0 - smoothstep( 0.24, 0.28, lx ) ) + smoothstep( 0.72, 0.76, lx );
    if ( side > 0.5 ) { gc = mix( vec3( 0.7, 0.66, 0.58 ), vec3( 0.45, 0.32, 0.28 ), h2 ) * 0.8; gr = 0.9; gm = 0.0; jit = vec2( 0.0 ); }
  }
  // interior depth: darker towards the top of the opening
  gc *= 0.8 + 0.25 * ( 1.0 - ly );
  vec3 col = gc; float rough = gr, metal = gm; vec3 emit = ge;
  if ( frame > 0.5 ) { col = frameC; rough = 0.5; metal = 0.0; emit = vec3( 0.0 ); jit = vec2( 0.0 ); }
  // the reveal: the side of the recess
  if ( onGlass < 0.5 ) { col = wallC * 0.62; rough = 0.9; metal = 0.0; emit = vec3( 0.0 ); jit = vec2( 0.0 ); }
  fcCol = mix( fcCol, col, open ); fcRough = mix( fcRough, rough, open ); fcMetal = mix( fcMetal, metal, open );
  fcEmit = mix( fcEmit, emit, open ); fcJit = mix( fcJit, jit, open );
  return open;
}

void facade() {
  float u = vW.x, L = vW.y, eave = vW.z, gy = vW.w;
  // seed is a whole number per building: rounded here, because a hash of an interpolated value differs from
  // pixel to pixel by the interpolation's rounding, which showed as white speckles over windows
  float base = vB.x, fh = vB.y, gh = vB.z, seed = floor( vB.w + 0.5 );
  float style = vS.x, gk = vS.y;
  vec3 N = normalize( vWNrm );
  vec3 T = normalize( vec3( N.z, 0.0, -N.x ) );
  float y = vWPos.y;
  float v = y - base;
  float above = y - gy;
  vec3 wall = vCol;
  // screen-space sizes first, while every pixel of the quad still runs the same code
  float px = clamp( max( fwidth( u ), fwidth( v ) ), 1e-4, 50.0 ) * 0.75;
  fcCol = wall; fcRough = 0.88; fcMetal = 0.0; fcEmit = vec3( 0.0 ); fcJit = vec2( 0.0 );
  fcAO = mix( 0.5, 1.0, smoothstep( -0.2, 2.2, above ) );
  if ( style > 7.5 ) { fcCol = wall * 0.55; return; }
  vec3 V = normalize( cameraPosition - vWPos );
  vec3 Vw = vec3( dot( V, T ), V.y, dot( V, N ) );
  
  // ---------- the wall's own surface ----------
  float grime = px > 0.3 ? 0.5 : fNoise( vec2( u * 0.35, v * 0.9 ) + seed * 0.731 ) * 0.5 + fNoise( vec2( u * 1.7, v * 0.25 ) + seed * 0.377 ) * 0.5;
  vec3 surf = wall * ( 0.9 + 0.16 * grime );
  float fine = 1.0 - smoothstep( 0.008, 0.03, px );
  if ( style < 0.5 ) {
    // brick, stretcher bond
    float bh = 0.075, bw = 0.225;
    float row = floor( v / bh );
    float bu = u / bw + 0.5 * mod( row, 2.0 );
    float bi = floor( bu );
    vec2 bl = vec2( fract( bu ) * bw, fract( v / bh ) * bh );
    float brick = fBox( bl, vec2( 0.011 ), vec2( bw - 0.011, bh - 0.011 ), px * 0.5 );
    vec3 bc = wall * ( 0.82 + 0.34 * fH( vec2( bi, row ) + seed ) );
    vec3 mortar = vec3( 0.62, 0.6, 0.56 ) * ( 0.8 + 0.2 * grime );
    vec3 detail = mix( mortar, bc, brick );
    surf = mix( wall * ( 0.86 + 0.16 * grime ) * 0.97, detail, fine );
  } else if ( style < 1.5 ) {
    // concrete panels: a joint at each floor and every few metres
    float j = max( 1.0 - smoothstep( 0.0, 0.02 + px, abs( fract( ( v - gh ) / fh + 0.5 ) - 0.5 ) * fh ),
                   1.0 - smoothstep( 0.0, 0.015 + px, abs( fract( u / 3.0 + 0.5 ) - 0.5 ) * 3.0 ) );
    surf *= 1.0 - 0.18 * j * ( 1.0 - smoothstep( 0.02, 0.08, px ) );
  } else if ( style > 3.5 && style < 4.5 ) {
    // lap siding: a shadow line under each board
    float b = fract( v / 0.19 );
    surf *= mix( 1.0, 0.72 + 0.28 * smoothstep( 0.0, 0.18, b ), 1.0 - smoothstep( 0.01, 0.03, px ) );
  } else if ( style > 4.5 && style < 5.5 ) {
    // ribbed metal
    float r = 0.5 + 0.5 * cos( u / 0.2 * 6.2832 );
    surf *= mix( 1.0, 0.85 + 0.2 * r, 1.0 - smoothstep( 0.015, 0.05, px ) );
    fcRough = 0.6;
  } else if ( style > 5.5 && style < 6.5 ) {
    // ashlar stone
    float sh = 0.38, sw = 0.75, row = floor( v / sh );
    float su = u / sw + 0.5 * mod( row, 2.0 );
    vec2 sl = vec2( fract( su ) * sw, fract( v / sh ) * sh );
    float stone = fBox( sl, vec2( 0.008 ), vec2( sw - 0.008, sh - 0.008 ), px * 0.5 );
    vec3 sc = wall * ( 0.9 + 0.18 * fH( vec2( floor( su ), row ) + seed ) );
    surf = mix( surf, mix( wall * 0.75, sc, stone ), 1.0 - smoothstep( 0.015, 0.05, px ) );
  }
  // a darker plinth and dirt near the ground, a cornice under a flat roof's edge
  if ( gk > 0.5 && gk < 4.5 && style != 2.0 ) surf *= mix( 1.0, 0.78, fBand( v, -50.0, 0.45, px ) );
  surf *= mix( 1.0, 0.82, fBand( eave - v, 0.0, 0.35, px ) );
  surf *= mix( 1.0, 1.08, fBand( eave - v, 0.35, 0.6, px ) );
  fcCol = surf;

  // ---------- the window grid ----------
  if ( L < 2.2 || v > eave - 0.25 ) return;
  float bayW = 3.0, ww = 0.48, sill = 0.85, head = 2.45, depth = 0.14, lit = 0.06, kind = 0.0;
  vec3 frameC = vec3( 0.16, 0.17, 0.18 );
  float sv = fH( vec2( seed * 13.0, 1.0 ) ), sv2 = fH( vec2( seed * 7.0, 2.0 ) );
  if ( style < 0.5 ) { bayW = 2.6; ww = 0.46; sill = 0.8; head = fh - 0.55; depth = 0.18; kind = 1.0; frameC = sv > 0.45 ? vec3( 0.86, 0.85, 0.82 ) : vec3( 0.12, 0.12, 0.12 ); }
  else if ( style < 1.5 ) { bayW = 3.0; ww = sv > 0.55 ? 0.94 : 0.62; sill = 0.9; head = fh - 0.6; depth = 0.12; frameC = vec3( 0.32, 0.34, 0.36 ); }
  else if ( style < 2.5 ) { bayW = 1.5; }
  else if ( style < 3.5 ) { bayW = gk > 4.5 ? 3.3 : 3.0; ww = gk > 4.5 ? 0.46 : 0.42; sill = 0.9; head = fh - 0.7; depth = 0.12; kind = 1.0; frameC = vec3( 0.86, 0.86, 0.84 ); }
  else if ( style < 4.5 ) { bayW = 3.4; ww = gk > 4.5 ? 0.42 : 0.32; sill = 0.9; head = fh - 0.75; depth = 0.08; kind = 1.0; frameC = vec3( 0.88, 0.88, 0.85 ); }
  else if ( style < 5.5 ) { bayW = 6.0; ww = 0.5; sill = fh - 1.3; head = fh - 0.4; depth = 0.05; lit = 0.02; }
  else { bayW = 3.2; ww = 0.4; sill = 0.7; head = fh - 0.45; depth = 0.22; kind = 1.0; frameC = vec3( 0.18, 0.17, 0.16 ); }
  bayW *= 0.88 + 0.24 * sv2;
  float margin = min( 0.7, L * 0.08 );
  float span = L - 2.0 * margin;
  float nb = max( 1.0, floor( span / bayW + 0.5 ) );
  float bw = span / nb;
  float bx = ( u - margin ) / bw;
  float bi = floor( bx );
  float inBays = step( 0.0, bx ) * step( bx, nb );
  float wx = ( fract( bx ) - 0.5 ) * bw;
  // detail size on screen: fade the whole grid to its average far away
  float lod = smoothstep( 0.16, 0.42, px / min( bw, fh ) );
  float topV = eave - 0.55;
  if ( lod > 0.985 && ( style < 1.5 || style > 2.5 ) ) {
    // far: the grid's average, without working out a single window
    float cov = ww * ( head - sill ) / fh * step( gh, v ) * inBays;
    fcCol = mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ); fcRough = mix( 0.88, 0.15, cov ); fcMetal = 0.6 * cov;
    return;
  }

  if ( style > 1.5 && style < 2.5 ) {
    // curtain wall: panes between mullions, a spandrel at each slab; floors stay readable further away than panes
    // the glass takes the building's own colour (from the picture where it shows the face), darkened
    vec3 tint = mix( mix( vec3( 0.20, 0.27, 0.31 ), vec3( 0.27, 0.29, 0.30 ), sv ), wall * 1.1, 0.55 ) * ( 0.8 + 0.3 * sv2 );
    float pw = bw;
    float fy = ( v - gh ) / fh, fi = floor( fy ), ly = fract( fy ) * fh;
    if ( v < gh ) { fi = -1.0; ly = v; }
    float id = bi * 31.0 + fi * 7.0 + seed * 11.0;
    float hp = fH( vec2( id, 0.5 ) ), hf = fH( vec2( fi + seed * 17.0, 3.5 ) );
    float lodM = smoothstep( 0.12, 0.35, px / pw ), lodF = smoothstep( 0.1, 0.3, px / fh );
    float mullV = ( 1.0 - smoothstep( 0.035, 0.035 + px, abs( wx ) - pw * 0.5 + 0.035 ) ) * ( 1.0 - lodM );
    float slab = 1.0 - smoothstep( 0.04, 0.04 + px, min( ly, fh - ly ) );
    float spand = v < gh ? 0.0 : fBand( ly, fh - 0.95, fh, px ) * step( 0.5, sv2 );
    // far away: a slab line and a spandrel band are what is left of each floor
    slab = mix( slab, 0.08 / fh * 2.0, lodF );
    spand = mix( spand, 0.95 / fh * step( 0.5, sv2 ), lodF );
    vec3 gc = tint * ( 0.85 + 0.3 * mix( hp, hf, lodM ) );
    vec3 mc = mix( vec3( 0.55, 0.58, 0.6 ), vec3( 0.12, 0.13, 0.14 ), step( 0.5, sv ) );
    float mull = max( mullV, slab );
    vec3 col = mix( gc, tint * 0.55, spand );
    float lit2 = step( hp, 0.05 ) * ( 1.0 - spand ) * ( 1.0 - lodM );
    col = mix( col, mc, mull );
    fcCol = col;
    fcRough = mix( mix( 0.06 + 0.04 * hp, 0.5, mull ), 0.16, lodM * 0.5 );
    fcMetal = mix( 0.55, 0.2, mull );
    fcEmit = vec3( 1.0, 0.92, 0.8 ) * 0.12 * lit2 * ( 1.0 - mull );
    fcJit = ( vec2( mix( hp, hf, lodM ), fH( vec2( id, 2.5 ) ) ) - 0.5 ) * 0.03 * ( 1.0 - mull );
    return;
  }

  // houses: a base course all round, and on the front a door and maybe a garage door; windows in the other bays
  float skipWin = 0.0;
  if ( gk > 4.5 ) {
    float bcm = 1.0 - smoothstep( 0.42 - px, 0.42 + px, v );
    fcCol = mix( fcCol, vec3( 0.3, 0.29, 0.27 ) * ( 0.9 + 0.2 * grime ), bcm ); fcRough = mix( fcRough, 0.92, bcm );
    if ( gk > 5.5 && v < fh ) {
      float side = step( 0.5, sv );
      float gwid = gk > 6.5 ? ( L > 16.0 && sv2 > 0.45 ? 5.0 : 2.7 ) : 0.0;
      float g0 = side < 0.5 ? 0.7 : L - 0.7 - gwid;
      float dc = gwid > 0.0 ? ( side < 0.5 ? ( g0 + gwid + L ) * 0.5 : g0 * 0.5 ) : L * ( 0.35 + 0.3 * sv2 );
      float gm = gwid > 0.0 ? fBox( vec2( u, v ), vec2( g0, 0.0 ), vec2( g0 + gwid, 2.3 ), px ) : 0.0;
      float dm = fBox( vec2( u, v ), vec2( dc - 0.48, 0.0 ), vec2( dc + 0.48, 2.12 ), px );
      float uc = margin + ( bi + 0.5 ) * bw;
      if ( ( gwid > 0.0 && uc > g0 - 0.8 && uc < g0 + gwid + 0.8 ) || abs( uc - dc ) < 1.25 ) skipWin = 1.0;
      if ( gm > 0.0 ) {
        // a sectional garage door: four panels, white or a warm wood
        float panel = 0.86 + 0.14 * smoothstep( 0.0, 0.06, fract( v / 0.575 ) );
        vec3 gcol = mix( vec3( 0.6, 0.59, 0.56 ), vec3( 0.36, 0.25, 0.16 ), step( 0.75, sv2 ) ) * mix( panel, 0.95, lod );
        fcCol = mix( fcCol, gcol, gm ); fcRough = mix( fcRough, 0.6, gm ); fcMetal = mix( fcMetal, 0.0, gm );
        if ( gm > 0.5 ) return;
      }
      if ( dm > 0.0 ) {
        float hd = fH( vec2( seed, 8.0 ) );
        vec3 dcol = hd < 0.3 ? vec3( 0.32, 0.19, 0.11 ) : hd < 0.5 ? vec3( 0.1, 0.15, 0.12 ) : hd < 0.7 ? vec3( 0.12, 0.15, 0.24 ) : hd < 0.85 ? vec3( 0.36, 0.09, 0.07 ) : vec3( 0.6, 0.58, 0.55 );
        float fr = 1.0 - fBox( vec2( u, v ), vec2( dc - 0.4, 0.0 ), vec2( dc + 0.4, 2.04 ), px );
        fcCol = mix( fcCol, mix( dcol, frameC, fr ), dm ); fcRough = mix( fcRough, 0.55, dm ); fcMetal = mix( fcMetal, 0.0, dm );
        if ( dm > 0.5 ) return;
      }
    }
  }

  // the ground floor
  if ( v < gh && gk > 0.5 && gk < 4.5 ) {
    float doorBay = floor( fH( vec2( seed * 3.0, 5.0 ) ) * nb );
    if ( gk < 1.5 || gk > 2.5 && gk < 3.5 ) {
      // shop fronts or a lobby: big glass between piers, a sign band over them
      float pier = 0.22;
      float top = gk < 1.5 ? gh - 1.05 : gh - 0.45;
      float bottom = bi == doorBay ? 0.02 : ( gk < 1.5 ? 0.45 : 0.08 );
      float id = bi * 17.0 + seed * 59.0;
      vec2 p = vec2( wx, v );
      vec3 mc = vec3( 0.13, 0.13, 0.14 );
      float o = fWindow( p, bw * 0.5 - pier, bottom, top, 0.08, Vw, id, px, 0.0, wall, mc, 0.35 ) * inBays;
      if ( gk < 1.5 ) {
        float sign = fBand( v, gh - 0.95, gh - 0.3, px ) * fBand( wx, -bw * 0.5 + pier, bw * 0.5 - pier, px ) * inBays;
        float hs = fH( vec2( id, 9.0 ) );
        vec3 sc = hs < 0.5 ? vec3( 0.08, 0.08, 0.09 ) : mix( vec3( 0.55, 0.12, 0.1 ), vec3( 0.12, 0.25, 0.4 ), fH( vec2( id, 4.0 ) ) );
        if ( hs > 0.85 ) sc = vec3( 0.75, 0.7, 0.6 );
        fcCol = mix( fcCol, sc, sign * ( 1.0 - lod ) );
        fcRough = mix( fcRough, 0.5, sign );
      }
      if ( lod > 0.0 ) { fcCol = mix( fcCol, mix( surf, vec3( 0.12 ), 0.6 ), lod * inBays ); fcMetal = mix( fcMetal, 0.3, lod * inBays ); fcRough = mix( fcRough, 0.4, lod * inBays ); }
      fcAO *= 1.0;
      return;
    }
    if ( gk > 1.5 && gk < 2.5 && bi == doorBay ) {
      // a front door
      float d = fBox( vec2( wx, v ), vec2( -0.5, 0.0 ), vec2( 0.5, 2.15 ), px ) * inBays;
      vec3 dc = mix( vec3( 0.28, 0.17, 0.1 ), mix( vec3( 0.1, 0.18, 0.3 ), vec3( 0.45, 0.08, 0.06 ), sv ), step( 0.5, sv2 ) );
      float fr = 1.0 - fBox( vec2( wx, v ), vec2( -0.42, 0.0 ), vec2( 0.42, 2.07 ), px );
      fcCol = mix( fcCol, mix( dc, frameC, fr ), d * ( 1.0 - lod ) );
      fcRough = mix( fcRough, 0.55, d );
      return;
    }
    if ( gk > 3.5 ) {
      // roll-up doors in every other bay
      if ( mod( bi, 2.0 ) < 0.5 ) {
        float d = fBox( vec2( wx, v ), vec2( -min( 1.8, bw * 0.4 ), 0.0 ), vec2( min( 1.8, bw * 0.4 ), min( 4.0, gh - 0.6 ) ), px ) * inBays;
        float rib = 0.85 + 0.15 * smoothstep( 0.2, 0.8, fract( v / 0.12 ) );
        fcCol = mix( fcCol, vec3( 0.5, 0.52, 0.53 ) * mix( rib, 0.93, lod ), d );
      }
      return;
    }
  }

  // upper floors (and plain ground floors)
  float fy, fi, ly;
  if ( v < gh ) { fi = -1.0; ly = v - max( 0.0, gh - fh ); }
  else { fy = ( v - gh ) / fh; fi = floor( fy ); ly = fract( fy ) * fh; }
  if ( v < gh && gk > 0.5 && gk < 4.5 && abs( gk - 2.0 ) > 0.5 ) return;
  if ( skipWin > 0.5 && v < fh ) return;
  // the top floor must fit under the roof
  if ( v - ly + head > topV + 0.3 ) return;
  float id = bi * 31.0 + fi * 7.0 + seed * 11.0;
  vec3 before = fcCol;
  float o = fWindow( vec2( wx, ly ), ww * bw * 0.5, sill, head, depth, Vw, id, px, kind, wall, frameC, lit ) * inBays;
  if ( lod > 0.0 ) {
    float cov = ww * ( head - sill ) / fh;
    fcCol = mix( fcCol, mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ), lod );
    fcRough = mix( fcRough, mix( 0.88, 0.15, cov ), lod );
    fcMetal = mix( fcMetal, 0.6 * cov, lod );
    fcEmit *= 1.0 - lod;
    fcJit *= 1.0 - lod;
  }
}
`;

export function makeFacadeMaterial(opts = {}) {
  // the sky's hemisphere light already lights the walls from above; the environment adds reflections more than fill
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: opts.envMapIntensity ?? 0.5 });
  m.onBeforeCompile = (shader) => {
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
reflectedLight.indirectDiffuse *= fcAO;
reflectedLight.indirectSpecular *= mix( 1.0, fcAO, 0.6 );
reflectedLight.directDiffuse *= mix( 1.0, fcAO, 0.45 );
reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( 1.5 ) );`);
  };
  m.customProgramCacheKey = () => 'facade8' + (m.userData.dbg || '');
  return m;
}
