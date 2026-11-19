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
// letting the browser handle them.  Returning false from the custom key event handler
// makes xterm.js leave the event alone.
//
// We try to leave to the browser exactly the Super (Cmd on macOS) combinations that
// xterm.js leaves to it when the protocol is off:
//
// - Left to the browser: Super with a character key (a letter, digit, punctuation or
//   space), Super with an arrow key, and Super on its own.  This covers Cmd+C/V on
//   macOS, and Super+<foo> desktop and browser shortcuts on Linux.
//
// - Sent to the program, with Super encoded: Super with Backspace, Tab, Enter, Escape,
//   Insert, Delete, Home, End, Page Up, Page Down or a function key.  Without the
//   protocol, xterm.js sends these too.
//
// One difference: without the protocol, Ctrl+Shift+Super with -, 2 or 6 sends ^_, ^@ or
// ^^, but here it's left to the browser.
//
// Separately, outside macOS, Ctrl+Shift+C/V are left to the browser to copy and paste.
const isBrowserShortcut = ev => {
  if (ev.metaKey && (ev.key.length === 1 || ev.key.startsWith('Arrow') || ev.key === 'Meta')) {
    return true;
  }
  const key = ev.key.toLowerCase();
  return (key === 'c' || key === 'v') && ev.ctrlKey && ev.shiftKey && !ev.altKey;
};

const isMac = /^Mac/.test(navigator.platform);

// What each key types on the US layout, without and with Shift.  xterm.js's legacy
// encoder uses the same table to send Option+<key> when Option is Meta.
const usLayoutKeys = {
  Backquote: ['`', '~'], Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'],
  Digit4: ['4', '$'], Digit5: ['5', '%'], Digit6: ['6', '^'], Digit7: ['7', '&'],
  Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'], Minus: ['-', '_'],
  Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
  Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ['\'', '"'], Comma: [',', '<'],
  Period: ['.', '>'], Slash: ['/', '?'], Space: [' ', ' '],
};

const usLayoutKey = ev => {
  const letter = /^Key([A-Z])$/.exec(ev.code)?.[1];
  if (letter) return ev.shiftKey ? letter : letter.toLowerCase();
  return usLayoutKeys[ev.code]?.[ev.shiftKey ? 1 : 0];
};

// On macOS, Option+<key> reports the character Option composes as [ev.key], even when
// Option is Meta: Option+x is "≈" on the US layout, and Option+` is "Dead".  xterm.js's
// kitty encoder sends that character as the shifted key and as the text, and for keys
// other than letters and digits as the key too, so Emacs sees M-≈ instead of M-x, and
// M-¯ instead of M-<.  Make [ev.key] what the key types without Option, so the encoder
// sends what it would for Shift and the key alone, plus Alt.

// CR-someday swhitton: Remove this once xterm.js fixes it upstream.  The key field is
// https://github.com/xtermjs/xterm.js/issues/5819, where a US-layout fix like this one was
// rejected (https://github.com/xtermjs/xterm.js/pull/6083) in favour of keyboard layout
// providers (https://github.com/xtermjs/xterm.js/issues/5882).  The shifted key and text
// fields aren't reported upstream.
const undoOptionComposition = ev => {
  if (!isMac || !ev.altKey || !term.options.macOptionIsMeta) return;
  const key = usLayoutKey(ev);
  if (key !== undefined && key !== ev.key) Object.defineProperty(ev, 'key', { value: key });
};

// The [code]s of keys whose latest keydown went to the program.  A keyup goes to the
// program exactly when its key is here, so that a program asking for key release events
// gets a release for each press it got, and no others, whatever modifiers are held by
// the time of the release.  (For example, Chrome reports [metaKey] as false when Super
// itself is released.)  Every keydown records where it went, so an entry left behind
// when the browser fires no keyup, as on macOS for keys released while Cmd is held,
// can't misdirect a later release.
const keysSentToProgram = new Set();

waitForTerm(() => {
  term.parser.registerOscHandler(openUrlOscNumber, handleOpenUrlOsc);

  console.log('xterm.js loaded, injecting custom keybinds', customKeys);
  term.attachCustomKeyEventHandler(ev => {
    if (kittyKeyboardActive()) {
      undoOptionComposition(ev);
      // The protocol encodes these keys itself, so skip our custom bindings.
      if (ev.type === 'keyup') return keysSentToProgram.delete(ev.code);
      const toProgram = !isBrowserShortcut(ev);
      if (ev.type === 'keydown') {
        if (toProgram) keysSentToProgram.add(ev.code);
        else keysSentToProgram.delete(ev.code);
      }
      return toProgram;
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
