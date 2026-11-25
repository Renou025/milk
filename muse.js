/* muse.js —— 活字组字器
   机制：从真实聊天记录抽语料铸铅字（马尔可夫链）+ 记忆锚点 + 每次暗骰火候（不可见）
   体验："正在输入…" → 拟人打字逐字蹦出 → 通顺归他，乱签归筒 */
(function () {
    'use strict';

    var Z = 2147482900;
    var LS_SEEN = 'muse_seenTip';

    function notify(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info', 2500); }
    function rnd(n) { return Math.floor(Math.random() * n); }
    function pick(arr) { return arr[rnd(arr.length)]; }

    /* ============ 语料：铸铅字 ============ */
    var chain = null;   // {char: {nextChar: count}}
    var vocab = [];
    var anchors = [];   // 记忆锚点碎片

    function addToChain(text) {
        if (!text) return;
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

    function msgTextOf(m) {
        if (typeof m === 'string') return m;
        if (!m || typeof m !== 'object') return '';
        if (m.image || m.__mRef) return '';
        var v = m.text || m.content || m.message || m.msg || '';
        return typeof v === 'string' ? v : '';
    }

    function buildCorpus() {
        chain = {};
        vocab = [];
        anchors = [];
        if (!(window.ChatBackup && ChatBackup.buildBackupPayload)) return Promise.resolve(false);
        return ChatBackup.buildBackupPayload({
            inclMsgs: true, inclSet: false, inclCustom: false,
            inclAnn: false, inclThemes: false, inclDg: false, inclStickers: false
        }).then(function (payload) {
            var lf = payload.localforage || {};
            Object.keys(lf).forEach(function (key) {
                if (key.indexOf('chatMessages') === -1) return;
                var val = lf[key];
                var list = Array.isArray(val) ? val : (val && val.messages) || [];
                list.forEach(function (m) {
                    var t = msgTextOf(m);
                    if (!t || t.length < 2) return;
                    t = t.replace(/\{[^{}]*__mRef[^{}]*\}/g, '').trim();
                    if (t.length < 2 || t.length > 80) return;
                    addToChain(t);
                    if (t.length >= 4 && t.length <= 30) anchors.push(t);
                    Array.from(t).forEach(function (c) { if (vocab.indexOf(c) === -1) vocab.push(c); });
                });
            });
            return Object.keys(chain).length > 5;
        }).catch(function () { return false; });
    }

    /* ============ 生成：暗骰火候 + 锚点 + 接龙 ============ */
    function weightedPick(entries, temp) {
        // entries: [[char, count], ...]；temp 越高越平（越混沌）
        var total = 0;
        var weights = entries.map(function (e) {
            var w = Math.pow(e[1], 1 / temp);
            total += w;
            return w;
        });
        var r = Math.random() * total;
        for (var i = 0; i < entries.length; i++) {
            r -= weights[i];
            if (r <= 0) return entries[i][0];
        }
        return entries[entries.length - 1][0];
    }

    function generate() {
        if (!chain) return null;
        var temp = 0.35 + Math.random() * 1.4;   // 火候天定，用户不可见
        var out = '';
        var prev = '^';

        // 记忆锚点：60% 概率从一个真实碎片开头
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
            out += next;
            prev = next;
            if (/[。？！…]$/.test(out) && out.length > 6) break;
        }
        out = out.trim();
        if (out.length < 2) return null;
        return { text: out, temp: temp };
    }

    /* ============ 拟人打字 ============ */
    function typeInto(el, text, done) {
        el.textContent = '';
        var chars = Array.from(text);
        var i = 0;
        function step() {
            if (i >= chars.length) { if (done) done(); return; }
            var burst = 1 + rnd(3);              // 1~3字一小串（词组连打）
            for (var b = 0; b < burst && i < chars.length; b++) {
                el.textContent += chars[i++];
            }
            var last = el.textContent.slice(-1);
            var delay;
            if (/[。？！，、；…]/.test(last)) delay = 240 + rnd(200);   // 标点歇半拍
            else if (Math.random() < 0.06) delay = 500 + rnd(500);     // 偶尔斟酌
            else delay = 45 + rnd(110);
            setTimeout(step, delay);
        }
        step();
    }

    /* ============ 以他的身份发出 ============ */
    function injectAsPartner(text) {
        var msgs = window.messages;
        if (!Array.isArray(msgs) || typeof renderMessages !== 'function') return false;
        var template = null;
        for (var i = msgs.length - 1; i >= 0; i--) {
            var m = msgs[i];
            var isPartner = (m.sender === 'partner' || m.type === 'received' || m.isSent === false || (m.sender !== 'me' && m.isSent !== true && m.text));
            if (isPartner && !m.image) { template = m; break; }
        }
        if (!template) {   // 兜底：任意一条纯文字消息
            for (var j = msgs.length - 1; j >= 0; j--) {
                if (msgs[j].text && !msgs[j].image) { template = msgs[j]; break; }
            }
        }
        if (!template) return false;
        try {
            var nm = JSON.parse(JSON.stringify(template));
            nm.text = text;
            if ('content' in nm) nm.content = text;
            nm.timestamp = new Date();
            if ('id' in nm) nm.id = 'muse_' + Date.now();
            if ('time' in nm) nm.time = nm.timestamp;
            msgs.push(nm);
            renderMessages();
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); else if (typeof saveData === 'function') saveData(); } catch (e) {}
            try { if (typeof playSound === 'function') playSound('message'); } catch (e) {}
            var c = document.getElementById('chat-container');
            if (c) c.scrollTop = c.scrollHeight;
            return true;
        } catch (e) { return false; }
    }

    /* ============ 界面 ============ */
    var panel = null;
    function injectCss() {
        var s = document.createElement('style');
        s.textContent =
            '#muse-btn{position:fixed;right:60px;top:0;z-index:' + (Z - 3) + ';width:38px;height:38px;' +
            'border-radius:50%;background:rgba(30,30,34,0.85);color:#fff;border:1px solid rgba(255,255,255,0.15);' +
            'font-size:15px;cursor:pointer;font-family:var(--font-family,serif);}' +
            '#muse-panel{position:fixed;left:12px;right:12px;top:0;z-index:' + (Z - 1) + ';' +
            'background:rgba(28,28,32,0.97);border:1px solid rgba(255,255,255,0.14);border-radius:16px;' +
            'padding:14px;color:#fff;font-family:var(--font-family,serif);box-shadow:0 10px 40px rgba(0,0,0,0.4);}' +
            '#muse-panel .mp-title{font-size:13px;font-weight:700;opacity:0.85;margin-bottom:10px;letter-spacing:2px;}' +
            '#muse-out{min-height:56px;font-size:16px;line-height:1.7;padding:10px 12px;border-radius:10px;' +
            'background:rgba(255,255,255,0.06);margin-bottom:10px;word-break:break-all;}' +
            '#muse-out .mp-typing{color:#8ab4ff;}' +
            '#muse-status{font-size:11px;opacity:0.5;height:14px;margin-bottom:8px;}' +
            '#muse-panel .mp-row{display:flex;gap:8px;}' +
            '#muse-panel button{flex:1;padding:9px 0;border:none;border-radius:9px;font-size:12px;' +
            'font-weight:600;cursor:pointer;}' +
            '#muse-panel .mp-go{background:#4c8dff;color:#fff;}' +
            '#muse-panel .mp-use{background:rgba(255,255,255,0.14);color:#fff;}' +
            '#muse-panel .mp-send{background:rgba(120,220,160,0.2);color:#9fe8bf;}' +
            '#muse-panel .mp-x{background:transparent;color:#999;flex:0 0 44px;}';
        document.head.appendChild(s);
    }

    function ensureBtn() {
        if (document.getElementById('muse-btn')) return;
        var b = document.createElement('button');
        b.id = 'muse-btn';
        b.textContent = '\u7075';
        b.title = '活字组字';
        b.onclick = toggle;
        document.body.appendChild(b);
    }

    function toggle() {
        if (panel) { panel.remove(); panel = null; return; }
        panel = document.createElement('div');
        panel.id = 'muse-panel';
        panel.innerHTML =
            '<div class="mp-title">\u6D3B\u5B57\u7EC4\u5B57 <span style="float:right;opacity:0.4;font-weight:400">\u7B7E\u6389\u51FA\u6765\u662F\u4EC0\u4E48\u5C31\u662F\u4EC0\u4E48</span></div>' +
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
    }

    var currentText = '';
    var busy = false;

    function statusEl() { return panel ? panel.querySelector('#muse-status') : null; }
    function outEl() { return panel ? panel.querySelector('#muse-out') : null; }

    function onGenerate() {
        if (busy) return;
        busy = true;
        currentText = '';
        var st = statusEl(), out = outEl();
        out.textContent = '';
        st.textContent = '\u6B63\u5728\u8F93\u5165\u2026';

        var run = function () {
            var r = generate();
            if (!r) {
                st.textContent = '\u8BED\u6599\u4E0D\u591F\uFF0C\u591A\u804A\u51E0\u53E5\u518D\u6765';
                busy = false;
                return;
            }
            setTimeout(function () {
                st.textContent = '';
                typeInto(out, r.text, function () {
                    currentText = r.text;
                    busy = false;
                    if (!localStorage.getItem(LS_SEEN)) {
                        localStorage.setItem(LS_SEEN, '1');
                        notify('\u901A\u987A\u5F52\u4ED6\uFF0C\u4E71\u7B7E\u5F52\u7B52', 'info', 3500);
                    }
                });
            }, 600 + rnd(1200));
        };

        if (!chain) {
            st.textContent = '\u9996\u6B21\u4F7F\u7528\uFF0C\u6B63\u5728\u94F8\u5B57\u2026';
            buildCorpus().then(function (ok) {
                if (!ok) st.textContent = '\u8BED\u6599\u4E0D\u591F\uFF1A\u9700\u8981\u5148\u6709\u804A\u5929\u8BB0\u5F55\uFF08\u81F3\u5C11\u51E0\u53E5\u6587\u5B57\u6D88\u606F\uFF09';
                else run();
            });
        } else run();
    }

    function onUse() {
        if (!currentText) { notify('\u5148\u6447\u4E00\u7B7E', 'info'); return; }
        var input = document.getElementById('message-input');
        if (!input) { notify('\u627E\u4E0D\u5230\u8F93\u5165\u6846', 'error'); return; }
        input.value = currentText;
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        input.focus();
        notify('\u5DF2\u586B\u5165\u8F93\u5165\u6846\uFF0C\u786E\u8BA4\u540E\u53D1\u51FA', 'success');
    }

    function onSend() {
        if (!currentText) { notify('\u5148\u6447\u4E00\u7B7E', 'info'); return; }
        if (injectAsPartner(currentText)) {
            notify('\u4ED6\u53D1\u6765\u4E86', 'success');
        } else {
            notify('\u63A5\u5165\u804A\u5929\u5931\u8D25\uFF0C\u6539\u7528\u201C\u91C7\u7528\u201D\u624B\u52A8\u53D1', 'warning', 3500);
        }
    }


    function museLayout() {
        var inp = document.getElementById('message-input');
        var base = inp ? inp.getBoundingClientRect().top : window.innerHeight - 130;
        var b = document.getElementById('muse-btn');
        if (b) b.style.top = (base - 48) + 'px';
        var p = document.getElementById('muse-panel');
        if (p) p.style.top = Math.max(8, base - p.offsetHeight - 56) + 'px';
    }
    window.addEventListener('resize', function () { setTimeout(museLayout, 200); });

    /* ============ 启动 ============ */
    window.addEventListener('load', function () {
        injectCss();
        museLayout();
        setInterval(museLayout, 3000);
        setTimeout(ensureBtn, 2500);
        setTimeout(museLayout, 3000);
    });
})();
