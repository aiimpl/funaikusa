// Keyboard. Held keys are polled each frame; one-shot keys (T trim, Space anchor, C camera) call onPress.
export class Input {
  constructor() {
    this.keys = {};
    this.trim = true;
    this.autoCenter = true;
    this.onPress = null;
    addEventListener('keydown', (e) => {
      if (!e.repeat) this.onPress?.(e.code);
      this.keys[e.code] = true;
      if (e.code === 'KeyT' && !e.repeat) this.trim = !this.trim;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }
}
