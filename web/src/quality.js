// Quality profile. Phones and tablets get smaller render targets, a smaller shadow map, shorter draw
// distances and fewer instances; ?q=high / ?q=low overrides the guess.
const q = new URLSearchParams(location.search).get('q');
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const small = Math.min(screen.width, screen.height) < 820;
export const MOBILE = q ? q === 'low' : (touch && small) || /iPhone|Android.+Mobile/.test(navigator.userAgent);
export const TOUCH = touch;

export const Q = MOBILE ? {
  renderScale: 0.62,      // fraction of device pixels
  maxPixels: 1.0e6,       // cap on the main render target
  msaa: 0,
  bloomLevels: 5,
  shadowRes: 4096, shadowSize: 1800,
  reflScale: 0.35,
  treeCaps: [220, 1600], treeFar: 1300, farTrees: 0.35,
  groundScale: 0.4, groundRange: 0.6,
  clipLevels: 6,
} : {
  renderScale: 1, maxPixels: 4.0e6, msaa: 4, bloomLevels: 6,
  shadowRes: 8192, shadowSize: 2300,
  reflScale: 0.5,
  treeCaps: [700, 4000], treeFar: 2600, farTrees: 1,
  groundScale: 1, groundRange: 1,
  clipLevels: 7,
};
