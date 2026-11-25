/* 一行 <script src="pwa.js"></script> 搞定：注入manifest + 注册service worker */
(function () {
  var link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.json';
  document.head.appendChild(link);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('SW注册失败：', err);
      });
    });
  }
})();
