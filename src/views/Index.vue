<template>
  <Map
    class="bg-shade-6 size-full"
    :center="location ?? leipzig"
    :zoom="10"
    @mounted="onMapMounted"
    @loaded="onMapLoaded"
  />
</template>

<script setup>
import { useLocation } from '@/composables/useLocation';
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { useSettingsStore } from '@/stores/settings';
import { poiToGeoJson, wayToGeoJson } from '@/utils/geoJson';
import Map from '@/views/Map.vue';
import MapLegend from '@/views/MapLegend.vue';
import MapToolbar from '@/views/MapToolbar.vue';
import * as turf from '@turf/turf';
import axios from 'axios';
import { createElement, MapPin } from 'lucide';
import { Marker, Popup, ScaleControl } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { createApp, watch, watchEffect } from 'vue';

const { settings } = storeToRefs(useSettingsStore());
const { location } = useLocation();

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

const createControl = (component) => {
  return {
    onAdd(map) {
      this.div = document.createElement('div');
      this.div.classList.add('mapboxgl-ctrl');
      this.app = createApp(component, { map });
      this.app.mount(this.div);
      return this.div;
    },

    onRemove() {
      this.app.unmount();
      this.div.remove();
    },
  };
};

const onMapMounted = (map) => {
  map.addControl(createControl(MapToolbar), 'top-left');
  map.addControl(createControl(MapLegend), 'bottom-left');
  map.addControl(new ScaleControl(), 'bottom-left');

  const initMarker = (coordinates) => {
    map.setCenter(coordinates);

    const element = createElement(MapPin);
    element.classList.add('size-8');
    element.classList.add('text-shade-8');
    element.classList.add('fill-shade-2');

    const marker = new Marker({ element });
    marker.setLngLat(coordinates);
    marker.addTo(map);

    watch(location, (coordinates) => {
      marker.setLngLat(coordinates);
    });
  };

  if (location.value) {
    initMarker(location.value);
  } else {
    watch(location, initMarker, { once: true });
  }
};

const satelliteUrl = (lat, lng, zoom = 21) => {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'map',
    center: `${lat},${lng}`,
    zoom: String(zoom),
    basemap: 'satellite',
  });
  return `https://www.google.com/maps/@?${params}`;
};

const onMapLoaded = (map) => {
  const ids = [];
  for (const poi of Object.keys(pois)) {
    for (const country of Country.$values) {
      ids.push(`${poi}/${country}`);
    }
  }

  map.on('click', ids, (event) => {
    onPoiClick(event);
  });

  map.on('mouseenter', ids, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', ids, () => {
    map.getCanvas().style.cursor = '';
  });

  const pending = new window.Map();

  const load = async (id, type, color, url) => {
    const controller = new AbortController();
    pending.set(id, controller);

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        signal: controller.signal,
      });

      const source = {
        type: 'geojson',
        data: type === 'poi'
          ? await poiToGeoJson(response.data)
          : await wayToGeoJson(response.data), // prettier-ignore
      };

      if (controller.signal.aborted) {
        return;
      }

      if (type === 'poi') {
        map.addLayer(
          {
            id,
            type: 'circle',
            source,
            paint: {
              'circle-color': color,
              'circle-radius': {
                stops: [
                  [6, 1],
                  [18, 16],
                ],
              },
            },
          },
          `${id}-order`,
        );
      } else {
        map.addLayer(
          {
            id,
            type: 'line',
            source,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': color,
              'line-width': {
                stops: [
                  [6, 0.5],
                  [18, 8],
                ],
              },
            },
          },
          `${id}-order`,
        );
      }
    } catch (error) {
      if (!axios.isCancel(error)) {
        throw error;
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.delete(id);
      }
    }
  };

  watchEffect(() => {
    for (const [poi, { type, color, urls }] of Object.entries(pois)) {
      for (const country of Country.$values) {
        const id = `${poi}/${country}`;

        if (!(settings.value[poi] && settings.value[country])) {
          pending.get(id)?.abort();
          pending.delete(id);

          if (map.getLayer(id)) {
            map.removeLayer(id);
          }
          if (map.getSource(id)) {
            map.removeSource(id);
          }
          continue;
        }

        if (pending.has(id) || map.getLayer(id)) {
          continue;
        }

        load(id, type, color, urls[country]);
      }
    }
  });
};

const onPoiClick = (event) => {
  const feature = event.features[0];

  const coordinates = (
    feature.geometry.type === 'LineString'
      ? turf.nearestPointOnLine(feature, turf.point([event.lngLat.lng, event.lngLat.lat]))
      : feature
  ).geometry.coordinates;

  const popup = new Popup({ closeButton: false });
  popup.setLngLat(coordinates);
  popup.setHTML(`
      <a href="${satelliteUrl(coordinates[1], coordinates[0])}" target="_blank" class="underline">
        ${feature.properties.name || pois[feature.layer.id.split('/')[0]].name}
      </a>
      ${feature.properties.openingHours ? `<br>Opening hours: ${feature.properties.openingHours}` : ''}
    `);

  popup.addTo(event.target);
};
</script>
