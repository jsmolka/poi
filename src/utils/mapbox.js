import { roundTo } from '@/utils/numeric';
import toGeoJSON from '@mapbox/togeojson';

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}

export function intersects(viewport, bounds) {
  if (bounds.getNorth() < viewport.getSouth() || bounds.getSouth() > viewport.getNorth()) {
    return false;
  }

  const viewportWest = viewport.getWest();
  const viewportEastRaw = viewport.getEast();
  const viewportEast = viewportEastRaw < viewportWest ? viewportEastRaw + 360 : viewportEastRaw;
  const viewportCenter = (viewportWest + viewportEast) / 2;
  if (viewportEast - viewportWest >= 360) {
    return true;
  }

  const boundsWest = bounds.getWest();
  const boundsEast = bounds.getEast();
  const boundsCenter = (boundsWest + boundsEast) / 2;
  const nearestWorldOffset = roundTo(viewportCenter - boundsCenter, 360);
  return (
    boundsEast + nearestWorldOffset >= viewportWest &&
    boundsWest + nearestWorldOffset <= viewportEast
  );
}

const locks = new WeakMap();

export function lockDoubleClickZoom(map) {
  let lock = locks.get(map);
  if (lock == null) {
    lock = { count: 0, wasEnabled: map.doubleClickZoom.isEnabled() };
    locks.set(map, lock);
    map.doubleClickZoom.disable();
  }

  lock.count++;

  let released = false;
  return () => {
    if (released) {
      return;
    }

    released = true;
    lock.count--;
    if (lock.count === 0) {
      if (lock.wasEnabled) {
        map.doubleClickZoom.enable();
      }
      locks.delete(map);
    }
  };
}
