<template>
  <div ref="container" class="h-full" />
</template>

<script setup>
import { useDeck } from '@/composables/useDeck';
import { useLocation } from '@/composables/useLocation';
import { useMap } from '@/composables/useMap';
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { useSettingsStore } from '@/stores/settings';
import { pairs } from '@/utils/iterator';
import MapLegend from '@/views/MapLegend.vue';
import MapToolbar from '@/views/MapToolbar.vue';
import { decode, decompress } from '@common/codec';
import { whenever } from '@vueuse/core';
import axios from 'axios';
import { createElement, MapPin } from 'lucide';
import { AttributionControl, Marker, ScaleControl } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { computed, effectScope, onScopeDispose, useTemplateRef, watch, watchEffect } from 'vue';

const { location } = useLocation();
const { settings } = storeToRefs(useSettingsStore());
const { map, createControl } = useMap(useTemplateRef('container'));

const scope = effectScope();

whenever(map, (map) => {
  scope.run(() => {
    initToolbar(map);
    initMarker(map);
    initAnchors(map);
    initLayers(map);
  });
});

const initToolbar = (map) => {
  for (const { control, position } of [
    { control: createControl(MapToolbar), position: 'top-left' },
    { control: createControl(MapLegend), position: 'bottom-left' },
    { control: new ScaleControl(), position: 'bottom-left' },
    { control: new AttributionControl({ compact: true }), position: 'bottom-right' },
  ]) {
    map.addControl(control, position);

    onScopeDispose(() => map.removeControl(control));
  }
};

const initMarker = (map) => {
  let marker;

  watchEffect(() => {
    if (location.value == null) {
      return;
    }

    if (marker == null) {
      const element = createElement(MapPin);
      element.classList.add('size-8', 'text-shade-8', 'fill-shade-2');
      marker = new Marker({ element }).setLngLat(location.value).addTo(map);
    } else {
      marker.setLngLat(location.value);
    }
  });

  onScopeDispose(() => {
    marker?.remove();
    marker = null;
  });
};

const initAnchors = (map) => {
  const text = map.getStyle().layers.find((layer) => {
    return layer.type === 'symbol';
  });

  const ids = [text.id];
  for (const poi of Object.keys(pois)) {
    for (const country of Country.$values) {
      ids.push(`${poi}-${country}-anchor`);
    }
  }

  ids.push('route-anchor');

  for (const [previousId, id] of pairs(ids)) {
    map.addLayer(
      {
        id,
        type: 'background',
        layout: { visibility: 'none' },
      },
      previousId,
    );
  }
};

const initLayers = (map) => {
  const { addLayerPoi, addLayerWay, removeLayer } = useDeck(map);

  for (const [poi, { type, name, color, urls }] of Object.entries(pois)) {
    const addLayer = type === 'poi' ? addLayerPoi : addLayerWay;

    for (const country of Country.$values) {
      const id = `${poi}-${country}`;

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

            addLayer({
              id,
              name,
              color,
              positions,
              startIndices,
              metadata,
              beforeId: `${id}-anchor`,
            });
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
