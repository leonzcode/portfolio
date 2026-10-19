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
  float fw = 0.07;
  vec2 fa = step( lo + fw, g ) * step( g, hi - fw );
  float frame = 1.0 - fa.x * fa.y;
  float wwid = 2.0 * hwid;
  frame = max( frame, step( 1.25, wwid ) * ( 1.0 - smoothstep( 0.03, 0.03 + aa.x, abs( g.x ) ) ) );
  frame = max( frame, kind * step( 1.3, head - sill ) * ( 1.0 - smoothstep( 0.025, 0.025 + aa.y, abs( g.y - ( sill + ( head - sill ) * 0.58 ) ) ) ) );
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
  float isCu = ( 1.0 - isLit ) * ( 1.0 - step( h, lit + 0.22 ) ) * step( h, lit + 0.45 ) * kind * step( 0.5, side );
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
  fcCol = wall; fcRough = 0.88; fcMetal = 0.0; fcEmit = vec3( 0.0 ); fcJit = vec2( 0.0 );
  fcAO = mix( 0.5, 1.0, smoothstep( -0.2, 2.2, above ) );
  if ( style > 7.5 ) { fcCol = wall * 0.55; return; }
  vec3 V = normalize( cameraPosition - vWPos );
  vec3 Vw = vec3( dot( V, T ), V.y, dot( V, N ) );
  bool glass = style == 2.0;
  bool house = gk > 4.5;

  // ---------- the wall's own surface ----------
  float grime = fNoise( vec2( u * 0.35, v * 0.9 ) + seed * 0.731 ) * 0.5 + fNoise( vec2( u * 1.7, v * 0.25 ) + seed * 0.377 ) * 0.5;
  vec3 surf = wall * ( 0.9 + 0.16 * grime );
  float fine = 1.0 - smoothstep( 0.008, 0.03, px );
  float mid = 1.0 - smoothstep( 0.015, 0.05, px );
  if ( style == 0.0 || style == 6.0 ) {
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
  fcCol = surf;

  // ---------- the window grid ----------
  if ( L < 2.2 || v > eave - 0.25 ) return;
  float sv = fH( vec2( seed * 13.0, 1.0 ) ), sv2 = fH( vec2( seed * 7.0, 2.0 ) );
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
  float ww = P1.y, sill = P1.z, head = P1.w;
  float bayW = P1.x * ( 0.88 + 0.24 * sv2 );
  float margin = min( 0.7, L * 0.08 );
  float span = L - 2.0 * margin;
  float nb = max( 1.0, floor( span / bayW + 0.5 ) );
  float bw = span / nb;
  float bx = ( u - margin ) / bw;
  float bi = floor( bx );
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
    float gwid = gk > 6.5 ? ( L > 16.0 && sv2 > 0.45 ? 5.0 : 2.7 ) : 0.0;
    float g0 = sv < 0.5 ? 0.7 : L - 0.7 - gwid;
    float dc = gwid > 0.0 ? ( sv < 0.5 ? ( g0 + gwid + L ) * 0.5 : g0 * 0.5 ) : L * ( 0.35 + 0.3 * sv2 );
    float uc = margin + ( bi + 0.5 ) * bw;
    if ( ( gwid > 0.0 && uc > g0 - 0.8 && uc < g0 + gwid + 0.8 ) || abs( uc - dc ) < 1.25 ) on = 0.0;
    float gm = gwid > 0.0 ? fBox( vec2( u, v ), vec2( g0, 0.0 ), vec2( g0 + gwid, 2.3 ), px ) : 0.0;
    float panel = 0.86 + 0.14 * smoothstep( 0.0, 0.06, fract( v / 0.575 ) );
    vec3 gcol = mix( vec3( 0.6, 0.59, 0.56 ), vec3( 0.36, 0.25, 0.16 ), step( 0.75, sv2 ) ) * mix( panel, 0.95, lodV );
    fcCol = mix( fcCol, gcol, gm ); fcRough = mix( fcRough, 0.6, gm );
    float dm = fBox( vec2( u, v ), vec2( dc - 0.48, 0.0 ), vec2( dc + 0.48, 2.12 ), px );
    float hd = fH( vec2( seed, 8.0 ) );
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
  if ( lodU > 0.0 ) {
    float cov = mix( 1.0, ww, step( shop, 0.5 ) );
    vec3 avg = mix( fcCol, mix( surf, vec3( 0.16, 0.18, 0.2 ), cov ), o );
    fcCol = mix( fcCol, avg, lodU ); fcEmit *= 1.0 - lodU; fcJit *= 1.0 - lodU;
  }
  fcCol = mix( fcCol, signC, sign * ( 1.0 - lodU ) );
  fcRough = mix( fcRough, 0.5, sign );
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
  m.customProgramCacheKey = () => 'facade10' + (m.userData.dbg || '');
  return m;
}
