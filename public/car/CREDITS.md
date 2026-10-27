# Credits

## Car models

All car models are licensed under Creative Commons Attribution 4.0 (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/).
The licence of each was checked on its Sketchfab page (and Sketchfab's public model API for the same page) on
2026-10-19. The files were downloaded from the Objaverse mirror of Sketchfab's CC-licensed models
(https://huggingface.co/datasets/allenai/objaverse), which needs no login.

What was changed in every model (by us, in Blender 4.1, script `tools/process.py` in the build scratchpad):
turned and scaled to real size (forward -z, metres, origin on the ground between the axles), parts regrouped and
renamed (body, four wheels with the hub as pivot, steering wheel, light lenses split by role and side), duplicate
clear-coat shells and shadow planes removed, polygon count reduced (decimated) to fit the game's budget, textures
re-encoded (WebP or JPEG) and, for the traffic versions (`*_npc.glb`), the interior removed, every texture baked into one
1024 px atlas and a low-detail far version added. Materials are
partly replaced at run time (car paint, glass, chrome, lamp glow) by `js/cars.js`.

| File | Model | Author | Source | Licence |
|---|---|---|---|---|
| `models/volvos90.glb`, `models/volvos90_npc.glb` | Volvo S90 Recharge (Free) | lazercar | https://sketchfab.com/3d-models/volvo-s90-recharge-free-9462b07c10244fd4a28d86846dc9e3a9 | CC BY 4.0 |
| `models/porsche930.glb`, `models/porsche930_npc.glb` | FREE 1975 Porsche 911 (930) Turbo | Lionsharp Studios (lionsharp) | https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e | CC BY 4.0 |
| `models/s10.glb`, `models/s10_npc.glb` | Chevrolet S10 | Luquita (speedmodel) | https://sketchfab.com/3d-models/chevrolet-s10-2c2fcccdd96948aaa655f936aa325f0d | CC BY 4.0 |
| `models/fairheaven.glb`, `models/fairheaven_npc.glb` | Fairheaven LT '80 - Low poly model | Daniel Zhabotinsky | https://sketchfab.com/3d-models/fairheaven-lt-80-low-poly-model-e2678da920cc4be68dbc193727919ffb | CC BY 4.0 |
| `models/milano.glb`, `models/milano_npc.glb` | Milano '95 - Low poly model | Daniel Zhabotinsky | https://sketchfab.com/3d-models/milano-95-low-poly-model-122a22d210234596ad23623588d0d166 | CC BY 4.0 |
| `models/shvan_npc.glb` | Shvan '92 - Low poly model | Daniel Zhabotinsky | https://sketchfab.com/3d-models/shvan-92-low-poly-model-09d718c9cf72401b8534d265a06a803f | CC BY 4.0 |
| `models/conquer_npc.glb` | Conquer '89 Pickup - Low poly model | Daniel Zhabotinsky | https://sketchfab.com/3d-models/conquer-89-pickup-low-poly-model-6c48c94be8974dc7a5932f697c0ba68f | CC BY 4.0 |
| `models/ferrari458.glb`, `models/ferrari458_npc.glb` | Ferrari 458 Italia | vicent091036 | https://sketchfab.com/3d-models/ferrari-458-italia-57bf6cc56931426e87494f554df1dab6 (the copy prepared for the three.js examples, `examples/models/gltf/ferrari.glb`, was used) | CC BY 4.0 (see the note below) |
| `models/roadster.glb`, `models/roadster_npc.glb` | Tesla Roadster 2020 | metarex.4d | https://sketchfab.com/3d-models/tesla-roadster-2020-1fbf29e297bd4a17ac39a00a378441d8 | CC BY 4.0 |
| `models/gallardo.glb`, `models/gallardo_npc.glb` | Lamborghini Gallardo 2010 | Artem P (temp0.crazy) | https://sketchfab.com/3d-models/ff0eb2242d0e42eb8b7034b4db639e56 | CC BY 4.0 |
| `models/schoolbus.glb`, `models/schoolbus_npc.glb` | School Bus Conversion (an International IC CE) | steun | https://sketchfab.com/3d-models/21b7e85f54024a6888bb168f21bbb2e1 | CC BY 4.0 |
| `models/semi.glb`, `models/semi_npc.glb` | Tesla Semi | Oleksii Rozumnyi (Oleksii.Rozumnyi) | https://sketchfab.com/3d-models/39ffc7c746184e0c9ebd5bbcd0b405dd | CC BY 4.0 |
| `models/golf2.glb`, `models/golf2_npc.glb` | VW Golf 2 | Teofels (teofels) | https://sketchfab.com/3d-models/c9f47e2e291241d2a490adab1d1ca921 | CC BY 4.0 |

The cars added on 2026-10-22 were checked the same way (Sketchfab's model API on 2026-10-21/22), with these notes and
changes beyond the list above:

- Ferrari 458 Italia: the Sketchfab page has since been taken down, so the licence could not be read on it again. The
  record is CC Attribution in the Objaverse crawl of that page (licence slug "by"), and three.js lists the same file
  as "CC-BY 4.0, External License" with that link (mrdoob/three.js issue 23089). The round tail lamps were tinted red.
- Lamborghini Gallardo: the author credits the brake disc and caliper to another Blend Swap user and the tyre sidewall
  texture to a DeviantArt user; neither page could confirm a licence, so the discs, the calipers and the tyre textures
  were taken out (the tyres are plain rubber). The steering wheel was cut out of the interior so it turns.
- School bus: the model is a camper conversion of a school bus. The camper fittings inside (beds, cupboards, fridge,
  cushions, floor) were removed and 22 green vinyl bench seats for children (our own geometry) and lamp lenses over the
  painted rear lamps were added.
- Tesla Semi: lamp lenses added at the back of the frame; a simple steering wheel is drawn at run time by `js/cars.js`.
- Tesla Roadster: the brake calipers stay with the body (they do not turn with the wheels).
- Milano '95, Porsche 911 and Conquer '89: the front wheels, which their authors posed turned 18 to 30 degrees, were
  turned straight again so they spin true (2026-10-21).
- VW Golf 2 (added 2026-10-26; licence read on its Sketchfab page and in the model API that day, CC Attribution 4.0):
  the file had every face's corners apart, so its vertices were welded (0.5 mm) and shaded by angle; the wheels,
  which the author gave 2.8 degrees (front) and 1.6 degrees (rear) of camber, were straightened. The model has no
  cabin, so one was added from simple boxes of our own (seats, dashboard, instrument hood, console, gear lever,
  steering column, door cards, parcel shelf, headliner, floor), with a copy of the body shell a few millimetres in as
  its inner lining and the shell's inward-facing faces in the same dark trim; the steering wheel is drawn at run
  time by `js/cars.js`. (A request for a different 1992 Golf GTI Mk2 model was not followed: that one is CC
  BY-NC-SA and its page says it is based on a Need for Speed model.)

The licences cover the 3D models only. Car makers' names, badges and designs may be trademarks of their owners;
the models are fan-made and not endorsed by Volvo, Porsche, General Motors, Ferrari, Lamborghini, Tesla,
Navistar (International), or Volkswagen.

## Environment map

| File | Asset | Author | Source | Licence |
|---|---|---|---|---|
| `models/env/wide_street_01_1k.hdr` | Wide Street 01 (1K HDR) | Sergej Majboroda | https://polyhaven.com/a/wide_street_01 | CC0 |

## Map interface (`js/mapui.js`)

Nothing is copied into the repo: the map picker loads these at run time and credits them on screen (the footer of
the map, and the corner of the minimap while driving). The figure you drag, the pin, the compass and the other
icons are our own drawings in `js/mapui.js`; no Google image files are used.

| Used for | Service | Terms |
|---|---|---|
| Satellite layer and place pictures | Esri World Imagery (server.arcgisonline.com) | Esri attribution: "Esri, Maxar, Earthstar Geographics" |
| Labels and roads over satellite | Esri World Boundaries and Places, World Transportation | Esri attribution (Esri, HERE, Garmin, OpenStreetMap contributors) |
| Map layer and the driving minimap | Esri World Topo Map | Esri attribution (Esri, HERE, Garmin, USGS, OpenStreetMap contributors) |
| Roads you can drive (blue lines, snapping) | OpenFreeMap vector tiles (tiles.openfreemap.org), OpenMapTiles schema; Overpass API as a fallback | OpenStreetMap data, ODbL; OpenFreeMap is free with no key |
| Suggestions while typing | Photon (photon.komoot.io) | OpenStreetMap data, ODbL; fair use |
| Search on Enter, addresses | Nominatim (nominatim.openstreetmap.org) | OSMF usage policy: at most one request a second, no type-ahead (the module queues every call) |
| Typefaces | Google Sans and Roboto (Google Fonts) | SIL Open Font License 1.1 (checked in the google/fonts repository) |

CARTO's keyless raster basemaps were the first choice for the map layer, but on 2026-10-19 every CARTO style
answered with an "API key required" picture, so the map layer uses Esri World Topo Map instead.

## The world (`js/world.js`, `js/osm.js`, `js/mvt.js`)

Loaded at run time, nothing copied into the repo; the credits for what is on screen show in the corner while
driving.

| Used for | Source | Terms |
|---|---|---|
| Photorealistic 3D city (only with the player's own key) | Google Map Tiles API, Photorealistic 3D Tiles | Google Maps Platform terms; Google and the data providers are credited on screen from the tiles' own copyright lines |
| Ground shape without a key | Terrarium elevation tiles, AWS Open Data (Mapzen, from SRTM, USGS 3DEP, ETOPO1 and others) | open data, credited as "Mapzen, AWS Open Data" |
| Ground picture without a key | Esri World Imagery | Esri attribution: "Esri, Maxar, Earthstar Geographics" |
| Roads, buildings, street furniture | OpenStreetMap through the Overpass API (overpass-api.de and mirrors) | ODbL, "© OpenStreetMap contributors" |
| Roads and buildings when Overpass is slow | OpenFreeMap vector tiles (OpenMapTiles schema) | OpenStreetMap data, ODbL; free with no key |
| Buildings: heights, floors, roof shapes, colours and footprints OSM lacks (`js/overture.js`, `js/overworker.js`) | Overture Maps Foundation, buildings theme, read from the release's own PMTiles archive (overturemaps-extras-us-west-2 on S3, the latest release from stac.overturemaps.org) | Theme licence ODbL (checked on docs.overturemaps.org/attribution on 2026-10-26); it merges OpenStreetMap (ODbL), Microsoft Global ML Building Footprints (ODbL), Google Open Buildings (CC BY 4.0) and Shi et al.'s East Asia buildings (CC BY 4.0). Credited as "Overture Maps Foundation, © OpenStreetMap contributors, Microsoft, Google" |
| Shop fronts (which ground floors are shops) | OpenStreetMap shop, cafe, pub and bank points (Overpass), or OpenFreeMap's poi layer | ODbL, "© OpenStreetMap contributors" |

## Code

three.js r180 (MIT), 3DTilesRendererJS 0.5.3 (Apache 2.0, NASA-AMMOS), three-mesh-bvh 0.9.1 (MIT), Leaflet 1.9.4
(BSD-2-Clause); licences in `vendor/*/LICENSE.txt`.

## Road textures (`textures/roads/`, used by `js/roads.js`)

Downloaded from Poly Haven at 1K, JPG, unchanged (the asphalt colour, tyre tracks, worn paint, pavement joints and
the curb's lighter grey are added at run time in the shaders). Licence checked on each asset's page on 2026-10-19.

| File | Asset | Author | Source | Licence |
|---|---|---|---|---|
| `textures/roads/clean_asphalt_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_rough_1k.jpg` | Clean Asphalt | Dimitrios Savva | https://polyhaven.com/a/clean_asphalt | CC0 |
| `textures/roads/concrete_floor_02_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_rough_1k.jpg` | Concrete Floor 02 | Rob Tuytel | https://polyhaven.com/a/concrete_floor_02 | CC0 |

Road layout, lanes, crossings, signals and signs: OpenStreetMap data, (c) OpenStreetMap contributors, ODbL,
fetched at run time through the Overpass API (`js/osm.js`); nothing is stored in the repo.

## People (`models/people/`, used by `js/people.js`, `js/person.js`, `js/poses.js`, `js/peds.js`, `js/lookui.js`)

| What | Source | Author | Licence |
|---|---|---|---|
| 41 rigged people (`models/people/*.glb`: adults of both sexes in many outfits, and children) | Microsoft Rocketbox Avatar Library, https://github.com/microsoft/Microsoft-Rocketbox (`Assets/Avatars/Adults`, `Children`, `Professions`) | Microsoft Research and the Rocketbox team (Markus Wojcik and others) | MIT (`LICENSE.md` in the repository, checked 2026-10-21): "Copyright (c) 2020 Microsoft" |
| 65 motion-captured clips (`models/people/anims.bin`: idles, walks, runs, angry gestures, waving, phone, talking, sitting down and standing up, crouching, opening a door...) | the same repository, `Assets/Animations` | Microsoft Research / Rocketbox | MIT |

What we changed: each avatar's FBX was converted in Blender 4.1 (the high detail mesh, about 7 to 9k triangles, and a
decimated copy at about 1.5 to 2k for distance; the children's `Bip02` bones renamed `Bip01` so one set of clips
drives everyone; Draco compression), textures cut from 2048 TGA to 1024 JPG (colour), 512 JPG (normal), 256 JPG
(roughness from the specular map) and 512 PNG (hair). The clips were resampled (10 to 30 frames a second), cut to
loop, reduced to the body's bones and packed into one file; the region masks (`*_m.png`, `*_h.png`) that let shirts,
trousers, shoes, hair and skin take other colours were made here from the meshes' UVs and bone weights. The clips for
driving, a fist, pointing, crossed arms, jumping, stumbling, lying down, getting up, getting in and out of a seat and
being pulled out are made at run time from these poses (`js/poses.js`). Three avatars (Business_Female_01,
Construction_Male_01, Female_Adult_04) are not included (Blender's importer failed on them).

MIT licence text for the Rocketbox files:

> Copyright (c) 2020 Microsoft. Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
> conditions: The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
