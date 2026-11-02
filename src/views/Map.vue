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
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue';

const props = defineProps({
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
});

const emit = defineEmits(['mounted', 'loaded']);

const map = shallowRef(null);
const container = useTemplateRef('container');

onMounted(() => {
  map.value = new Map({
    container: container.value,
    accessToken: env.mapboxAccessToken,
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    projection: 'mercator',
    antialias: true,
    ...props,
  });

  map.value.dragRotate.disable();
  map.value.touchZoomRotate.disableRotation();
  map.value.touchPitch.disable();

  emit('mounted', map.value);

  map.value.once('load', (event) => {
    onLoaded(event.target);
  });
});

useResizeObserver(container, () => {
  map.value?.resize();
});

onBeforeUnmount(() => {
  map.value?.remove();
  map.value = null;
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
