/* boot.js: runs last, after data.js, core.js and every screens/*.js module has registered its routes. */
(function () {
  'use strict';
  if (window.App && typeof window.App.start === 'function') window.App.start();
})();
