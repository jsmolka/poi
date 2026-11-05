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
import { useDeck } from '@/composables/useDeck';
import { useLocation } from '@/composables/useLocation';
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { useSettingsStore } from '@/stores/settings';
import Map from '@/views/Map.vue';
import MapLegend from '@/views/MapLegend.vue';
import MapToolbar from '@/views/MapToolbar.vue';
import { decode, decompress } from '@common/codec';
import axios from 'axios';
import { createElement, MapPin } from 'lucide';
import { Marker, ScaleControl } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { computed, createApp, watch } from 'vue';

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

const onMapLoaded = (map) => {
  const { addLayerPoi, addLayerWay, removeLayer } = useDeck(map);

  for (const [poi, { type, name, color, urls }] of Object.entries(pois)) {
    const addLayer = type === 'poi' ? addLayerPoi : addLayerWay;

    for (const country of Country.$values) {
      const id = `${poi}/${country}`;

      watch(
        computed(() => settings.value[poi] && settings.value[country]),
        async (enabled, _, onCleanup) => {
          if (!enabled) {
            return;
          }

          const controller = new AbortController();
          onCleanup(() => {
            controller.abort();
            removeLayer(id);
          });

          try {
            const response = await axios.get(urls[country], {
              responseType: 'arraybuffer',
              signal: controller.signal,
            });

            const { positions, startIndices, metadata } = decode(await decompress(response.data));
            if (controller.signal.aborted) {
              return;
            }

            addLayer({ id, name, color, positions, startIndices, metadata });
          } catch (error) {
            if (!axios.isCancel(error)) {
              throw error;
            }
          }
        },
        { immediate: true },
      );
    }
  }
};
</script>
