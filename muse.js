/* muse.js —— 活字组字器 v4（多会话/群聊兼容版）
   - 铸字：仅当前会话的聊天记录 → 马尔可夫链 + 记忆锚点 + 暗骰火候
   - 发言人：自动检测会话内角色，面板点选；存储到 localStorage（按会话记忆）
   - 发出：克隆真实消息翻面成选定角色 → 写回 localforage → 刷新由站渲染 */
(function () {
    'use strict';

    var Z = 2147482900;
    var LS_SEEN = 'muse_seenTip';
    var LS_SPK = 'muse_speaker_';

    function notify(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info', 2500); }
    function rnd(n) { return Math.floor(Math.random() * n); }
    function pick(arr) { return arr[rnd(arr.length)]; }

    /* ============ 会话定位 ============ */
    function lfAvailable() { return !!(window.localforage && localforage.keys && localforage.getItem); }

    function newestKey(cands) {
        return new Promise(function (resolve) {
            var bestKey = null, bestTime = 0, i = 0;
            function step() {
                if (i >= cands.length) { resolve(bestKey); return; }
                localforage.getItem(cands[i]).then(function (arr) {
                    if (Array.isArray(arr) && arr.length) {
                        var t = arr[arr.length - 1] && arr[arr.length - 1].timestamp;
                        var tn = (t instanceof Date) ? t.getTime() : (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : (t ? new Date(t).getTime() || 0 : 0));
                        if (tn >= bestTime) { bestTime = tn; bestKey = cands[i]; }
                    }
                    i++; step();
                }).catch(function () { i++; step(); });
            }
            step();
        });
    }

    var cachedKey = null;
    function getActiveChatKey(force) {
        if (cachedKey && !force) return Promise.resolve(cachedKey);
        if (!lfAvailable()) return Promise.resolve(null);
        return localforage.keys().then(function (keys) {
            var cands = [];
            for (var i = 0; i < keys.length; i++) if (keys[i].indexOf('chatMessages') !== -1) cands.push(keys[i]);
            if (!cands.length) return null;
            // 优先：找活跃会话标记
            var idPromises = [];
            for (var j = 0; j < keys.length; j++) {
                if (/lastsession|currentsession|activesession|sessionid|current_chat/i.test(keys[j])) idPromises.push(keys[j]);
            }
            var chainP = Promise.resolve(null);
            idPromises.forEach(function (k) {
                chainP = chainP.then(function (found) {
                    if (found) return found;
                    return localforage.getItem(k).then(function (v) {
                        if (typeof v === 'string' && v) return v;
                        if (v && typeof v === 'object' && typeof v.id === 'string') return v.id;
                        return null;
                    }).catch(function () { return null; });
                });
            });
            return chainP.then(function (sid) {
                if (sid) {
                    for (var c = 0; c < cands.length; c++) if (cands[c].indexOf(sid) !== -1) { cachedKey = cands[c]; return cachedKey; }
                }
                return newestKey(cands).then(function (k) { cachedKey = k; return k; });
            });
        });
    }

    /* ============ 语料：按当前会话铸铅字 ============ */
    var chain = null, anchors = [], corpusKey = null;

    function msgTextOf(m) {
        if (typeof m === 'string') return m;
        if (!m || typeof m !== 'object') return '';
        if (m.image || m.__mRef) return '';
        var v = m.text || m.content || m.message || m.msg || '';
        return typeof v === 'string' ? v : '';
    }
    function addToChain(text) {
        var chars = Array.from(text);
        if (chars.length < 2) return;
        var prev = '^';
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!chain[prev]) chain[prev] = {};
            chain[prev][c] = (chain[prev][c] || 0) + 1;
            prev = c;
        }
        if (!chain[prev]) chain[prev] = {};
        chain[prev]['$'] = (chain[prev]['$'] || 0) + 1;
    }
    function buildCorpus() {
        chain = {}; anchors = [];
        return getActiveChatKey().then(function (key) {
            if (!key) return { ok: false, err: '找不到当前会话的聊天记录' };
            corpusKey = key;
            return localforage.getItem(key).then(function (list) {
                if (!Array.isArray(list)) return { ok: false, err: '聊天记录结构异常' };
                list.forEach(function (m) {
                    var t = msgTextOf(m).replace(/\{[^{}]*__mRef[^{}]*\}/g, '').trim();
                    if (t.length < 2 || t.length > 80) return;
                    addToChain(t);
                    if (t.length >= 4 && t.length <= 30) anchors.push(t);
                });
                return { ok: Object.keys(chain).length > 5, err: '语料不足（先聊几句文字）' };
            });
        }).catch(function (e) { return { ok: false, err: e && e.message }; });
    }

    /* ============ 角色检测与选择 ============ */
    var SENDER_FIELDS = ['sender', 'senderId', 'speaker', 'role', 'side', 'type', 'from', 'author'];
    var spkState = { field: null, vals: [], selected: null };

    function detectSpeakers(list) {
        spkState = { field: null, vals: [], selected: null };
        if (!Array.isArray(list)) return spkState;
        for (var f = 0; f < SENDER_FIELDS.length; f++) {
            var field = SENDER_FIELDS[f], seen = {}, lastVal;
            for (var i = 0; i < list.length; i++) {
                var v = list[i] && list[i][field];
                if (v === undefined || v === null) continue;
                v = String(v);
                seen[v] = 1;
                lastVal = v;
            }
            var vals = Object.keys(seen);
            if (vals.length >= 2) {
                spkState.field = field;
                spkState.vals = vals;
                var saved = null;
                try { saved = localStorage.getItem(LS_SPK + corpusKey); } catch (e) {}
                if (saved && seen[saved]) spkState.selected = saved;
                else {
                    for (var k = 0; k < vals.length; k++) if (vals[k] !== lastVal) { spkState.selected = vals[k]; break; }
                }
                break;
            }
        }
        return spkState;
    }

    /* ============ 生成 ============ */
    function weightedPick(entries, temp) {
        var total = 0;
        var weights = entries.map(function (e) { var w = Math.pow(e[1], 1 / temp); total += w; return w; });
        var r = Math.random() * total;
        for (var i = 0; i < entries.length; i++) { r -= weights[i]; if (r <= 0) return entries[i][0]; }
        return entries[entries.length - 1][0];
    }
    function generate() {
        if (!chain) return null;
        var temp = 0.35 + Math.random() * 1.4;
        var out = '', prev = '^';
        if (anchors.length && Math.random() < 0.6) {
            var a = pick(anchors);
            var startIdx = rnd(Math.max(1, a.length - 3));
            var seedLen = 2 + rnd(Math.min(3, a.length - startIdx));
            out = a.substr(startIdx, seedLen);
            prev = Array.from(out).pop() || '^';
        }
        var maxLen = 14 + rnd(14);
        for (var i = 0; out.length < maxLen; i++) {
            var trans = chain[prev];
            if (!trans) break;
            var entries = Object.keys(trans).map(function (k) { return [k, trans[k]]; });
            var next = weightedPick(entries, temp);
            if (next === '$') break;
            out += next; prev = next;
            if (/[。？！…]$/.test(out) && out.length > 6) break;
        }
        out = out.trim();
        return out.length >= 2 ? { text: out } : null;
    }

    /* ============ 拟人打字 ============ */
    function typeInto(el, text, done) {
        el.textContent = '';
        var chars = Array.from(text), i = 0;
        function step() {
            if (i >= chars.length) { if (done) done(); return; }
            var burst = 1 + rnd(3);
            for (var b = 0; b < burst && i < chars.length; b++) el.textContent += chars[i++];
            var last = el.textContent.slice(-1);
            var delay = /[。？！，、；…]/.test(last) ? 240 + rnd(200) : (Math.random() < 0.06 ? 500 + rnd(500) : 45 + rnd(110));
            setTimeout(step, delay);
        }
        step();
    }

    /* ============ 注入：写库 + 刷新 ============ */
    function injectViaStorage(text) {
        return getActiveChatKey().then(function (key) {
            if (!key) return '失败：找不到当前会话';
            return localforage.getItem(key).then(function (arr) {
                if (!Array.isArray(arr) || !arr.length) return '失败：记录为空';
                var tpl = null;
                for (var j = arr.length - 1; j >= 0; j--) {
                    if (!arr[j].image && (arr[j].text || arr[j].content || arr[j].message)) { tpl = arr[j]; break; }
                }
                if (!tpl) return '失败：没有文字消息可克隆';
                var nm = JSON.parse(JSON.stringify(tpl));
                nm.text = text; nm.content = text; nm.message = text;
                nm.timestamp = new Date();
                if (spkState.field && spkState.selected) nm[spkState.field] = spkState.selected;
                if ('isSent' in nm) nm.isSent = false;
                if ('fromMe' in nm) nm.fromMe = false;
                if ('isMe' in nm) nm.isMe = false;
                if ('id' in nm) nm.id = 'muse_' + Date.now();
                if ('status' in nm) nm.status = 'sent';
                arr.push(nm);
                return localforage.setItem(key, arr).then(function () { return 'ok-reload'; });
            });
        }).catch(function (e) { return '失败：' + (e && e.message); });
    }

    /* ============ 界面 ============ */
    var panel = null, busy = false, currentText = '';
    function setStatus(t) { var s = panel && panel.querySelector('#muse-status'); if (s) s.textContent = t || ''; }

    function injectCss() {
        var s = document.createElement('style');
        s.textContent =
            '#muse-btn{position:fixed;right:60px;top:0;z-index:' + (Z - 3) + ';width:38px;height:38px;' +
            'border-radius:50%;background:rgba(30,30,34,0.85);color:#fff;border:1px solid rgba(255,255,255,0.15);' +
            'font-size:15px;cursor:pointer;font-family:var(--font-family,serif);}' +
            '#muse-panel{position:fixed;left:12px;right:12px;top:0;z-index:' + (Z - 1) + ';' +
            'background:rgba(28,28,32,0.97);border:1px solid rgba(255,255,255,0.14);border-radius:16px;' +
            'padding:14px;color:#fff;font-family:var(--font-family,serif);box-shadow:0 10px 40px rgba(0,0,0,0.4);}' +
            '#muse-panel .mp-title{font-size:13px;font-weight:700;opacity:0.85;margin-bottom:8px;letter-spacing:2px;}' +
            '#muse-spk{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}' +
            '#muse-spk .spk{font-size:11px;padding:4px 10px;border-radius:12px;cursor:pointer;' +
            'background:rgba(255,255,255,0.1);border:1px solid transparent;color:#ccc;}' +
            '#muse-spk .spk.on{background:rgba(76,141,255,0.25);border-color:#4c8dff;color:#fff;}' +
            '#muse-out{min-height:52px;font-size:16px;line-height:1.7;padding:10px 12px;border-radius:10px;' +
            'background:rgba(255,255,255,0.06);margin-bottom:10px;word-break:break-all;}' +
            '#muse-status{font-size:11px;opacity:0.5;height:14px;margin-bottom:8px;}' +
            '#muse-panel .mp-row{display:flex;gap:8px;}' +
            '#muse-panel button{flex:1;padding:9px 0;border:none;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;}' +
            '#muse-panel .mp-go{background:#4c8dff;color:#fff;}' +
            '#muse-panel .mp-use{background:rgba(255,255,255,0.14);color:#fff;}' +
            '#muse-panel .mp-send{background:rgba(120,220,160,0.2);color:#9fe8bf;}' +
            '#muse-panel .mp-x{background:transparent;color:#999;flex:0 0 44px;}';
        document.head.appendChild(s);
    }
    function museLayout() {
        try {
            var inp = document.getElementById('message-input');
            var base = inp ? inp.getBoundingClientRect().top : window.innerHeight - 130;
            if (!base || base < 100) return;
            var b = document.getElementById('muse-btn');
            if (b) b.style.top = (base - 48) + 'px';
            var p = document.getElementById('muse-panel');
            if (p) p.style.top = Math.max(8, base - p.offsetHeight - 56) + 'px';
        } catch (e) {}
    }
    window.addEventListener('resize', function () { setTimeout(museLayout, 200); });

    function renderSpeakers() {
        var box = panel && panel.querySelector('#muse-spk');
        if (!box) return;
        box.innerHTML = '';
        if (!spkState.vals.length) return;
        var label = document.createElement('span');
        label.textContent = '由TA说：';
        label.style.cssText = 'font-size:11px;opacity:0.5;align-self:center;';
        box.appendChild(label);
        spkState.vals.forEach(function (v) {
            var c = document.createElement('span');
            c.className = 'spk' + (v === spkState.selected ? ' on' : '');
            c.textContent = v;
            c.onclick = function () {
                spkState.selected = v;
                try { localStorage.setItem(LS_SPK + corpusKey, v); } catch (e) {}
                renderSpeakers();
            };
            box.appendChild(c);
        });
    }

    function toggle() {
        if (panel) { panel.remove(); panel = null; return; }
        panel = document.createElement('div');
        panel.id = 'muse-panel';
        panel.innerHTML =
            '<div class="mp-title">\u6D3B\u5B57\u7EC4\u5B57 <span style="float:right;opacity:0.4;font-weight:400">\u7B7E\u6389\u51FA\u6765\u662F\u4EC0\u4E48\u5C31\u662F\u4EC0\u4E48</span></div>' +
            '<div id="muse-spk"></div>' +
            '<div id="muse-status"></div>' +
            '<div id="muse-out"><span style="opacity:0.35;font-size:12px">\u70B9\u201C\u6447\u4E00\u7B7E\u201D\uFF0C\u4ED6\u6765\u8BF4\u8BDD</span></div>' +
            '<div class="mp-row">' +
            '<button class="mp-go" id="museGen">\u6447\u4E00\u7B7E</button>' +
            '<button class="mp-use" id="museUse">\u91C7\u7528</button>' +
            '<button class="mp-send" id="museSend">\u4EE5\u4ED6\u7684\u8EAB\u4EFD\u53D1\u51FA</button>' +
            '<button class="mp-x" id="museX">\u2715</button>' +
            '</div>';
        document.body.appendChild(panel);
        museLayout();
        panel.querySelector('#museX').onclick = function () { panel.remove(); panel = null; };
        panel.querySelector('#museGen').onclick = onGenerate;
        panel.querySelector('#museUse').onclick = onUse;
        panel.querySelector('#museSend').onclick = onSend;
        setStatus('\u73AF\u5883\u68C0\u6D4B\u4E2D\u2026');
        getActiveChatKey().then(function (key) {
            return localforage.getItem(key).then(function (list) {
                detectSpeakers(list);
                renderSpeakers();
                setStatus(spkState.vals.length ? ('\u5F53\u524D\u4F1A\u8BDD ' + spkState.vals.length + ' \u4E2A\u58F0\u97F3\uFF0C\u5DF2\u9009\uFF1A' + spkState.selected) : '\u672A\u68C0\u6D4B\u5230\u591A\u89D2\u8272\uFF08\u5355\u4EBA\u4F1A\u8BDD\uFF09');
                setTimeout(function () { if (!busy) setStatus(''); }, 5000);
            });
        }).catch(function () { setStatus(''); });
    }

    function onGenerate() {
        if (busy) return;
        busy = true;
        try {
            currentText = '';
            var out = panel.querySelector('#muse-out');
            out.textContent = '';
            setStatus('\u6B63\u5728\u8F93\u5165\u2026');
            var fail = function (msg) { setStatus(msg); busy = false; };
            var run = function () {
                try {
                    var r = generate();
                    if (!r) { fail('\u8BED\u6599\u4E0D\u591F\uFF0C\u591A\u804A\u51E0\u53E5\u518D\u6765'); return; }
                    setTimeout(function () {
                        try {
                            setStatus('');
                            typeInto(out, r.text, function () {
                                currentText = r.text;
                                busy = false;
                                try {
                                    if (!localStorage.getItem(LS_SEEN)) {
                                        localStorage.setItem(LS_SEEN, '1');
                                        notify('\u901A\u987A\u5F52\u4ED6\uFF0C\u4E71\u7B7E\u5F52\u7B52', 'info', 3500);
                                    }
                                } catch (e) {}
                            });
                        } catch (e) { fail('\u6253\u5B57\u51FA\u9519\uFF1A' + e.message); }
                    }, 600 + rnd(1200));
                } catch (e) { fail('\u751F\u6210\u51FA\u9519\uFF1A' + e.message); }
            };
            if (!chain || corpusKey !== cachedKey) {
                setStatus('\u94F8\u5B57\u4E2D\uFF08\u4EC5\u5F53\u524D\u4F1A\u8BDD\uFF09\u2026');
                buildCorpus().then(function (res) {
                    if (!res.ok) fail('\u8BED\u6599\u4E0D\u591F\uFF1A' + (res.err || ''));
                    else run();
                }).catch(function (e) { fail('\u8BED\u6599\u8BFB\u53D6\u5931\u8D25\uFF1A' + e.message); });
            } else run();
        } catch (e) { setStatus('\u51FA\u9519\uFF1A' + e.message); busy = false; }
    }

    function onUse() {
        try {
            if (!currentText) { notify('\u5148\u6447\u4E00\u7B7E', 'info'); return; }
            var input = document.getElementById('message-input');
            if (!input) { notify('\u627E\u4E0D\u5230\u8F93\u5165\u6846', 'error'); return; }
            input.value = currentText;
            try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            input.focus();
            notify('\u5DF2\u586B\u5165\u8F93\u5165\u6846', 'success');
        } catch (e) { notify('\u91C7\u7528\u51FA\u9519\uFF1A' + e.message, 'error', 4000); }
    }

    function onSend() {
        try {
            if (!currentText) { notify('\u5148\u6447\u4E00\u7B7E', 'info'); return; }
            setStatus('\u5199\u5165\u4F1A\u8BDD\u8BB0\u5F55\u2026');
            injectViaStorage(currentText).then(function (r) {
                if (r === 'ok-reload') {
                    try { localStorage.setItem('muse_flash', '1'); } catch (e) {}
                    setTimeout(function () { location.reload(); }, 400);
                } else {
                    setStatus(r);
                    notify(r, 'warning', 6000);
                }
            });
        } catch (e) { notify('\u53D1\u51FA\u51FA\u9519\uFF1A' + e.message, 'error', 4000); }
    }

    /* ============ 启动 ============ */
    window.addEventListener('load', function () {
        try {
            if (localStorage.getItem('muse_flash')) {
                localStorage.removeItem('muse_flash');
                setTimeout(function () { notify('\u4ED6\u53D1\u6765\u4E86', 'success', 3000); }, 1200);
            }
        } catch (e) {}
        injectCss();
        museLayout();
        setInterval(museLayout, 3000);
        setTimeout(function () {
            if (!document.getElementById('muse-btn')) {
                var b = document.createElement('button');
                b.id = 'muse-btn';
                b.textContent = '\u7075';
                b.title = '\u6D3B\u5B57\u7EC4\u5B57';
                b.onclick = toggle;
                document.body.appendChild(b);
                museLayout();
            }
        }, 2500);
        setTimeout(museLayout, 3000);
    });
})();
