/* milk 功能扩展包 addons.js
   包含：PIN锁 / 存储用量面板 / 聊天记录TXT导出 / 消息搜索
   全部为外挂式：不改原站任何文件，独立加载。 */
(function () {
    'use strict';

    var Z = 2147483000;
    function notify(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info', 2500); }
    function injectCss(id, css) {
        if (document.getElementById(id)) return;
        var s = document.createElement('style');
        s.id = id;
        s.textContent = css;
        document.head.appendChild(s);
    }

    /* ================= PIN 锁 ================= */
    var PIN_KEY = 'addons_pin_hash';
    var pinInput = '';

    function sha256(text) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
            return Array.prototype.map.call(new Uint8Array(buf), function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('');
        });
    }
    function hasPin() { try { return !!localStorage.getItem(PIN_KEY); } catch (e) { return false; } }

    function lockScreen() {
        injectCss('addon-pin-css',
            '#addon-lock{position:fixed;inset:0;z-index:' + Z + ';background:rgba(20,20,24,0.96);' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;' +
            'font-family:var(--font-family,system-ui,sans-serif);backdrop-filter:blur(12px);}' +
            '#addon-lock .al-title{font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:2px;}' +
            '#addon-lock .al-sub{font-size:12px;opacity:0.55;margin-bottom:26px;}' +
            '#addon-lock .al-dots{display:flex;gap:14px;margin-bottom:28px;}' +
            '#addon-lock .al-dot{width:13px;height:13px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.5);}' +
            '#addon-lock .al-dot.on{background:#4c8dff;border-color:#4c8dff;}' +
            '#addon-lock .al-pad{display:grid;grid-template-columns:repeat(3,72px);gap:14px;}' +
            '#addon-lock .al-key{height:56px;border-radius:50%;border:none;font-size:20px;color:#fff;' +
            'background:rgba(255,255,255,0.12);cursor:pointer;transition:background 0.15s;}' +
            '#addon-lock .al-key:active{background:rgba(255,255,255,0.3);}' +
            '#addon-lock .al-key.fn{font-size:13px;background:transparent;}' +
            '#addon-lock .al-warn{color:#ff8080;font-size:12px;height:16px;margin-top:14px;}' +
            '#addon-lock.shake{animation:alShake 0.4s;}' +
            '@keyframes alShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-10px)}' +
            '75%{transform:translateX(10px)}}');

        var first = '', mode = hasPin() ? 'verify' : 'set1';
        var el = document.createElement('div');
        el.id = 'addon-lock';
        el.innerHTML =
            '<div class="al-title">传讯</div>' +
            '<div class="al-sub" id="alSub">' + (mode === 'verify' ? '输入密码进入' : '首次使用，设置进入密码（至少4位）') + '</div>' +
            '<div class="al-dots" id="alDots"></div>' +
            '<div class="al-pad" id="alPad"></div>' +
            '<div class="al-warn" id="alWarn"></div>';
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';

        var dots = el.querySelector('#alDots'), pad = el.querySelector('#alPad'),
            warn = el.querySelector('#alWarn'), sub = el.querySelector('#alSub');
        function drawDots() {
            dots.innerHTML = '';
            for (var i = 0; i < Math.max(pinInput.length, 4); i++) {
                var d = document.createElement('div');
                d.className = 'al-dot' + (i < pinInput.length ? ' on' : '');
                dots.appendChild(d);
            }
        }
        ['1','2','3','4','5','6','7','8','9','CLR','0','OK'].forEach(function (k) {
            var b = document.createElement('button');
            b.className = 'al-key' + (k.length > 1 ? ' fn' : '');
            b.textContent = k;
            b.onclick = function () { press(k); };
            pad.appendChild(b);
        });
        drawDots();

        function fail(msg) {
            warn.textContent = msg;
            el.classList.remove('shake');
            void el.offsetWidth;
            el.classList.add('shake');
            pinInput = '';
            drawDots();
        }

        function press(k) {
            warn.textContent = '';
            if (k === 'CLR') { pinInput = ''; drawDots(); return; }
            if (k === 'OK' || pinInput.length >= 8) { submit(); return; }
            pinInput += k;
            drawDots();
        }

        function submit() {
            if (pinInput.length < 4) { fail('至少4位'); return; }
            sha256(pinInput).then(function (h) {
                if (mode === 'verify') {
                    if (h === localStorage.getItem(PIN_KEY)) {
                        document.body.style.overflow = '';
                        el.remove();
                    } else { fail('密码不对'); }
                } else if (mode === 'set1') {
                    first = pinInput; pinInput = ''; mode = 'set2';
                    sub.textContent = '再输一遍确认';
                    drawDots();
                } else {
                    if (pinInput === first) {
                        localStorage.setItem(PIN_KEY, h);
                        document.body.style.overflow = '';
                        el.remove();
                        notify('密码已设置', 'success');
                    } else { mode = 'set1'; first = ''; pinInput = ''; fail('两次不一致，重设'); sub.textContent = '首次使用，设置进入密码（至少4位）'; }
                }
            });
        }
    }

    /* ================= 存储面板 + TXT导出按钮 ================= */
    var estUsage = 0, estQuota = 0;
    function refreshEstimate() {
        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then(function (e2) {
                estUsage = e2.usage || 0;
                estQuota = e2.quota || 0;
                var chip = document.getElementById('addon-chip');
                if (chip) chip.textContent = '\u{1F4BE} ' + fmtMB(estUsage);
            }).catch(function () {});
        }
    }
    function fmtMB(b) {
        if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
        if (b >= 1024) return (b / 1024).toFixed(0) + 'KB';
        return b + 'B';
    }

    function storagePanel() {
        injectCss('addon-store-css',
            '#addon-chip{position:fixed;left:10px;top:0;z-index:' + (Z - 2) + ';' +
            'background:rgba(30,30,34,0.85);color:#fff;font-size:11px;padding:6px 10px;' +
            'border-radius:20px;cursor:pointer;border:1px solid rgba(255,255,255,0.15);' +
            'font-family:var(--font-family,system-ui,sans-serif);}' +
            '#addon-panel{position:fixed;left:10px;bottom:56px;z-index:' + (Z - 1) + ';width:230px;' +
            'background:rgba(30,30,34,0.97);color:#fff;border-radius:14px;padding:14px;font-size:12px;' +
            'border:1px solid rgba(255,255,255,0.15);font-family:var(--font-family,system-ui,sans-serif);}' +
            '#addon-panel .ap-row{display:flex;justify-content:space-between;margin-bottom:8px;}' +
            '#addon-panel .ap-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;margin-bottom:12px;}' +
            '#addon-panel .ap-fill{height:100%;background:#4c8dff;}' +
            '#addon-panel button{width:100%;margin-top:6px;padding:8px 0;border:none;border-radius:9px;' +
            'font-size:12px;font-weight:600;cursor:pointer;}' +
            '#addon-panel .ap-b{background:#4c8dff;color:#fff;}' +
            '#addon-panel .ap-g{background:rgba(255,255,255,0.12);color:#fff;}');

        var chip = document.createElement('div');
        chip.id = 'addon-chip';
        chip.textContent = '\u{1F4BE} …';
        chip.onclick = togglePanel;
        document.body.appendChild(chip);

        function togglePanel() {
            var old = document.getElementById('addon-panel');
            if (old) { old.remove(); return; }
            var p = document.createElement('div');
            p.id = 'addon-panel';
            var pct = estQuota ? Math.min(100, estUsage / estQuota * 100) : 0;
            p.innerHTML =
                '<div class="ap-row"><span>聊天数据</span><span>' + fmtMB(estUsage) + '</span></div>' +
                '<div class="ap-row"><span>浏览器上限</span><span>' + fmtMB(estQuota) + '</span></div>' +
                '<div class="ap-bar"><div class="ap-fill" style="width:' + pct + '%"></div></div>' +
                '<button class="ap-b" id="apBackup">备份全部数据</button>' +
                '<button class="ap-b" id="apTxt">导出聊天记录TXT</button>' +
                '<button class="ap-g" id="apClose">收起</button>';
            document.body.appendChild(p);
            addonLayout();
            p.querySelector('#apBackup').onclick = function () {
                if (window.ChatBackup) ChatBackup.exportBackupToFile().catch(function () {});
                else notify('备份引擎未就绪', 'warning');
            };
            p.querySelector('#apTxt').onclick = function () { exportTxt(); };
            p.querySelector('#apClose').onclick = function () { p.remove(); };
        }
    }

    /* ================= TXT 导出 ================= */
    function fmtTime(t) {
        try {
            var d = null;
            if (typeof t === 'number') d = new Date(t < 1e12 ? t * 1000 : t);
            else if (typeof t === 'string' && t) d = new Date(t);
            if (d && !isNaN(d)) {
                var pad = function (n) { return ('0' + n).slice(-2); };
                return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
                       pad(d.getHours()) + ':' + pad(d.getMinutes());
            }
        } catch (e) {}
        return t ? String(t) : '';
    }

    function msgText(m) {
        if (typeof m === 'string') return m;
        if (!m || typeof m !== 'object') return '';
        var v = m.content || m.text || m.message || m.msg || '';
        if (typeof v === 'object') v = JSON.stringify(v);
        return String(v);
    }
    function msgWho(m) {
        var t = (m && (m.type || m.sender || m.side)) || '';
        t = String(t).toLowerCase();
        if (m && (m.isSent === true || m.fromMe === true)) return '我';
        if (['sent', 'me', 'my', 'self', 'mine'].indexOf(t) !== -1) return '我';
        if (m && (m.isSent === false || m.fromMe === false)) return '梦角';
        return '梦角';
    }

    function exportTxt() {
        notify('正在整理聊天记录…', 'info', 3000);
        if (!(window.ChatBackup && ChatBackup.buildBackupPayload)) {
            notify('备份引擎未就绪', 'error');
            return;
        }
        ChatBackup.buildBackupPayload({
            inclMsgs: true, inclSet: false, inclCustom: false,
            inclAnn: false, inclThemes: false, inclDg: false, inclStickers: false
        }).then(function (payload) {
            var lf = payload.localforage || {};
            var sections = [];
            Object.keys(lf).forEach(function (key) {
                if (key.indexOf('chatMessages') === -1) return;
                var val = lf[key];
                var store = payload.mediaStore || {};
                var list = Array.isArray(val) ? val : (val && val.messages) || [];
                if (!list.length) return;
                var lines = [];
                list.forEach(function (m) {
                    var txt = msgText(m);
                    if (!txt && m && typeof m === 'object' && m.__mRef) txt = '[图片]';
                    txt = txt.replace(/\{[^{}]*__mRef[^{}]*\}/g, '[图片]');
                    if (!txt.trim()) return;
                    lines.push('【' + fmtTime(m && (m.timestamp || m.time || m.date)) + '】' + msgWho(m) + '：' + txt);
                });
                if (lines.length) sections.push('===== 会话 ' + (sections.length + 1) + ' =====\n' + lines.join('\n'));
            });
            if (!sections.length) { notify('没有找到聊天记录', 'warning'); return; }
            var body = '传讯聊天记录导出\n导出时间：' + fmtTime(Date.now()) + '\n\n' + sections.join('\n\n');
            var blob = new Blob(['\ufeff' + body], { type: 'text/plain;charset=utf-8' });
            var name = 'chat-history-' + new Date().toISOString().slice(0, 10) + '.txt';
            if (typeof downloadFileFallback === 'function') downloadFileFallback(blob, name);
            else {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
            }
            notify('TXT已导出', 'success');
        }).catch(function (e) {
            notify('导出失败：' + (e && e.message ? e.message : '未知'), 'error', 4000);
        });
    }

    /* ================= 消息搜索 ================= */
    var searchIdx = -1, searchHits = [];
    function toggleSearch() {
        var bar = document.getElementById('addon-search');
        if (bar) { clearHits(); bar.remove(); return; }
        injectCss('addon-search-css',
            '#addon-search{position:fixed;top:8px;left:8px;right:8px;z-index:' + (Z - 1) + ';' +
            'display:flex;gap:8px;align-items:center;background:rgba(30,30,34,0.97);' +
            'border:1px solid rgba(255,255,255,0.18);border-radius:12px;padding:8px 10px;' +
            'font-family:var(--font-family,system-ui,sans-serif);}' +
            '#addon-search input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:14px;}' +
            '#addon-search .as-btn{background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;' +
            'padding:5px 10px;font-size:12px;cursor:pointer;}' +
            '#addon-search .as-count{color:#9ab;font-size:12px;min-width:44px;text-align:center;}' +
            '.addon-hit{outline:2px solid #4c8dff !important;outline-offset:1px;border-radius:8px;}');
        var el = document.createElement('div');
        el.id = 'addon-search';
        el.innerHTML =
            '<input id="asInput" placeholder="搜索聊天记录…" autocomplete="off">' +
            '<span class="as-count" id="asCount"></span>' +
            '<button class="as-btn" id="asPrev">↑</button>' +
            '<button class="as-btn" id="asNext">↓</button>' +
            '<button class="as-btn" id="asClose">✕</button>';
        document.body.appendChild(el);
        var input = el.querySelector('#asInput');
        input.focus();
        var t = null;
        input.addEventListener('input', function () {
            clearTimeout(t);
            t = setTimeout(function () { runSearch(input.value); }, 250);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.shiftKey ? prevHit() : nextHit(); }
        });
        el.querySelector('#asPrev').onclick = prevHit;
        el.querySelector('#asNext').onclick = nextHit;
        el.querySelector('#asClose').onclick = function () { clearHits(); el.remove(); };
    }
    function runSearch(q) {
        clearHits();
        if (!q) return;
        var msgs = document.querySelectorAll('#chat-container .message');
        msgs.forEach(function (m) {
            if (m.textContent.toLowerCase().indexOf(q.toLowerCase()) !== -1) {
                m.classList.add('addon-hit');
                searchHits.push(m);
            }
        });
        searchIdx = -1;
        updateCount();
        if (searchHits.length) nextHit();
    }
    function updateCount() {
        var c = document.getElementById('asCount');
        if (c) c.textContent = searchHits.length ? (searchIdx + 1) + '/' + searchHits.length : '0/0';
    }
    function nextHit() {
        if (!searchHits.length) return;
        searchIdx = (searchIdx + 1) % searchHits.length;
        jump();
    }
    function prevHit() {
        if (!searchHits.length) return;
        searchIdx = (searchIdx - 1 + searchHits.length) % searchHits.length;
        jump();
    }
    function jump() {
        var m = searchHits[searchIdx];
        if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateCount();
    }
    function clearHits() {
        searchHits.forEach(function (m) { m.classList.remove('addon-hit'); });
        searchHits = [];
        searchIdx = -1;
    }

    
    /* 动态布局：悬浮件悬在输入框上方 */
    function addonLayout() {
        try {
            var inp = document.getElementById('message-input');
            var base = inp ? inp.getBoundingClientRect().top : window.innerHeight - 130;
            if (!base || base < 100) return;
            var chip = document.getElementById('addon-chip');
            if (chip) chip.style.top = (base - 48) + 'px';
            var sb = document.getElementById('addon-searchBtn');
            if (sb) sb.style.top = (base - 48) + 'px';
            var p = document.getElementById('addon-panel');
            if (p) p.style.top = Math.max(8, base - p.offsetHeight - 56) + 'px';
        } catch (e) {}
    }
    window.addEventListener('resize', function () { setTimeout(addonLayout, 200); });

    /* ================= 启动 ================= */
    window.addEventListener('load', function () {
        addonLayout();
            setInterval(addonLayout, 3000);
            setTimeout(function () {
            lockScreen();
            storagePanel();
            refreshEstimate();
            setInterval(refreshEstimate, 30000);
            injectCss('addon-fab-css',
                '#addon-searchBtn{position:fixed;right:12px;top:0;z-index:' + (Z - 2) + ';' +
                'width:38px;height:38px;border-radius:50%;background:rgba(30,30,34,0.85);color:#fff;' +
                'border:1px solid rgba(255,255,255,0.15);font-size:16px;cursor:pointer;}');
            var sb = document.createElement('button');
            sb.id = 'addon-searchBtn';
            sb.textContent = '\u{1F50D}';
            sb.onclick = toggleSearch;
            document.body.appendChild(sb);
        }, 1500);
    });
})();
