import TilerWorker from '@/modules/tiler.worker.js?worker';

export class Tiler {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.worker = new TilerWorker();
    this.worker.onmessage = ({ data }) => {
      const resolve = this.pending.get(data.id);
      if (resolve != null) {
        this.pending.delete(data.id);
        resolve(data);
      }
    };
  }

  init(data, transfer) {
    const key = this.id++;
    this.worker.postMessage({ type: 'init', key, ...data }, transfer);
    return key;
  }

  async tile(key, bbox, tileSize, zoom, maxZoom, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const id = this.id++;
      this.pending.set(id, resolve);
      signal.addEventListener(
        'abort',
        () => {
          if (this.pending.delete(id)) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        },
        { once: true },
      );

      this.worker.postMessage({ type: 'tile', key, id, bbox, tileSize, zoom, maxZoom });
    });
  }

  dispose(key) {
    this.worker.postMessage({ type: 'dispose', key });
  }

  terminate() {
    this.worker.postMessage({ type: 'terminate' });
    this.worker = null;
    this.pending.clear();
  }
}
