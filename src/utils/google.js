export function satelliteUrl(lngLat, zoom = 21) {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'map',
    center: `${lngLat[1]},${lngLat[0]}`,
    zoom: String(zoom),
    basemap: 'satellite',
  });
  return `https://www.google.com/maps/@?${params}`;
}
