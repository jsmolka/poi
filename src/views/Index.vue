<template>
  <div id="map" class="h-full bg-shade-6" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import cemeteries from '@/data/cemeteries.json';
import gasStations from '@/data/gasStations.json';
import { colors } from '@/utils/colors';
import { scale } from '@/utils/scale';
import Legend from '@/views/Legend.vue';
import LocationMarker from '@/views/LocationMarker.vue';
import { useGeolocation, watchOnce } from '@vueuse/core';
import { Map, Marker, Popup, ScaleControl } from 'mapbox-gl';
import { computed, createApp, onMounted, watch } from 'vue';

const { coords, isSupported } = useGeolocation();

const location = computed(() => {
  if (!isSupported.value) {
    return null;
  }
  const { latitude, longitude } = coords.value;
  if (latitude == null || latitude == Infinity || longitude == null || longitude == Infinity) {
    return null;
  }
  return {
    lat: latitude,
    lng: longitude,
  };
});

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

const center = computed(() => {
  return location.value ?? leipzig;
});

let map = null;

const mount = (component, props = {}) => {
  const div = document.createElement('div');
  const app = createApp(component, props);
  app.mount(div);
  return div;
};

onMounted(() => {
  map = new Map({
    accessToken: mapboxAccessToken,
    container: 'map',
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    center: center.value,
    zoom: 10,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  map.addControl(
    {
      onAdd() {
        const div = mount(Legend);
        div.className = 'mapboxgl-ctrl';
        return div;
      },
    },
    'bottom-left',
  );
  map.addControl(new ScaleControl());

  const stops = [
    [6, 1],
    [18, 16],
  ];

  watchOnce(location, (latLng) => {
    map.setCenter(latLng);

    const marker = new Marker(mount(LocationMarker));
    marker.setLngLat(latLng);
    marker.addTo(map);

    watch(location, (latLng) => {
      marker.setLngLat(latLng);
    });

    const scaleMarker = () => {
      const element = marker.getElement().children[0];
      element.style.transformOrigin = 'center';
      element.style.transform = `scale(${scale(
        map.getZoom(),
        stops[0][0],
        stops[1][0],
        1 / 32,
        1,
      )})`;
    };
    scaleMarker();
    map.on('zoom', scaleMarker);
  });

  map.on('load', () => {
    const createSource = (places) => ({
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: places.map((place) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [place.lng, place.lat],
          },
          properties: {
            place,
          },
        })),
      },
    });

    map.addSource('gasStations', createSource(gasStations));
    map.addSource('cemeteries', createSource(cemeteries));

    const createLayer = (id, color) => ({
      id,
      type: 'circle',
      source: id,
      paint: {
        'circle-color': color,
        'circle-radius': { stops },
      },
    });

    map.addLayer(createLayer('gasStations', colors.shade2.hex));
    map.addLayer(createLayer('cemeteries', colors.red.hex));

    const layers = ['gasStations', 'cemeteries'];

    map.on('mouseenter', layers, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', layers, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', layers, (event) => {
      const coordinates = event.features[0].geometry.coordinates;
      const place = JSON.parse(event.features[0].properties.place);

      const popup = new Popup({ closeButton: false });
      popup.setLngLat(coordinates);
      popup.setHTML(place.name);
      popup.addTo(map);
    });
  });
});
</script>

<style lang="scss">
.mapboxgl-ctrl-scale {
  @apply bg-shade-5;
  @apply text-shade-2;
  @apply border-none;
  @apply rounded-sm;
}

.mapboxgl-popup-content {
  @apply px-2;
  @apply py-1.5;
  @apply bg-shade-5;
  @apply text-shade-2;
  @apply rounded-sm;
}

.mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip {
  @apply border-t-shade-5;
}
</style>
