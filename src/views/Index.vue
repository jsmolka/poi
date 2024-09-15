<template>
  <Map
    class="h-full bg-shade-6"
    :center="location ?? leipzig"
    :zoom="10"
    @loaded="onMapLoaded"
    @mounted="onMapMounted"
  />
</template>

<script setup>
import { useLocation } from '@/composables/useLocation';
import { layers } from '@/modules/layers';
import { useSettingsStore } from '@/stores/settings';
import { dataToGeoJson } from '@/utils/geoJson';
import Map from '@/views/Map.vue';
import MapLegend from '@/views/MapLegend.vue';
import MapToolbar from '@/views/MapToolbar.vue';
import * as turf from '@turf/turf';
import axios from 'axios';
import { createElement, MapPin } from 'lucide';
import { Marker, Popup, ScaleControl } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { createApp, watch } from 'vue';

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
  const ids = Object.keys(layers);

  map.on('mouseenter', ids, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', ids, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('click', ids, (event) => {
    const feats = event.features[0];
    const layer = layers[feats.layer.id];
    const props = feats.properties;

    const popup = new Popup({ closeButton: false });
    popup.setLngLat(feats.geometry.coordinates);
    popup.setHTML(
      (props.name || layer.text) +
        (props.openingHours ? `<br>Opening hours: ${props.openingHours}` : ''),
    );
    popup.addTo(map);
  });

  const symbol = map.getStyle().layers.find(({ type }) => type === 'symbol');
  const updateLayers = () => {
    for (const [id, layer] of Object.entries(layers)) {
      const visible = settings.value[id];
      if (visible && map.getLayer(id) == null) {
        map.addLayer(
          {
            id,
            type: 'circle',
            source: {
              type: 'geojson',
              data: turf.featureCollection([]),
            },
            paint: {
              'circle-color': layer.color,
              'circle-radius': {
                stops: [
                  [6, 1],
                  [18, 16],
                ],
              },
            },
          },
          symbol.id,
        );

        (async () => {
          const response = await axios.get(layer.url);
          map.getSource(id).setData(dataToGeoJson(response.data));
        })();
      }
      if (map.getLayer(id) != null) {
        map.setLayoutProperty(id, 'visibility', settings.value[id] ? 'visible' : 'none');
      }
    }
  };
  watch(settings, updateLayers, { deep: true, immediate: true });
};
</script>
