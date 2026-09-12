/**
 * Builds the JavaScript payload that gets embedded into the
 * "Run JavaScript on Webpage" Shortcuts action.
 *
 * The script automates the Transparent Classroom "distance dropoff/pickup"
 * flow: enter PIN -> pick child -> pick Dropoff/Pickup -> Sign -> scribble
 * a signature -> Done. The site uses Turbo (Hotwire) navigation, so the
 * page never fully reloads between these steps and a single injected
 * script can drive the whole flow by polling the DOM for each stage.
 */
(function (global) {
  'use strict';

  function buildInjectedScript(pin, childName, mode) {
    // JSON.stringify safely escapes quotes/backslashes/unicode for embedding
    // as JS string literals inside the generated script text.
    const pinLiteral = JSON.stringify(String(pin));
    const nameLiteral = JSON.stringify(String(childName).trim().toLowerCase());
    const modeLiteral = JSON.stringify(mode); // "Dropoff" or "Pickup"

    return `(function () {
  var PIN = ${pinLiteral};
  var CHILD_NAME = ${nameLiteral};
  var MODE = ${modeLiteral};
  var STEP_TIMEOUT_MS = 20000;
  var POLL_MS = 250;

  function done(message) {
    try { completion(message); } catch (e) { /* not running inside Shortcuts */ }
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function textOf(el) {
    // <input type="submit|button"> elements carry their label in .value,
    // not textContent/innerText (which are always empty for <input>).
    if (el.tagName === 'INPUT') {
      return (el.value || el.getAttribute('aria-label') || '').trim();
    }
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
  }

  function fireNativeInput(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findButtonByText(label) {
    var target = label.trim().toLowerCase();
    var candidates = Array.prototype.slice.call(document.querySelectorAll('button, input[type="submit"], a.btn, a[role="button"]'));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var text = textOf(el).toLowerCase();
      if (text === target) return el;
    }
    // Fall back to a "starts with" / "contains" match (e.g. "Sign in" vs "Sign").
    for (var j = 0; j < candidates.length; j++) {
      var el2 = candidates[j];
      if (!isVisible(el2)) continue;
      if (textOf(el2).toLowerCase().indexOf(target) === 0) return el2;
    }
    return null;
  }

  function findChildTile(name) {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('[data-test="child-select-tile"]'));
    if (tiles.length === 0) {
      // Fallback: some builds may not carry the data-test attribute.
      tiles = Array.prototype.slice.call(document.querySelectorAll('.flex-grow-1, .child-select-tile'));
    }
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (!isVisible(tile)) continue;
      var label = (tile.getAttribute('aria-label') || '').toLowerCase();
      var text = textOf(tile).toLowerCase();
      var img = tile.querySelector('img');
      var alt = img ? (img.getAttribute('alt') || '').toLowerCase() : '';
      if (label.indexOf(name) !== -1 || text.indexOf(name) !== -1 || alt.indexOf(name) !== -1) {
        return tile;
      }
    }
    return null;
  }

  function clickEl(el) {
    var clickTarget = el.querySelector && (el.querySelector('a, img, button')) || el;
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    clickTarget.click();
  }

  function scribbleSignature(canvas) {
    var rect = canvas.getBoundingClientRect();
    var points = [
      [rect.width * 0.15, rect.height * 0.55],
      [rect.width * 0.28, rect.height * 0.2],
      [rect.width * 0.4, rect.height * 0.7],
      [rect.width * 0.52, rect.height * 0.25],
      [rect.width * 0.64, rect.height * 0.65],
      [rect.width * 0.78, rect.height * 0.3],
      [rect.width * 0.88, rect.height * 0.5]
    ];

    function fireAt(type, x, y, pressed) {
      var clientX = rect.left + x;
      var clientY = rect.top + y;
      var common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: clientX,
        clientY: clientY,
        button: 0,
        buttons: pressed ? 1 : 0
      };
      try {
        canvas.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, common)));
      } catch (e) { /* PointerEvent unsupported */ }
      var mouseType = type.replace('pointer', 'mouse');
      canvas.dispatchEvent(new MouseEvent(mouseType, common));
    }

    fireAt('pointerdown', points[0][0], points[0][1], true);
    for (var i = 1; i < points.length; i++) {
      fireAt('pointermove', points[i][0], points[i][1], true);
    }
    fireAt('pointerup', points[points.length - 1][0], points[points.length - 1][1], false);
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function findCanvas() {
    return document.querySelector('canvas.pad, .sigPad canvas');
  }

  function submitPin(pinField) {
    fireNativeInput(pinField, PIN);
    var form = pinField.closest('form');
    var signInBtn = findButtonByText('Sign in');
    if (signInBtn) {
      clickEl(signInBtn);
    } else if (form) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  }

  // The site (Transparent Classroom) uses Turbo/Hotwire navigation, so the
  // page never fully reloads between steps and this single injected script
  // stays alive across the whole flow. Rather than assuming a fixed order,
  // poll the DOM and always act on whichever stage is furthest along, so the
  // script also works if some earlier steps are already satisfied (e.g. a
  // remembered PIN/child selection).
  async function run() {
    var scribbled = false;
    var deadline = Date.now() + 60000;

    while (Date.now() < deadline) {
      var doneBtn = findButtonByText('Done');
      if (doneBtn && isVisible(doneBtn) && scribbled) {
        clickEl(doneBtn);
        return 'OK: ' + MODE + ' signed for ' + CHILD_NAME;
      }

      var canvas = findCanvas();
      if (canvas && isVisible(canvas) && !scribbled) {
        scribbleSignature(canvas);
        scribbled = true;
        await delay(500);
        continue;
      }

      var signBtn = findButtonByText('Sign');
      if (signBtn && isVisible(signBtn) && !canvas) {
        clickEl(signBtn);
        await delay(400);
        continue;
      }

      var modeBtn = findButtonByText(MODE);
      if (modeBtn && isVisible(modeBtn) && !signBtn && !canvas) {
        clickEl(modeBtn);
        await delay(400);
        continue;
      }

      var childTile = findChildTile(CHILD_NAME);
      if (childTile && isVisible(childTile) && !modeBtn) {
        clickEl(childTile);
        await delay(400);
        continue;
      }

      var pinField = document.querySelector('#pin');
      if (pinField && isVisible(pinField) && !childTile) {
        submitPin(pinField);
        await delay(600);
        continue;
      }

      await delay(POLL_MS);
    }

    throw new Error('Timed out waiting for the next step (last known stage did not progress)');
  }

  run().then(function (msg) {
    done(msg);
  }).catch(function (err) {
    done('ERROR: ' + (err && err.message ? err.message : String(err)));
  });
})();`;
  }

  global.ShortcutScriptBuilder = { buildInjectedScript };
})(typeof window !== 'undefined' ? window : globalThis);
