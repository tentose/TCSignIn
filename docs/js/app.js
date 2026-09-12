(function () {
  'use strict';

  const pinInput = document.getElementById('pin');
  const nameInput = document.getElementById('childName');
  const statusEl = document.getElementById('status');
  const dropoffBtn = document.getElementById('downloadDropoff');
  const pickupBtn = document.getElementById('downloadPickup');

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', !!isError);
  }

  function validate() {
    const pin = pinInput.value.trim();
    const childName = nameInput.value.trim();
    if (!pin) {
      showStatus('Please enter your PIN.', true);
      pinInput.focus();
      return null;
    }
    if (!childName) {
      showStatus("Please enter your child's name.", true);
      nameInput.focus();
      return null;
    }
    return { pin, childName };
  }

  function downloadShortcut(mode) {
    const values = validate();
    if (!values) return;

    try {
      const bytes = window.ShortcutFileBuilder.buildShortcutFile({
        pin: values.pin,
        childName: values.childName,
        mode: mode
      });

      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mode + '.shortcut';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      showStatus(mode + '.shortcut downloaded. Open it on your iPhone to import into Shortcuts.', false);
    } catch (err) {
      console.error(err);
      showStatus('Something went wrong building the shortcut: ' + err.message, true);
    }
  }

  dropoffBtn.addEventListener('click', () => downloadShortcut('Dropoff'));
  pickupBtn.addEventListener('click', () => downloadShortcut('Pickup'));
})();
