import { useLocation } from '@/composables/useLocation';
import { useResizeObserver, whenever } from '@vueuse/core';
import { Map } from 'mapbox-gl';
import { getCurrentInstance, h, onMounted, onUnmounted, render, shallowRef } from 'vue';

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

const mapHashRe = /^#(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/;

export function useMap(container) {
  const hasMapHash = () => {
    return mapHashRe.test(window.location.hash);
  };

  const restoredFromHash = hasMapHash();

  const map = shallowRef(null);

  onMounted(() => {
    const instance = new Map({
      container: container.value,
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
      projection: 'mercator',
      antialias: true,
      hash: true,
      center: location.value ?? leipzig,
      zoom: 10,
    });

    instance.dragRotate.disable();
    instance.touchZoomRotate.disableRotation();
    instance.touchPitch.disable();

    instance.once('load', () => {
      map.value = instance;
    });
  });

  onUnmounted(() => {
    map.value?.remove();
    map.value = null;
  });

  useResizeObserver(container, () => {
    map.value?.resize();
  });

  const { location } = useLocation();

  whenever(
    () => map.value && location.value && !restoredFromHash,
    () => map.value.panTo(location.value),
    { immediate: true, once: true },
  );

  const appContext = getCurrentInstance()?.appContext;

  const createControl = (component, props = {}) => {
    let element;

    return {
      onAdd(map) {
        element = document.createElement('div');
        element.classList.add('mapboxgl-ctrl');

        const vnode = h(component, { ...props, map });
        vnode.appContext = appContext;
        render(vnode, element);

        return element;
      },

      onRemove() {
        render(null, element);
        element.remove();
        element = null;
      },
    };
  };

  return { map, createControl };
}
