<template>
  <div ref="container" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
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
    accessToken: mapboxAccessToken,
    container: container.value,
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    center: props.center,
    zoom: props.zoom,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();

  map.addDataLayer = function (layer) {
    const symbolLayer = map.getStyle().layers.find(({ type }) => type === 'symbol');
    return this.addLayer(layer, symbolLayer.id);
  };

  emit('mounted', map);
  map.on('load', () => {
    emit('loaded', map);
  });

  useResizeObserver(container, () => {
    map.resize();
  });

  onUnmounted(() => {
    map.remove();
  });
});
</script>
