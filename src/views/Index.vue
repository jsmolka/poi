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
import { addDataLayer, layers } from '@/modules/layers';
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

const onMapLoaded = (map) => {
  const ids = Object.keys(layers);
  map.on('mouseenter', ids, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', ids, () => (map.getCanvas().style.cursor = ''));

  map.on('click', ids, (event) => {
    const feature = event.features[0];

    const popup = new Popup({ closeButton: false });
    popup.setLngLat(
      (feature.geometry.type === 'LineString'
        ? turf.nearestPointOnLine(feature, turf.point([event.lngLat.lng, event.lngLat.lat]))
        : feature
      ).geometry.coordinates,
    );
    popup.setHTML(
      [
        feature.properties.name ?? layers[feature.layer.id].name,
        feature.properties.openingHours ? `Opening hours: ${feature.properties.openingHours}` : '',
        feature.properties.smoothness ? `Smoothness: ${feature.properties.smoothness}` : '',
      ]
        .filter(Boolean)
        .join('<br>'),
    );
    popup.addTo(map);
  });

  watchEffect(() => {
    for (const [id, layer] of Object.entries(layers)) {
      const visible = settings.value[id];
      if (visible && map.getLayer(id) == null) {
        switch (layer.type) {
          case 'poi':
            addDataLayer(map, {
              id,
              type: 'circle',
              source: {
                type: 'geojson',
                data: null,
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
            });
            axios.get(layer.url).then((response) => {
              map.getSource(id).setData(poiToGeoJson(response.data));
            });
            break;

          case 'way':
            addDataLayer(map, {
              id,
              type: 'line',
              source: {
                type: 'geojson',
                data: null,
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': layer.color, 'line-width': 5 },
            });
            axios.get(layer.url).then((response) => {
              map.getSource(id).setData(wayToGeoJson(response.data));
            });
            break;
        }
      }

      if (map.getLayer(id) != null) {
        map.setLayoutProperty(id, 'visibility', settings.value[id] ? 'visible' : 'none');
      }
    }
  });
};
</script>
