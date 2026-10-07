'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const secureUrl = `https://${location.host}/`;
  for (const id of ['openChat', 'openChatDone', 'skip']) $(id).href = secureUrl;

  const show = (id) => {
    $('checking').hidden = true;
    $(id).hidden = false;
  };

  if (location.protocol === 'https:') {
    show('done');
    return;
  }

  // On http: if this computer already trusts the chat certificate, the secure
  // address loads without errors, so go straight there. Otherwise show the steps.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  fetch(`${secureUrl}api/info`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    .then(() => location.replace(secureUrl + location.search))
    .catch(() => show('steps'))
    .finally(() => clearTimeout(timer));
})();
