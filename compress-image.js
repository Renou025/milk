/* 图片上传自动压缩（追加到 milk 站）
   原理：拦截 FileReader.readAsDataURL —— 全站图片上传都会走这一步转文本存储。
   大图先经 canvas 缩放重编码再交给站点，小图/GIF 原样通过。 */
(function () {
    'use strict';

    var MAX_EDGE = 1280;          // 最长边像素（超过则等比缩小）
    var QUALITY = 0.75;           // JPEG/WebP 编码质量
    var TRIGGER = 250 * 1024;     // 小于 250KB 的图不压（省 CPU）
    var LS_NOTE = 'imgCompress_noted';

    function noteOnce() {
        try {
            if (localStorage.getItem(LS_NOTE)) return;
            localStorage.setItem(LS_NOTE, '1');
            if (typeof showNotification === 'function') {
                showNotification('大图已自动压缩后保存', 'success', 2500);
            }
        } catch (e) {}
    }

    function compress(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
                try {
                    var w = img.width, h = img.height;
                    if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('bad image')); return; }
                    var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
                    var cw = Math.max(1, Math.round(w * scale));
                    var ch = Math.max(1, Math.round(h * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = cw;
                    canvas.height = ch;
                    var ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, cw, ch);
                    URL.revokeObjectURL(url);
                    var keepAlpha = /png|webp/i.test(blob.type || '');
                    var out = keepAlpha
                        ? canvas.toDataURL('image/webp', QUALITY)
                        : canvas.toDataURL('image/jpeg', QUALITY);
                    if (out && out.length > 64 && out.indexOf('data:image') === 0) {
                        resolve(out);
                    } else {
                        reject(new Error('encode failed'));
                    }
                } catch (e) {
                    try { URL.revokeObjectURL(url); } catch (_) {}
                    reject(e);
                }
            };
            img.onerror = function () { try { URL.revokeObjectURL(url); } catch (_) {}; reject(new Error('decode failed')); };
            img.src = url;
        });
    }

    var origRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
        try {
            if (blob && blob.type && /^image\//.test(blob.type) && blob.type !== 'image/gif' &&
                typeof blob.size === 'number' && blob.size > TRIGGER) {
                var reader = this;
                compress(blob).then(function (dataUrl) {
                    // 压完反而更大（如已是高压缩图），回退原图
                    if (dataUrl.length >= blob.size) { origRead.call(reader, blob); return; }
                    try { Object.defineProperty(reader, 'readyState', { value: 2, configurable: true }); } catch (e) {}
                    Object.defineProperty(reader, 'result', { value: dataUrl, configurable: true });
                    if (typeof reader.onload === 'function') reader.onload({ target: reader });
                    else { try { reader.dispatchEvent(new Event('load')); } catch (e) {} }
                    if (typeof reader.onloadend === 'function') reader.onloadend({ target: reader });
                    else { try { reader.dispatchEvent(new Event('loadend')); } catch (e) {} }
                    noteOnce();
                }).catch(function () {
                    origRead.call(reader, blob);
                });
                return;
            }
        } catch (e) {}
        return origRead.call(this, blob);
    };
})();
