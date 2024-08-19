import _ from 'lodash';

export function scale(value, min1, max1, min2, max2) {
  return ((_.clamp(value, min1, max1) - min1) * (max2 - min2)) / (max1 - min1) + min2;
}
