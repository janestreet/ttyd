// hack to wait for ttyd to be fully initialized
const waitForTerm = (callback) => {
  const interval = setInterval(() => {
    if (typeof term !== 'undefined') {
      clearInterval(interval);
      callback();
    }
  }, 100); // Check every 100ms
};

const customKeys = [
  { ctrl: true, alt: true, key: 'j', sequence: '\x1b\x0a' },
  { ctrl: true, alt: true, key: 's', sequence: '\x1b\x13' },
  { ctrl: true, alt: true, key: 'o', sequence: '\x1b\x0f' },
  { ctrl: true, alt: true, key: 'd', sequence: '\x1b\x04' },
  { ctrl: true, key: '/', sequence: '\x1f' },
];

waitForTerm(() => {
  console.log('xterm.js loaded, injecting custom keybinds', customKeys);
  term.attachCustomKeyEventHandler(ev => {
    for (const customKey of customKeys) {
      const ctrlMatches = customKey.ctrl === ev.ctrlKey;
      const shiftMatches = customKey.shift === ev.shiftKey;
      const altMatches = customKey.alt === ev.altKey;
      if (ctrlMatches && shiftMatches && altMatches && ev.key === customKey.key && ev.type === 'keydown') {
        term.input(customKey.sequence);
        return false; // Prevent xterm.js from processing it further
      }
    }
    return true; // Allow xterm.js to process other keys
  });
});
