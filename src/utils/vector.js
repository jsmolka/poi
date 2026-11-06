export class Vector {
  constructor(Array, capacity) {
    this.data = new Array(capacity);
    this.length = 0;
  }

  push(value) {
    if (this.length >= this.data.length) {
      const next = new this.data.constructor(2 * this.data.length);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }

  view() {
    return this.data.slice(0, this.length);
  }
}
