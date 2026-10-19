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

The licences cover the 3D models only. Car makers' names, badges and designs may be trademarks of their owners;
the models are fan-made and not endorsed by Volvo, Porsche or General Motors.

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
