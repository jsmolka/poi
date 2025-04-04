import animate from 'tailwindcss-animate';
import colors from 'tailwindcss/colors';

export default {
  content: ['./index.html', './src/**/*.{js,vue}'],
  important: true,
  theme: {
    colors: {
      shade: {
        1: 'rgb(var(--shade-1) / <alpha-value>)',
        2: 'rgb(var(--shade-2) / <alpha-value>)',
        3: 'rgb(var(--shade-3) / <alpha-value>)',
        4: 'rgb(var(--shade-4) / <alpha-value>)',
        5: 'rgb(var(--shade-5) / <alpha-value>)',
        6: 'rgb(var(--shade-6) / <alpha-value>)',
        7: 'rgb(var(--shade-7) / <alpha-value>)',
        8: 'rgb(var(--shade-8) / <alpha-value>)',
      },
      brand: {
        1: 'rgb(var(--brand-1) / <alpha-value>)',
        2: 'rgb(var(--brand-2) / <alpha-value>)',
        3: 'rgb(var(--brand-3) / <alpha-value>)',
      },
      red: 'rgb(var(--red) / <alpha-value>)',
      orange: 'rgb(var(--orange) / <alpha-value>)',
      yellow: 'rgb(var(--yellow) / <alpha-value>)',
      green: 'rgb(var(--green) / <alpha-value>)',
      black: colors.black,
      white: colors.white,
      transparent: colors.transparent,
    },
  },
  plugins: [animate],
};
