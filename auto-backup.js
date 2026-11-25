/* 存储监控 + 备份提醒（追加到 milk 站）
   原理：navigator.storage.estimate() 查用量，超阈值或超7天未备份时弹提醒条，
   点击"立即备份"调用站自带 ChatBackup.exportBackupToFile 导出ZIP。 */
(function () {
    'use strict';

    var THRESHOLD = 4 * 1024 * 1024;       // 数据量超过 4MB 提醒
    var CHECK_EVERY = 10 * 60 * 1000;      // 每 10 分钟检查一次
    var WARN_COOLDOWN = 24 * 3600 * 1000;  // 同类提醒 24h 内只弹一次
    var WEEKLY = 7 * 24 * 3600 * 1000;     // 7 天没备份就定期提醒

    var LS_WARN = 'autoBackup_lastWarn';
    var LS_EXPORT = 'autoBackup_lastExport';

    function getLS(k) { try { return parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } }
    function setLS(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

    function fmtSize(b) {
        if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
        if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
        return b + ' B';
    }

    function notify(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info', 3000);
    }

    var bannerEl = null;
    function hideBanner() {
        if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
        bannerEl = null;
    }

    function showBanner(opts) {
        hideBanner();
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:12px;right:12px;bottom:88px;z-index:99999;' +
            'background:rgba(30,30,34,0.95);color:#fff;border-radius:14px;padding:12px 14px;' +
            'font-size:13px;line-height:1.5;box-shadow:0 6px 24px rgba(0,0,0,0.35);' +
            'font-family:var(--font-family,system-ui,sans-serif);' +
            (opts.warn ? 'border:1px solid rgba(255,120,120,0.6);' : 'border:1px solid rgba(120,180,255,0.5);');

        var title = document.createElement('div');
        title.textContent = opts.title;
        title.style.cssText = 'font-weight:700;margin-bottom:4px;';
        wrap.appendChild(title);

        var body = document.createElement('div');
        body.textContent = opts.text;
        body.style.cssText = 'opacity:0.9;margin-bottom:10px;';
        wrap.appendChild(body);

        var btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

        var later = document.createElement('button');
        later.textContent = '稍后';
        later.style.cssText = 'background:rgba(255,255,255,0.12);color:#fff;border:none;' +
            'border-radius:9px;padding:7px 14px;font-size:13px;cursor:pointer;';
        later.onclick = hideBanner;
        btns.appendChild(later);

        var go = document.createElement('button');
        go.textContent = '立即备份';
        go.style.cssText = 'background:#4c8dff;color:#fff;border:none;border-radius:9px;' +
            'padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;';
        go.onclick = function () {
            doBackup();
            hideBanner();
        };
        btns.appendChild(go);

        wrap.appendChild(btns);
        document.body.appendChild(wrap);
        bannerEl = wrap;
    }

    function doBackup() {
        if (!(window.ChatBackup && typeof ChatBackup.exportBackupToFile === 'function')) {
            notify('备份引擎未就绪，请检查网络后刷新页面', 'warning');
            return;
        }
        try {
            ChatBackup.exportBackupToFile().then(function () {
                setLS(LS_EXPORT, Date.now());
            }).catch(function () {
                notify('备份已取消或失败', 'warning');
            });
        } catch (e) {
            notify('备份出错：' + e.message, 'error');
        }
    }

    function check() {
        if (!navigator.storage || !navigator.storage.estimate) return;
        navigator.storage.estimate().then(function (est) {
            var usage = est.usage || 0;
            var now = Date.now();

            if (usage > THRESHOLD) {
                if (now - getLS(LS_WARN) > WARN_COOLDOWN) {
                    setLS(LS_WARN, now);
                    showBanner({
                        title: '存储空间提醒',
                        text: '聊天数据已用 ' + fmtSize(usage) + '，接近浏览器上限。建议现在备份一份，并清理不用的自定义图片。',
                        warn: true
                    });
                }
                return;
            }

            if (now - getLS(LS_EXPORT) > WEEKLY && now - getLS(LS_WARN) > WARN_COOLDOWN) {
                setLS(LS_WARN, now);
                showBanner({
                    title: '定期备份提醒',
                    text: '距上次备份已超过 7 天。备份文档存到QQ或文件管理里，换手机也能恢复。',
                    warn: false
                });
            }
        }).catch(function () {});
    }

    window.addEventListener('load', function () {
        setTimeout(check, 8000);
        setInterval(check, CHECK_EVERY);
    });
})();
