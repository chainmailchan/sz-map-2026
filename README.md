# sz-map-2026

Personal Shenzhen trip map (Nov 2026). Static site on GitHub Pages: Leaflet on Amap (AutoNavi) tiles.

- Places live in `data/places.json`. Coordinates are **GCJ-02** (Amap's system), taken from Amap place pages, so they line up with Amap tiles.
- Phone GPS (WGS-84) is converted to GCJ-02 in `app.js` before the blue "you are here" dot is drawn.
- Leaflet 1.9.4 is vendored in `vendor/leaflet` (BSD-2-Clause, see its LICENSE).
- The Amap tile URLs are not an official, documented Amap service and could change without notice.
