(function () {
  'use strict';

  const pinInput = document.getElementById('pin');
  const nameInput = document.getElementById('childName');
  const statusEl = document.getElementById('status');
  const dropoffBtn = document.getElementById('generateDropoff');
  const pickupBtn = document.getElementById('generatePickup');
  const outputSection = document.getElementById('output');
  const schoolUrlField = document.getElementById('schoolUrlField');
  const scriptField = document.getElementById('scriptField');
  const copyUrlBtn = document.getElementById('copyUrl');
  const copyScriptBtn = document.getElementById('copyScript');

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

  function generateScript(mode) {
    const values = validate();
    if (!values) return;

    try {
      const script = window.ShortcutScriptBuilder.buildInjectedScript(values.pin, values.childName, mode);
      schoolUrlField.value = window.TCSignInConfig.SCHOOL_URL;
      scriptField.value = script;
      outputSection.hidden = false;
      showStatus(mode + ' script generated below. Follow the instructions to build the shortcut.', false);
      outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      showStatus('Something went wrong generating the script: ' + err.message, true);
    }
  }

  async function copyField(field, button) {
    field.select();
    field.setSelectionRange(0, field.value.length);
    const original = button.textContent;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(field.value);
      } else {
        document.execCommand('copy');
      }
      button.textContent = 'Copied!';
    } catch (err) {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  dropoffBtn.addEventListener('click', () => generateScript('Dropoff'));
  pickupBtn.addEventListener('click', () => generateScript('Pickup'));
  copyUrlBtn.addEventListener('click', () => copyField(schoolUrlField, copyUrlBtn));
  copyScriptBtn.addEventListener('click', () => copyField(scriptField, copyScriptBtn));
})();
