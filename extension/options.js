import {loadSettings, saveSettings} from './settings.js';
const form = document.querySelector('#form');
const saved = document.querySelector('#saved');
const s = await loadSettings();
for (const k of ['server', 'key', 'clientId', 'clientSecret']) form[k].value = s[k];
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveSettings(Object.fromEntries(new FormData(form)));
    saved.textContent = 'Settings saved.';
    saved.className = 'soft';
  } catch (error) {
    saved.textContent = error.message;
    saved.className = 'error';
  }
});
