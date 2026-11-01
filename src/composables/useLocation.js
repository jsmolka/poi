import { createSharedComposable, useGeolocation } from '@vueuse/core';
import { computed } from 'vue';

export const useLocation = createSharedComposable(() => {
  const { coords, isSupported } = useGeolocation();

  const location = computed(() => {
    if (!isSupported.value) {
      return null;
    }

    const { latitude, longitude } = coords.value;
    if (!(Number.isFinite(latitude) && Number.isFinite(longitude))) {
      return null;
    }

    return {
      lat: latitude,
      lng: longitude,
    };
  });

  return { location };
});
