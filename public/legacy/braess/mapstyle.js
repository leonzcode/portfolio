'use strict';
/* The base map: OpenFreeMap's OpenStreetMap vector tiles (OpenMapTiles
   schema), drawn in a light style of our own made to read like the road map
   people know from big map apps: grey land, blue water, green parks, white
   streets with soft casings, yellow motorways, grey labels with white halos.
   No other map's files are used. The satellite view is Esri World Imagery. */
(function (root) {
  const C = {
    land: '#f3f3f1', urban: '#efeeeb', water: '#9ccdf3', waterLine: '#9ccdf3', waterText: '#3e6fa6',
    park: '#c8e8c4', wood: '#bfe1b7', sand: '#f4edd5', ice: '#ffffff', hospital: '#f9e3e1', school: '#efeadd', industrial: '#ecebe6',
    building: '#e7e6e3', buildingLine: '#dcdbd7',
    motorway: '#fcd47a', motorwayCase: '#e4b04f', trunk: '#fde39d', trunkCase: '#ebc574',
    major: '#ffffff', majorCase: '#d8d8d6', minor: '#ffffff', minorCase: '#dfdfdc', service: '#ffffff',
    rail: '#c7c7c4', path: '#d9d9d6', text: '#5f6368', textStrong: '#3c4043', halo: '#ffffff', boundary: '#a8a8a3',
  };
  const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const F = { reg: ['Noto Sans Regular'], bold: ['Noto Sans Bold'], ital: ['Noto Sans Italic'] };
  // a road width that doubles every zoom level or so
  const w = (z0, w0, z1, w1) => ['interpolate', ['exponential', 1.5], ['zoom'], z0, w0, z1, w1];
  const cls = list => ['match', ['get', 'class'], list, true, false];
  const roads = [];
  const road = (id, filter, color, width, minzoom, opts) => roads.push(Object.assign({
    id, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: minzoom || 0,
    filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width },
  }, opts || {}));
  const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
  // casings first, then fills, from small roads to motorways
  road('road-service-case', ['all', cls(['service', 'track']), notTunnel], C.minorCase, w(14, 1.5, 20, 12), 14);
  road('road-minor-case', ['all', cls(['minor']), notTunnel], C.minorCase, w(12, 0.8, 20, 22), 12);
  road('road-major-case', ['all', cls(['secondary', 'tertiary']), notTunnel], C.majorCase, w(8, 0.8, 20, 30), 8);
  road('road-primary-case', ['all', cls(['primary']), notTunnel], C.majorCase, w(7, 1, 20, 34), 7);
  road('road-trunk-case', ['all', cls(['trunk']), notTunnel], C.trunkCase, w(5, 1, 20, 36), 5);
  road('road-motorway-case', ['all', cls(['motorway']), notTunnel], C.motorwayCase, w(4, 1, 20, 38), 4);
  road('road-path', cls(['path']), C.path, w(15, 0.6, 20, 3), 15, { paint: { 'line-color': C.path, 'line-width': w(15, 0.6, 20, 3), 'line-dasharray': [2, 1.5] } });
  road('road-service', ['all', cls(['service', 'track']), notTunnel], C.service, w(14, 0.8, 20, 10), 14);
  road('road-minor', ['all', cls(['minor']), notTunnel], C.minor, w(12, 0.4, 20, 19), 12);
  road('road-major', ['all', cls(['secondary', 'tertiary']), notTunnel], C.major, w(8, 0.4, 20, 26), 8);
  road('road-primary', ['all', cls(['primary']), notTunnel], C.major, w(7, 0.6, 20, 30), 7);
  road('road-trunk', ['all', cls(['trunk']), notTunnel], C.trunk, w(5, 0.6, 20, 32), 5);
  road('road-motorway', ['all', cls(['motorway']), notTunnel], C.motorway, w(4, 0.7, 20, 34), 4);
  road('rail', cls(['rail', 'transit']), C.rail, w(10, 0.5, 20, 2.5), 10);

  const style = {
    version: 8,
    name: 'Braess light',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': C.land } },
      { id: 'landuse-urban', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls(['residential', 'suburb', 'neighbourhood', 'commercial', 'retail']), paint: { 'fill-color': C.urban } },
      { id: 'landuse-industrial', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls(['industrial', 'railway', 'garages']), paint: { 'fill-color': C.industrial } },
      { id: 'landuse-hospital', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls(['hospital']), paint: { 'fill-color': C.hospital } },
      { id: 'landuse-school', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls(['school', 'university', 'college']), paint: { 'fill-color': C.school } },
      { id: 'landcover-wood', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls(['wood', 'forest']), paint: { 'fill-color': C.wood } },
      { id: 'landcover-grass', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls(['grass', 'farmland', 'wetland']), paint: { 'fill-color': C.park, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1] } },
      { id: 'landcover-sand', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls(['sand']), paint: { 'fill-color': C.sand } },
      { id: 'landcover-ice', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls(['ice']), paint: { 'fill-color': C.ice } },
      { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.8 } },
      { id: 'landuse-park', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls(['park', 'cemetery', 'stadium', 'pitch', 'playground']), paint: { 'fill-color': C.park } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': C.waterLine, 'line-width': w(8, 0.5, 18, 6) } },
      { id: 'aeroway', type: 'fill', source: 'ofm', 'source-layer': 'aeroway', minzoom: 11, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e8e8ef' } },
      { id: 'building', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1] } },
      { id: 'boundary-country', type: 'line', source: 'ofm', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': C.boundary, 'line-width': w(2, 0.6, 10, 1.6) } },
      { id: 'boundary-state', type: 'line', source: 'ofm', 'source-layer': 'boundary', minzoom: 4, filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': C.boundary, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'satellite', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
    ].concat(roads, [
      // (the simulated traffic goes in here, above the streets and below every label)
      { id: 'water-name', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', filter: ['!=', ['geometry-type'], 'LineString'], layout: { 'text-field': NAME, 'text-font': F.ital, 'text-size': 13 }, paint: { 'text-color': C.waterText, 'text-halo-color': C.halo, 'text-halo-width': 1 } },
      { id: 'water-name-line', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'text-field': NAME, 'text-font': F.ital, 'text-size': 13, 'symbol-placement': 'line' }, paint: { 'text-color': C.waterText, 'text-halo-color': C.halo, 'text-halo-width': 1 } },
      { id: 'road-label', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 13,
        filter: cls(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']),
        layout: { 'text-field': NAME, 'text-font': F.reg, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13], 'symbol-placement': 'line', 'text-letter-spacing': 0.02, 'text-max-angle': 30 },
        paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
      { id: 'road-shield', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 7, maxzoom: 13,
        filter: ['all', cls(['motorway', 'trunk']), ['has', 'ref']],
        layout: { 'text-field': ['get', 'ref'], 'text-font': F.bold, 'text-size': 10, 'symbol-placement': 'line', 'symbol-spacing': 400 },
        paint: { 'text-color': '#7a5a10', 'text-halo-color': '#fff6d8', 'text-halo-width': 2 } },
      { id: 'place-suburb', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 12, maxzoom: 17, filter: cls(['suburb', 'neighbourhood', 'quarter']),
        layout: { 'text-field': NAME, 'text-font': F.reg, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
        paint: { 'text-color': '#7b7f83', 'text-halo-color': C.halo, 'text-halo-width': 1.2 } },
      { id: 'place-town', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 8, maxzoom: 15, filter: cls(['town', 'village']),
        layout: { 'text-field': NAME, 'text-font': F.reg, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 14] },
        paint: { 'text-color': C.textStrong, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
      { id: 'place-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 4, maxzoom: 14, filter: cls(['city']),
        layout: { 'text-field': NAME, 'text-font': F.reg, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 18], 'symbol-sort-key': ['get', 'rank'] },
        paint: { 'text-color': C.textStrong, 'text-halo-color': C.halo, 'text-halo-width': 1.8 } },
      { id: 'place-state', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 4, maxzoom: 7, filter: cls(['state']),
        layout: { 'text-field': NAME, 'text-font': F.reg, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 },
        paint: { 'text-color': '#8a8d91', 'text-halo-color': C.halo, 'text-halo-width': 1.2 } },
      { id: 'place-country', type: 'symbol', source: 'ofm', 'source-layer': 'place', maxzoom: 7, filter: cls(['country']),
        layout: { 'text-field': NAME, 'text-font': F.bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 15], 'text-max-width': 7 },
        paint: { 'text-color': '#555a5f', 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
    ]),
  };
  root.BRAESS_MAP_STYLE = style;
  root.BRAESS_MAP_COLORS = C;
})(typeof window !== 'undefined' ? window : this);
