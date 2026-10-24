(() => {
  'use strict';
  document.querySelectorAll('[data-waterfall-share]').forEach(section => {
    if (section.dataset.shareReady === 'true') return;
    section.dataset.shareReady = 'true';
    const copy = section.querySelector('[data-copy-link]');
    const native = section.querySelector('[data-native-share]');
    const email = section.querySelector('[data-email-share]');
    const status = section.querySelector('[data-share-status]');
    const fallback = section.querySelector('[data-copy-fallback]');
    const field = section.querySelector('[data-copy-field]');
    const title = section.dataset.shareTitle || document.title;
    if (!copy || !native || !email || !status || !fallback || !field) return;

    function pageURL() {
      const url = new URL(window.location.href);
      url.hash = '';
      return url.href;
    }

    function prepareEmail() {
      email.href = 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(pageURL());
    }

    async function copyLink() {
      const url = pageURL();
      fallback.hidden = true;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
        status.textContent = 'Ο σύνδεσμος αντιγράφηκε. Μπορείτε να τον επικολλήσετε στο μήνυμά σας.';
      } catch {
        fallback.hidden = false;
        field.value = url;
        field.focus();
        field.select();
        status.textContent = 'Αντιγράψτε τον σύνδεσμο από το επιλεγμένο πεδίο.';
      }
    }

    copy.hidden = false;
    copy.addEventListener('click', copyLink);
    email.addEventListener('click', prepareEmail);
    prepareEmail();
    if (typeof navigator.share === 'function') {
      native.hidden = false;
      email.hidden = true;
      native.addEventListener('click', async () => {
        try {
          await navigator.share({ title, url: pageURL() });
          status.textContent = '';
        } catch (error) {
          if (error?.name === 'AbortError') return;
          email.hidden = false;
          prepareEmail();
          status.textContent = 'Μπορείτε να αντιγράψετε τον σύνδεσμο ή να τον στείλετε με email.';
        }
      });
    }
  });
})();
