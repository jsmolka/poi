import { onEvent } from '@/utils/event';
import { onScopeDispose } from 'vue';

export function useEvent(target, event, callback) {
  onScopeDispose(onEvent(target, event, callback));
}
