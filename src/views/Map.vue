<template>
  <div ref="container" />
</template>

<script setup>
import { env } from '@/common/env';
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { pairs } from '@/utils/iterator';
import { useResizeObserver } from '@vueuse/core';
import { Map } from 'mapbox-gl';
import { onMounted, onUnmounted, useTemplateRef } from 'vue';

const props = defineProps({
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
});

const emit = defineEmits(['mounted', 'loaded']);

const container = useTemplateRef('container');

onMounted(() => {
  const map = new Map({
    accessToken: env.mapboxAccessToken,
    container: container.value,
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    ...props,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();

  emit('mounted', map);

  map.on('load', () => {
    onLoaded(map);
  });

  useResizeObserver(container, () => {
    map.resize();
  });

  onUnmounted(() => {
    map.remove();
  });
});

const onLoaded = (map) => {
  const text = map.getStyle().layers.find((layer) => {
    return layer.type === 'symbol';
  });

  const ids = [text.id];
  for (const poi of Object.keys(pois)) {
    for (const country of Country.$values) {
      ids.push(`${poi}/${country}-order`);
    }
  }

  ids.push('route-order');

  for (const [beforeId, id] of pairs(ids)) {
    map.addLayer(
      {
        id,
        type: 'background',
        layout: { visibility: 'none' },
      },
      beforeId,
    );
  }

  emit('loaded', map);
};
</script>
