<template>
  <div ref="container" class="h-full" />
</template>

<script setup>
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { pairs } from '@/utils/iterator';
import { useResizeObserver } from '@vueuse/core';
import { Map } from 'mapbox-gl';
import { onMounted, useTemplateRef } from 'vue';

const props = defineProps({
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
});

const emit = defineEmits(['mounted', 'loaded']);
const container = useTemplateRef('container');

onMounted(() => {
  const map = new Map({
    container: container.value,
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    projection: 'mercator',
    antialias: true,
    hash: true,
    ...props,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();

  useResizeObserver(container, () => {
    map.resize();
  });

  emit('mounted', map);

  map.once('load', () => {
    const text = map.getStyle().layers.find((layer) => {
      return layer.type === 'symbol';
    });

    const ids = [text.id];
    for (const poi of Object.keys(pois)) {
      for (const country of Country.$values) {
        ids.push(`${poi}/${country}-anchor`);
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

    emit('loaded', map);
  });
});
</script>
