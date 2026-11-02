export function useEvent(target, event, callback) {
  if (target instanceof EventTarget) {
    target.addEventListener(event, callback);
    return () => target.removeEventListener(event, callback);
  } else {
    target.on(event, callback);
    return () => target.off(event, callback);
  }
}
