/* global module */
(function() {

    'use strict';

    var CONFIG = {
        HTMLScriptElement: ['script-src', 'src'],
        HTMLLinkElement: ['style-src', 'href'],
        HTMLStyleElement: ['style-src', 'textContent'],
        HTMLImageElement: ['img-src', 'src'],
        FontFace: ['font-src'],
        open: ['content-src'],
        XMLHttpRequest: ['content-src'],
        WebSocket: ['content-src'],
        EventSource: ['content-src'],
        HTMLVideoElement: ['media-src', 'src'],
        HTMLAudioElement: ['media-src', 'src'],
        HTMLSourceElement: ['media-src', 'src'],
        HTMLTrackElement: ['media-src', 'src'],
        HTMLObjectElement: ['object-src', 'data'],
        HTMLEmbedElement: ['object-src', 'src'],
        HTMLIFrameElement: ['frame-src', 'src']
    };

    var SRC_KEYS = ['src', 'href', 'data'];

    function isSrc(key) {
        return SRC_KEYS.indexOf(key) !== -1;
    }

    function ResouceInterceptor(window, safe) {

        if (typeof MutationObserver !== 'function') {
            return;
        }

        var that = this;

        this.window = window;
        this.safe = safe;
        this.link = window.document.createElement('a');
        this.setters = {};

        Object.keys(CONFIG).forEach(function(name) {

            var controller = window[name];
            var type = CONFIG[name][0];

            if (!controller) {
                return;
            }

            function hook(controller, index) {
                return function() {
                    var params = Array.prototype.slice.call(arguments);
                    var url = params[index];
                    if (typeof url === 'string') {
                        url = that.getResolveUrl(url);
                        url = safe(url, type);
                    }
                    controller.apply(this || window, params);
                };
            }

            switch (name) {
                case 'FontFace':
                    window[name] = hook(controller, 1);
                    break;
                case 'open':
                    window[name] = hook(controller, 0);
                    break;
                case 'XMLHttpRequest':
                    window[name].prototype.open = hook(controller.prototype.open, 1);
                    break;
                case 'WebSocket':
                case 'EventSource':
                    window[name] = hook(controller, 0);
                    window[name].prototype = Object.create(controller.prototype);
                    window[name].prototype.constructor = controller;
                    break;
                    // 拦截动态元素
                default:
                    var src = CONFIG[name][1];
                    var prototype = controller.prototype;
                    var srcSetter = prototype.__lookupSetter__(src);
                    var setAttribute = prototype.setAttribute;

                    that.setters[name] = srcSetter;

                    prototype.__defineSetter__(src, function(url) {
                        url = getUrl(this, url);
                        srcSetter.call(this, url);
                    });

                    prototype.setAttribute = function(name, url) {
                        if (name === src) {
                            url = getUrl(this, url);
                        }
                        setAttribute.call(this, name, url);
                    };

                    function getUrl(node, url) {
                        that.setResouceHook(node);

                        if (isSrc(src)) {
                            url = that.getResolveUrl(url);
                            url = safe(url, type);
                        }

                        // 对扫描过后的元素添加特殊标记，
                        // 避免 MutationObserver 方案的重复扫描
                        node._asyncHook = true;

                        return url;
                    }
            }


        });


        // 拦截静态元素
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {

                var nodes = mutation.addedNodes;
                var length = nodes.length;
                var name, src, setter, url, node, i, type;

                for (i = 0; i < length; i++) {
                    node = nodes[i];
                    name = node.constructor.name;

                    if (CONFIG[name] && !node._asyncHook) {
                        type = CONFIG[name][0];
                        src = CONFIG[name][1];
                        setter = that.setters[name];
                        url = node[src];

                        that.setResouceHook(node);

                        // 注意：script 标签可以没有 src 属性
                        if (url && isSrc(src)) {
                            url = safe(url, type);
                            setter.call(node, url);
                        }

                    }
                }
            });
        });

        window.document.addEventListener('load', function() {
            observer.disconnect();
        });

        observer.observe(window.document, {
            subtree: true,
            childList: true
        });
    }
    ResouceInterceptor.prototype = {
        controller: ResouceInterceptor,

        /**
         * 获取绝对路径
         * @param   {String}    路径
         * @return  {String}    绝对路径
         */
        getResolveUrl: function(url) {
            this.link.href = url;
            return this.link.href;
        },


        setResouceHook: function(node) {
            var name = node.constructor.name;
            var that = this;
            if (name === 'HTMLLinkElement') {
                if (!node._loadHook) {
                    node.addEventListener('load', function() {
                        that.setStyleHook(this);
                    });
                    node._loadHook = true;
                }
            } else if (name === 'HTMLStyleElement') {
                this.setStyleHook(node);
            }
        },


        /**
         * 给样式内的资源加上 Hook
         * @param   {HTMLElement}
         * 限制：
         * 无法改变 @import 的 url
         * 无法拦截行内样式
         * 跨域限制（解决：https://developer.mozilla.org/zh-CN/docs/Web/HTML/CORS_settings_attributes）
         */
        setStyleHook: function(node) {
            var that = this;
            var window = this.window;
            var safe = this.safe;
            var sheet = node.sheet;

            if (!sheet) {
                return;
            }

            var cssRuleList = sheet.cssRules || [];
            var url = /url\(("|')?(.*?)\1?\)/ig;
            var keys = ['backgroundImage', 'borderImage', 'listStyleImage', 'cursor', 'content', 'src'];

            function cssRuleListFor(cssRuleList, callback) {
                var index = -1;
                var length = cssRuleList.length;
                var cssRule, cssStyleSheet;

                while (++index < length) {
                    cssRule = cssRuleList[index];

                    if (cssRule instanceof window.CSSImportRule) {
                        cssStyleSheet = cssRule.styleSheet;
                        cssRuleListFor(cssStyleSheet.cssRules || [], callback);
                    } else if (cssRule instanceof window.CSSMediaRule) {
                        cssRuleListFor(cssRule.cssRules || [], callback);
                    } else {
                        callback(cssRule);
                    }
                }
            }

            cssRuleListFor(cssRuleList, function(cssRule) {
                keys.forEach(function(key) {
                    if (cssRule.style && cssRule.style[key]) {
                        cssRule.style[key] = cssRule.style[key].replace(url, function($0, $1, $2) {
                            var type = key === 'src' ? 'font-src' : 'img-src';
                            var baseURI = cssRule.parentStyleSheet.href || window.document.baseURI;
                            var dir = baseURI.replace(/\/[^\/]*?$/, '/');
                            var url = /^(?!\w+?:).+$/.test($2) ? that.getResolveUrl(dir + $2) : $2;
                            url = safe(url, type);
                            return 'url(' + $1 + url + $1 + ')';
                        });
                    }
                });
            });
        }
    };

    if (typeof exports !== 'undefined') {
        module.exports = ResouceInterceptor;
    } else {
        window.ResouceInterceptor = ResouceInterceptor;
    }
})();