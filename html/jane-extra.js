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

// Programs in the terminal can open a URL in a new browser tab by writing
// [OSC 7703 ; URL BEL] to the terminal.  Only http(s) URLs are opened.  Any program whose
// output reaches the terminal can do this, but that's no more than any website can do.
const openUrlOscNumber = 7703;

// Shown when the browser blocks the new tab, which it does if the user hasn't interacted
// with the page recently.
const showOpenUrlLink = (url) => {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `Open ${url}`;
  link.style.cssText = [
    'position: fixed',
    'top: 8px',
    'right: 8px',
    'z-index: 1000',
    'max-width: 60%',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
    'padding: 6px 10px',
    'border-radius: 4px',
    'background: #333',
    'color: #fff',
    'font: 13px sans-serif',
  ].join(';');
  const remove = () => link.remove();
  link.addEventListener('click', () => {
    remove();
    term.focus();
  });
  document.body.appendChild(link);
  setTimeout(remove, 30000);
};

const handleOpenUrlOsc = (data) => {
  let url;
  try {
    url = new URL(data);
  } catch (e) {
    console.warn('ignoring request to open an invalid URL');
    return true;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    console.warn(`ignoring request to open a ${url.protocol} URL`);
    return true;
  }
  const opened = window.open(url.href, '_blank');
  if (opened) {
    // The new window is still on about:blank and same-origin, so we can cut it off from
    // this page before the URL loads.
    opened.opener = null;
  } else {
    showOpenUrlLink(url.href);
  }
  return true;
};

// Whether a program has enabled the kitty keyboard protocol.  xterm.js has no public API
// for this, so this reaches into its internals; if they change, we behave as if the
// protocol were off.
const kittyKeyboardActive = () => (term._core?.coreService?.kittyKeyboard?.flags ?? 0) !== 0;

// When the kitty keyboard protocol is on, xterm.js sends these to the program instead of
// letting the browser copy and paste.  Returning false from the custom key event handler
// makes xterm.js leave the event alone.
const isClipboardShortcut = ev => {
  const key = ev.key.toLowerCase();
  if (key !== 'c' && key !== 'v') return false;
  return navigator.platform.startsWith('Mac')
    ? ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey
    : ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey;
};

waitForTerm(() => {
  term.parser.registerOscHandler(openUrlOscNumber, handleOpenUrlOsc);

  console.log('xterm.js loaded, injecting custom keybinds', customKeys);
  term.attachCustomKeyEventHandler(ev => {
    if (kittyKeyboardActive()) {
      // The protocol encodes these keys itself, so skip our custom bindings.
      return !isClipboardShortcut(ev);
    }
    for (const customKey of customKeys) {
      // A modifier the binding doesn't mention may or may not be held.  This matches the
      // html.h that was actually built and deployed; strict equality here would make the
      // bindings without [shift] (i.e. all of them) unmatchable.
      const ctrlMatches = !customKey.ctrl || ev.ctrlKey;
      const shiftMatches = !customKey.shift || ev.shiftKey;
      const altMatches = !customKey.alt || ev.altKey;
      if (ctrlMatches && shiftMatches && altMatches && ev.key === customKey.key && ev.type === 'keydown') {
        term.input(customKey.sequence);
        return false; // Prevent xterm.js from processing it further
      }
    }
    return true; // Allow xterm.js to process other keys
  });
});
