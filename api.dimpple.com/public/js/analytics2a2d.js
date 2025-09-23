;(function(window, document){
    const SCRIPT_URL = 'https://api.dimpple.com'; // FSN
    const API_VERSION = 'v1';
    
    let paramNames = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'src', 'SRC', 'af', 'AF', 'sck', 'SCK'];

    let trkCode = null;
    let leadId = null;
    let captured = {};
    let dimpplePingInterval = null;
    let formsData = [];
    
    let started = false;

    const delegatedEvents = new WeakMap();

    // Define um conjunto de eventos padrão do Facebook
    const STANDARD_EVENTS = new Set([
        'PageView', 'Lead', 'ViewContent', 'AddToWishlist', 'AddToCart', 'AddPaymentInfo', 'InitiateCheckout',
        'StartTrial', 'Subscribe', 'Purchase', 'Contact', 'CompleteRegistration', 'SubmitApplication',
        'Search', 'Schedule'
    ]);

    /**
     * Função para obter/gerar o leadId cross‑domain.
     * 
     * @returns {Promise}
     */ 
    let getCrossDomainLead = () => {
        return new Promise(resolve => {
            const BRIDGE_URL  = 'https://api.dimpple.com/public/html/analytics.html'; // FSN
            const STORAGE_KEY = 'dimpple_lead_id';
            const bridgeOrigin = new URL(BRIDGE_URL).origin;

            // Tenta pegar da URL: utm_content (após primeiro "|")
            let leadIdFromUrl = '';
            const urlParams = new URLSearchParams(window.location.search);
            const utmContent = urlParams.get('utm_content');

            if (utmContent && utmContent.includes('|')) {
                const parts = utmContent.split('|');
                if (parts.length >= 2 && isValidUUID(parts[1])) {
                    leadIdFromUrl = parts[1];
                    try { localStorage.setItem(STORAGE_KEY, leadIdFromUrl); } catch (_) {}
                    window.name = leadIdFromUrl;
                    return resolve(leadIdFromUrl);
                }
            }
        
            // Tentativa sync localStorage
            let id = null;
            try {
                id = localStorage.getItem(STORAGE_KEY);
            } catch (_) {}
            
            if (id) {
                return resolve(id);
            }
        
            // Tentativa sync window.name
            if (window.name) {
                id = window.name;
                try { localStorage.setItem(STORAGE_KEY, id); } catch(_) {}
                return resolve(id);
            }
        
            // Fallback via iframe + bridge
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = BRIDGE_URL;
        
            let settled = false;
            let timeoutId;
        
            function finalize(gotId) {
                if (settled) return;
                settled = true;
                // Grava onde der
                try { localStorage.setItem(STORAGE_KEY, gotId); } catch(_) {}
                window.name = gotId;
                cleanup();
                resolve(gotId);
            }
        
            function cleanup() {
                window.removeEventListener('message', onMessage);
                clearTimeout(timeoutId);
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }
        
            function onMessage(e) {
                if (e.origin !== bridgeOrigin) return;
                const msg = e.data || {};
                if (msg.type !== 'dimpple:leadId') return;
                let leadId = msg.leadId;
                if (!leadId) {
                    leadId = generateUUID();
                    iframe.contentWindow.postMessage(
                        { type: 'dimpple:setLeadId', leadId },
                        bridgeOrigin
                    );
                }
                finalize(leadId);
            }
        
            window.addEventListener('message', onMessage);
        
            iframe.onload = () => {
                iframe.contentWindow.postMessage(
                    { type: 'dimpple:getLeadId' },
                    bridgeOrigin
                );
            };
        
            // Injeta iframe
            if (document.body) {
                document.body.appendChild(iframe);
            } else {
                document.addEventListener('DOMContentLoaded', () =>
                    document.body.appendChild(iframe)
                );
            }
        
            // Timeout fallback
            timeoutId = setTimeout(() => {
                finalize(generateUUID());
            }, 500);
        });
    }
    
    /**
     * Identifica e retorna um parâmetro da URL especificada.
     * 
     * @param {string} name Parâmetro solicitado.
     * @param {string} url URL especificada.
     * 
     * @returns {string}
     */
    let getParam = (name, url) => {
        name = name.replace(/[[\]]/g, '\\$&');
        
        var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
        var results = regex.exec(url);
        
        if (!results || !results[2]) return null;
        
        return decodeURIComponent(results[2].replace(/\+/g, ' '));
    }

    /**
     * Gera um identificador UUID v4 para o lead.
     * 
     * @returns {string}
     */
    let generateUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c=='x'? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    /**
     * Retorna uma URL com os params adicionados,
     * preservando fragmento e query existente.
     * 
     * - utm_content sempre é sobrescrito com leadId|fbp|fbc
     * - Outros parâmetros só são inseridos se ainda não existirem.
     *
     * @param {string} url URL original.
     * @param {object} params Parâmetros a serem adicionados.
     * 
     * @returns {string}
     */
    function appendParams(url, params) {
        // Separa fragmento
        const [baseAndQs, frag = ''] = url.split('#');
        const hash = frag ? `#${frag}` : '';
      
        // Base e query existente
        const [base, existingQs = ''] = baseAndQs.split('?');
        const usp = new URLSearchParams(existingQs);
      
        // Captura cookies _fbp/_fbc
        const ck = document.cookie.split('; ').reduce((o, kv) => {
            const [k,v] = kv.split('=');
            o[k] = v; 
            return o;
        }, {});
        const fbp = ck._fbp || '';
        const fbc = ck._fbc || '';

        let composite;

        let utm = params.utm_content 
            || localStorage.getItem('dimpple_ad_id') 
            || '';

        // Ajuste para compatibilidade com links da UTMify
        if (utm.includes('|')) {
            const parts = utm.split('|');

            if (parts.length === 2 && isLikelyAdId(parts[1])) {
                // Compatibilidade com links antigos da UTMify: assume que o segundo é o ad_id
                utm = parts[1];
            }

            composite = utm;
        }
        
        if (!utm.includes('|')) {
            if (utm && isLikelyAdId(utm)) {
                localStorage.setItem('dimpple_ad_id', utm);
            }
        
            // Monta o utm_content composto
            composite = utm + '|' + leadId + '|' + fbp + '|' + fbc;
        }
      
        // Sempre sobrescreve utm_content
        usp.set('utm_content', composite);
      
        // Garante sck e src (apenas se não existirem)
        if (!usp.has('sck')) usp.set('sck', composite);
        if (!usp.has('src')) usp.set('src', composite);
      
        // Agora o loop pros outros params
        Object.entries(params).forEach(([key, val]) => {
            if (val == null || val === '') return;
            
            // Pula os já tratados
            if (key === 'utm_content' || key === 'sck' || key === 'src') return;
            
            // Só adiciona se não existir
            if (!usp.has(key)) {
                usp.append(key, val);
            }
        });
        
        // Reconstrói e retorna
        const newQs = usp.toString();
        return base + (newQs ? `?${newQs}` : '') + hash;
    }

    /**
     * Verifica e retorna se o parâmetro informado tem o formado
     * do ID de anúncio da Meta.
     * 
     * @param {string} value
     * @returns {boolean}
     */
    function isLikelyAdId(value) {
        return /^\d{12,}$/.test(value);
    }

    /**
     * Verifica se a string é um UUID válido (versão 1 a 5).
     * @param {string} uuid
     * @returns {boolean}
     */
    function isValidUUID(uuid) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
    }

    /**
     * Processa os links da página e adiciona os parâmetros da chamada
     * original para que sejam repassados. Não processa chamadas javascript
     * e âncoras.
     * 
     * @returns {void}
     */
    function propagateParams() {
        document
        .querySelectorAll('a[href]')
        .forEach(a => {
            const raw = a.getAttribute('href');
            if (!raw) return;
    
            const href = raw.trim();
            
            // Pula javascript:, âncoras internas e mailto/tel
            if (
                href.startsWith('javascript:') ||
                href.startsWith('#') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:')
            ) return;
    
            try {
                a.setAttribute('href', appendParams(href, captured));
            } catch (err) {
                console.error('propagateParams error:', err);
            }
        });

        if (!started) {
            // Coloca no escopo externo para podermos desconectar/reconectar
            const hrefObserver = new MutationObserver(mutations => {
                // Desligamos antes de qualquer alteração
                hrefObserver.disconnect();

                mutations.forEach(m => {
                    const a = m.target;

                    if (
                        m.type === 'attributes' &&
                        m.attributeName === 'href' &&
                        a.tagName === 'A'
                    ) {
                        const raw = a.getAttribute('href')?.trim();
                        if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) {
                            return;
                        }
                        
                        try {
                            a.setAttribute('href', appendParams(raw, captured));
                        } catch (err) {}
                    }

                    if (m.type === 'childList') {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType !== 1) return; // Apenas elementos
    
                            const links = node.matches?.('a[href]')
                                ? [node]
                                : Array.from(node.querySelectorAll?.('a[href]') || []);
                
                            links.forEach(a => {
                                const raw = a.getAttribute('href')?.trim();
                                if (
                                    raw &&
                                    !raw.startsWith('#') &&
                                    !raw.startsWith('javascript:')
                                ) {
                                    try {
                                        a.setAttribute('href', appendParams(raw, captured));
                                    } catch (err) {}
                                }
                            });
                        });
                    }
                });
                
                // Religamos o observer
                hrefObserver.observe(document.body, {
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['href'],
                    childList: true
                });
            });
                
            // Agora começa a observar mudanças
            hrefObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['href'],
                childList: true
            });

            // ;(function() {
            //     // 1) Pega o descriptor original de href
            //     const locProto = Object.getPrototypeOf(window.location);
            //     const hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
            //     // 2) Define um novo setter/getter
            //     Object.defineProperty(locProto, 'href', {
            //         configurable: true,
            //         enumerable:   true,
            //         get() {
            //             return hrefDesc.get.call(this);
            //         },
            //         set(url) {
            //             try {
            //                 // 3) intercepta a URL antes de mudar
            //                 const fixed = appendParams(String(url), captured);
            //                 return hrefDesc.set.call(this, fixed);
            //             } catch (e) {
            //                 // em caso de falha, cai para o comportamento normal
            //                 return hrefDesc.set.call(this, url);
            //             }
            //         }
            //     });
            // })();  

            // ;(function(){
            //     const _open = window.open;
            //     window.open = function(url, ...args) {
            //         try {
            //             const fixed = appendParams(String(url), captured);
            //             return _open.call(this, fixed, ...args);
            //         } catch (_) {
            //             return _open.call(this, url, ...args);
            //         }
            //     };
            // })();

            // 3) Observador de mutações para anchors injetados (ex: vTurb)
            // ;(function(){
            //     if (!window.MutationObserver) return;

            //     const observer = new MutationObserver((mutations) => {
            //         for (const m of mutations) {
            //             for (const node of m.addedNodes) {
            //                 if (!(node instanceof Element)) continue;
            //                 // se um <a> foi injetado, reaplica propagateParams
            //                 if (node.tagName === 'A' && node.href) {
            //                     propagateParams();
            //                 }
            //             }
            //         }
            //     });
            //     observer.observe(document.body, { childList: true, subtree: true });
            // })();

            // document.body.addEventListener('click', e => {
            //     const a = e.target.closest('a[href]');
            //     if (!a) return;
            //     const href = a.getAttribute('href');
            //     if (href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;

            //     // força a navegação com os params aplicados
            //     e.preventDefault();
            //     const newHref = appendParams(href, captured);
            //     window.location.href = newHref;
            // });

            started = true;
        }
    }

    /**
     * Carrega de forma assíncrona o SDK do Facebook Pixel
     * e invoca callback assim que estiver pronto.
     */
    function loadFacebookLib(callback) {
        if (window.fbq) {
            return callback();
        }

        !(function(f,b,e,v,n,t,u) {
            if (f.fbq) return; n=f.fbq=function() {
                n.callMethod? n.callMethod.apply(n,arguments) : n.queue.push(arguments);
            };
            if (!f._fbq) f._fbq = n;
            n.push = n; n.loaded = !0; n.version = '2.0';
            n.queue = [];
            t = b.createElement(e); t.async = !0; t.src = v;
            u = b.getElementsByTagName(e)[0];
            u.parentNode.insertBefore(t, u);
            t.onload = callback;
        })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }
    
    /**
     * Inicializa os pixels do Facebook com base na configuração.
     * 
     * @param {object} cfg Configuração recebida, com os pixels e event codes.
     * 
     * @returns {Promise<void>}
     */
    function initFbPixelsFromConfig(cfg) {
        if (!cfg || !Array.isArray(cfg.data)) {
            return Promise.resolve();
        }

        // Coleta e deduplica os pixels, mantendo o test_event_code
        const pixelMap = new Map();

        cfg.data.forEach(item => {
            (item.pixels || []).forEach(pixelPair => {
                if (Array.isArray(pixelPair) && pixelPair[0]) {
                    const pixelId = pixelPair[0];
                    const testCode = pixelPair[1] || '';

                    if (!pixelMap.has(pixelId)) {
                        pixelMap.set(pixelId, testCode);
                    }
                }
            });
        });

        const pixelIds = Array.from(pixelMap.entries());

        if (!pixelIds.length) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            loadFacebookLib(() => {
                // Extrai cookies fbp e fbc
                const allCookies = document.cookie.split('; ');
                const fbp = allCookies.find(c => c.startsWith('_fbp='))?.split('=')[1] || '';
                const fbc = allCookies.find(c => c.startsWith('_fbc='))?.split('=')[1] || '';

                pixelIds.forEach(id => {
                    const rawUserData = {
                        fbp: fbp,
                        fbc: fbc,
                        em: normalizeParam('em', localStorage.getItem('em') ?? ''),
                        fn: normalizeParam('fn', localStorage.getItem('fn') ?? ''),
                        ln: normalizeParam('ln', localStorage.getItem('ln') ?? ''),
                        ph: normalizeParam('ph', localStorage.getItem('ph') ?? ''),
                        ct: normalizeParam('ct', localStorage.getItem('ct') ?? ''),
                        st: normalizeParam('st', localStorage.getItem('st') ?? ''),
                        zp: normalizeParam('zp', localStorage.getItem('zp') ?? ''),
                        country: normalizeParam('country', localStorage.getItem('country') ?? ''),
                        client_user_agent: navigator.userAgent,
                        client_ip_address: localStorage.getItem('ip') ?? '',
                        external_id: leadId
                    };

                    const cleanedUserData = cleanDeep(rawUserData);

                    fbq('init', id[0], cleanedUserData);
                });

                resolve();
            });
        });
    }

    /**
     * Monta o objeto de parâmetros para o fbq a partir da configuração.
     * 
     * @param {object} item Objeto de dados originais.
     * 
     * @returns {object} Dados tratados.
     */
    function buildFbParams(item) {
        const p = {};
        if (item.product_code) p.content_ids = [item.product_code];
        if (item.content_name) p.content_name = item.content_name;
        if (item.product_name) p.content_name = item.product_name;
        if (item.content_name || item.product_name) p.content_type = 'product';
        if (item.product_currency) p.currency = item.product_currency ?? 'BRL';
        if (item.product_value) p.value = (item.product_value / 100);
        if (item.predicted_ltv) p.predicted_ltv = (item.predicted_ltv / 100);

        // Detecta o tipo de dispositivo
        const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
        const deviceType = isMobile ? 'mobile' : 'desktop';

        // Dados de data
        const now = new Date();

        const day = now.getDate();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const weekday_name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

        // Valores adicionais
        p.page_title = document.title;
        p.referrer = document.referrer || '';
        p.device_platform = deviceType;
        p.device_system = getDeviceSystem();
        p.device_browser = getDeviceBrowser();
        p.event_day = day;
        p.event_month = month;
        p.event_year = year;
        p.event_week_day = weekday_name;

        if (window.ShopifyAnalytics?.meta) {
            if (!item.product_code && window.ShopifyAnalytics.meta?.product) {
                p.content_ids = [window.ShopifyAnalytics.meta?.product?.id];
                p.content_category = window.ShopifyAnalytics.meta?.product?.type;
            
                variants = window.ShopifyAnalytics.meta.product.variants;

                for (const vid of variants) {
                    if (vid.id == window.ShopifyAnalytics.meta.selectedVariantId) {
                        p.content_name = vid.name;
                        p.value = vid.price / 100;
                        p.currency = window.ShopifyAnalytics.meta.currency;

                        break;
                    }
                }
            }
        }

        return p;
    }

    /**
     * Retorna o sistema operacional do dispositivo.
     */
    function getDeviceSystem() {
        const ua = navigator.userAgent;
    
        if (/windows phone/i.test(ua)) return "Windows Phone";
        if (/win/i.test(ua)) return "Windows";
        if (/android/i.test(ua)) return "Android";
        if (/iPad|iPhone|iPod/.test(ua)) return "iOS";
        if (/Mac/i.test(ua)) return "macOS";
        if (/Linux/i.test(ua)) return "Linux";
    
        return "Unknown";
    }

    /**
     * Retorna o navegador identificado.
     */
    function getDeviceBrowser() {
        const ua = navigator.userAgent;
    
        if (ua.includes('Instagram')) return 'Instagram';
        if (ua.includes('FBAN') || ua.includes('FBAV')) return 'Facebook';
        if (ua.includes('TikTok')) return 'TikTok';
        if (ua.includes('WhatsApp')) return 'WhatsApp';
        if (ua.includes('Twitter')) return 'Twitter';
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Safari')) return 'Safari';
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Edge')) return 'Edge';
        if (ua.includes('OPR') || ua.includes('Opera')) return 'Opera';
    
        return 'Unknown';
    }

    /**
     * Dispara um evento FB apenas nos pixels indicados.
     * @param {string} eventName — nome do evento (ex: "PageView").
     * @param {string[]} pixels — lista de Pixel IDs.
     * @param {object} params — parâmetros do evento.
     */
    function fireFbEvent(eventName, pixels, params) {
        // Um eventId único para esta ocorrência
        const eventId = generateUUID();
        let pixelCount = 1;

        pixels.forEach(pid => {
            const [pixelId, testCode] = pid;

            const options = { eventID: eventId + '-' + pixelCount.toString()};

            pixelCount++;

            // Se houver código de teste, adiciona ao options
            if (testCode) {
                options.test_event_code = testCode;
            }

            params['tracked_by'] = 'Dimpple';

            if (window.ShopifyAnalytics?.meta && eventName === 'InitiateCheckout') {
                // Exceção para identificar os itens do carrinho
                const xhr = new XMLHttpRequest();
                
                xhr.open('GET', '/cart.js', false);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.send(null);
                
                if (xhr.status === 200) {
                    const cart = JSON.parse(xhr.responseText);

                    params['content_ids'] = [];

                    if (cart && Array.isArray(cart.items)) {
                        for (const item of cart.items) {
                            params['content_ids'].push(item.id.toString());
                        }
                    }

                    params['currency'] = cart.currency;
                    params['value'] = cart.total_price / 100;
                }
            }

            if (STANDARD_EVENTS.has(eventName)) {
                // Envia somente para este pixel padrão
                fbq('trackSingle', pixelId, eventName, params, options);
            } else {
                // Envia para este pixel como evento customizado
                fbq('trackSingleCustom', pixelId, eventName, params, options);
            }
        });

        const allCookies = document.cookie.split('; ');

        // Extrai _fbp
        const fbp = allCookies.find(c => c.startsWith('_fbp='))?.split('=')[1] || '';

        // Extrai _fbc
        const fbc = allCookies.find(c => c.startsWith('_fbc='))?.split('=')[1] || '';

        // Envia os dados para o backend para envio da conversão pela API
        const payload = {
            event_name: eventName,
            event_id: eventId,
            event_time: Math.floor(Date.now() / 1000),
            event_source_url: window.location.href,
            action_source: 'website',
            user_data: {
                fbp: fbp,
                fbc: fbc,
                em: normalizeParam('em', localStorage.getItem('em') ?? ''),
                fn: normalizeParam('fn', localStorage.getItem('fn') ?? ''),
                ln: normalizeParam('ln', localStorage.getItem('ln') ?? ''),
                ph: normalizeParam('ph', localStorage.getItem('ph') ?? ''),
                ct: normalizeParam('ct', localStorage.getItem('ct') ?? ''),
                st: normalizeParam('st', localStorage.getItem('st') ?? ''),
                zp: normalizeParam('zp', localStorage.getItem('zp') ?? ''),
                country: normalizeParam('country', localStorage.getItem('country') ?? ''),
                client_user_agent: navigator.userAgent,
                client_ip_address: localStorage.getItem('ip') ?? '',
                external_id: leadId
            },
            custom_data: params,
            pixel_ids: pixels
        };

        const cleanedPayload = cleanDeep(payload);

        fetch(`${SCRIPT_URL}/v1/Analytics/${encodeURIComponent(trkCode)}/event?leadId=${leadId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanedPayload)
        })
        .then(res => res.ok ? null : Promise.reject(res))
        .catch(err => console.warn('CAPI error', err));
    }

    /**
     * Retorna todos os elementos cujo id = sel OU cuja classe = sel
     * 
     * @returns {array}
     */
    function getElementsBySelector(sel) {
        return Array.from(
            document.querySelectorAll(`#${sel}, .${sel}`)
        );
    }

    const _firedOnce = new WeakMap(); // el => Set(keys) - permanente

    /**
     * Escuta eventos delegados de forma genérica.
     * @param {string} eventType Tipo do evento (ex: 'click', 'submit').
     * @param {string} selector Seletor CSS (ex: '.btn' ou '#form').
     * @param {Function} callback Função a ser executada quando o elemento for acionado.
     * @param {object} opts Parâmetros de configuração.
     */
    function delegateEvent(eventType, selector, callback, opts = {}) {
        const baseKey = `${eventType}:${selector}`;
        const key = opts.key || baseKey; // Chave única do gatilho (ex.: inclui o nome do evento de negócio)
        const once = opts.once !== false; // Padrão: true

        // Registra uma vez por (tipo+seletor+key)
        const regKey = `${eventType}:${selector}:${key}`;
        if (!delegateEvent._regs) delegateEvent._regs = new Set();
        if (delegateEvent._regs.has(regKey)) return;
        delegateEvent._regs.add(regKey);

        document.addEventListener(eventType, (event) => {
            let el = null;
            try { el = event.target.closest(selector); } catch(_) {}
            if (!el) return;

            if (once) {
                let set = _firedOnce.get(el);
                if (!set) { set = new Set(); _firedOnce.set(el, set); }
                if (set.has(key)) return; // Já disparou para este elemento
                set.add(key);
            }

            callback(event, el);
        }, true);
    }

    /**
     * Registra todos os triggers definidos em cfg.data.
     */
    function setupConversionTriggers(cfg) {
        if (!cfg || !Array.isArray(cfg.data)) return;
        
        cfg.data.forEach(item => {
            const params = buildFbParams(item);
            const evName = item.event === 'Custom' ? item.event_name : item.event;
            const sel    = item.class_or_id;
            const timeMs = (item.time || 0) * 1000;

            switch (item.trigger) {
                case 'accessed_the_page': // Página acessada
                    fireFbEvent(evName, item.pixels, params);
                    break;
        
                case 'time_spent_on_the_page': // Tempo de permanência na página
                    setTimeout(()=> {
                        fireFbEvent(evName, item.pixels, params);
                    }, timeMs);
                    break;
        
                case 'form_submitted': // Formulário enviado
                    delegateEvent(
                        'submit',
                        `#${sel}, .${sel}`,
                        () => { fireFbEvent(evName, item.pixels, params); },
                        { key: `submit|${sel}|${evName}` }
                    );
                    break;
        
                case 'button_or_element_clicked': { // Elemento clicado
                    delegateEvent(
                        'click',
                        `#${sel}, .${sel}`,
                        () => { fireFbEvent(evName, item.pixels, params); },
                        { key: `click|${sel}|${evName}` }
                    );
                    break;
                }
        
                case 'element_or_session_view': { // Elemento ou sessão visualizada
                    let fired = false;
                    const target = document.querySelector(`#${sel}, .${sel}`);
                    if (target && 'IntersectionObserver' in window) {
                        const io = new IntersectionObserver(entries => {
                            entries.forEach(entry => {
                                if (entry.isIntersecting && !fired) {
                                    fired = true;
                                    fireFbEvent(evName, item.pixels, params);
                                    io.disconnect();
                                }
                            });
                        }, { threshold: 0.1 });
                        io.observe(target);
                    }
                    break;
                }
        
                case 'mouseover_element': { // Passar sobre o elemento
                    delegateEvent(
                        'mouseover',
                        `#${sel}, .${sel}`,
                        () => { fireFbEvent(evName, item.pixels, params); },
                        { key: `mouseover|${sel}|${evName}` }
                    );
                    break;
                }                  
        
                case 'page_scroll_percentage': { // Página rolada X porcento
                    let fired = false;
                    const threshold = item.percent;

                    function onScroll() {
                        if (fired) return;

                        const scrollTop   = window.scrollY || window.pageYOffset;
                        const docHeight   = document.documentElement.scrollHeight - window.innerHeight;
                        const pctScrolled = docHeight > 0
                            ? (scrollTop / docHeight * 100)
                            : 0;

                        if (pctScrolled >= threshold) {
                            fired = true;
                            fireFbEvent(evName, item.pixels, params);
                            window.removeEventListener('scroll', onScroll);
                        }
                    }

                    // Registra o listener depois de 'fired' já existir
                    window.addEventListener('scroll', onScroll);
                    window.addEventListener('resize', onScroll);
                    break;
                }
                
                case 'time_spent_watching_the_video': { // Tempo de vídeo visualizado
                    const el = getElementsBySelector(sel);
                    if (!el || el.length === 0) break;

                    const requiredSec = item.time || 0;
                    let fired = false;
                    
                    const onFire = () => {
                        if (!fired) {
                            fired = true;
                            fireFbEvent(evName, item.pixels, params);
                        }
                    };
                    
                    switch ((item.player || '').toLowerCase()) {
                        // HTML5 <video> nativo
                        case 'tag video':
                        case 'html5':
                            // Pra cada um (normalmente só terá 1), anexa o listener
                            el.forEach(video => {
                                if (!(video instanceof HTMLVideoElement)) return;
                                const handler = function html5Handler() {
                                    if (video.currentTime >= requiredSec) {
                                        onFire();
                                        video.removeEventListener('timeupdate', handler);
                                    }
                                };
                                video.addEventListener('timeupdate', handler);
                            });
                            break;
                        
                        // YouTube IFrame
                        case 'youtube':
                            // Injeta API se necessário
                            if (!window.YT || !YT.Player) {
                                const tag = document.createElement('script');
                                tag.src = 'https://www.youtube.com/iframe_api';
                                document.head.appendChild(tag);
                            }

                            // Define o callback global ANTES de carregar a API
                            window.onYouTubeIframeAPIReady = () => {
                                // Passe a string 'meuVideo' — que é o id do iframe — e não o elemento diretamente
                                const player = new YT.Player(el[0].id, {
                                    events: {
                                        // onStateChange indica mudanças de estado: PLAYING, PAUSED, ENDED...
                                        onStateChange: (e) => {
                                            // 1 = PLAYING, 2 = PAUSED, 0 = ENDED
                                            if (e.data === YT.PlayerState.PLAYING) {
                                                // A partir de agora faz o polling
                                                const poll = setInterval(() => {
                                                    const current = player.getCurrentTime();
                                                    if (current >= requiredSec) {
                                                        onFire();
                                                        clearInterval(poll);
                                                    }
                                                }, 500);
                                            }
                                        }
                                    }
                                });
                            };
                            break;
                        
                        // Vimeo Player
                        case 'vimeo': {
                            let fired = false;
                            
                            // Função que injeta o SDK do Vimeo e retorna uma Promise
                            function loadVimeoSDK() {
                                return new Promise(resolve => {
                                    // Se já estiver carregado, resolve na hora
                                    if (window.Vimeo && typeof Vimeo.Player === 'function') {
                                        return resolve();
                                    }

                                    // Senão, cria o <script> e resolve no onload
                                    const script = document.createElement('script');
                                    script.src = 'https://player.vimeo.com/api/player.js';
                                    script.onload = () => resolve();
                                    document.head.appendChild(script);
                                });
                            }
                            
                            // Depois de carregar o SDK, instancia o player e faz o polling
                            loadVimeoSDK().then(() => {
                                const player = new Vimeo.Player(el[0].id);
                                const poll = setInterval(() => {
                                    player.getCurrentTime().then(time => {
                                        if (time >= requiredSec && !fired) {
                                            fired = true;
                                            onFire();
                                            clearInterval(poll);
                                        }
                                    }).catch(() => {
                                        // em caso de erro no getCurrentTime, opcionalmente limpe o interval
                                    });
                                }, 500);
                            });
                            break;
                        }  
                        
                        // Panda Video (placeholder — ajuste a URL/API real)
                        /*case 'panda': {
                            const els = getElementsBySelector(sel);
                            if (!els.length) break;
                            const container   = els[0];
                            const requiredSec = item.time || 0;
                            let fired         = false;
                            let observer      = null;

                            // função que anexa o listener ao <video> encontrado
                            function attachVideoListener(videoEl) {
                                const handler = () => {
                                if (videoEl.currentTime >= requiredSec && !fired) {
                                    fired = true;
                                    onFire();
                                    videoEl.removeEventListener('timeupdate', handler);
                                    if (observer) observer.disconnect();
                                }
                                };
                                videoEl.addEventListener('timeupdate', handler);
                            }

                            // 1) tenta agora
                            const initialVideo = container.querySelector('video');
                            if (initialVideo) {
                                attachVideoListener(initialVideo);
                                break;
                            }

                            // 2) se não achar, observa mutações (ideal para players que são carregados async)
                            if ('MutationObserver' in window) {
                                observer = new MutationObserver((mutations, obs) => {
                                for (const m of mutations) {
                                    for (const node of m.addedNodes) {
                                    if (node.tagName && node.tagName.toLowerCase() === 'video') {
                                        attachVideoListener(node);
                                        return;  // já achou, sai
                                    }
                                    }
                                }
                                });
                                observer.observe(container, { childList: true, subtree: true });
                                // opcional: para de observar após 30s para não vazar memoria
                                setTimeout(() => {
                                if (observer) observer.disconnect();
                                }, 30000);
                            }
                            break;
                        }*/
                        
                        // vTurb (placeholder — ajuste a URL/API real)
                        case 'vturb':
                            if (!window.VTPlayer) {
                                const tag = document.createElement('script');
                                tag.src = 'https://player.vturb.com/vtplayer.js'; // Ajuste se necessário
                                document.head.appendChild(tag);
                            }

                            tag.onload = () => {
                                const player = new VTPlayer(el);
                                const poll = setInterval(() => {
                                    if (player.getCurrentTime() >= requiredSec) {
                                        onFire();
                                        clearInterval(poll);
                                    }
                                }, 500);
                            };
                            break;
                    }
                    break;
                }
            }
        });
    }

    /**
     * Normaliza o valor conforme as regras do Facebook:
     * - trim() + lowercase()
     * - remove caracteres não‑dígito para telefones
     * 
     * @returns {string}
     */
    let normalizeParam = (key, value) => {
        if (value == null) return '';
        
        let v = String(value).trim().toLowerCase();

        // Se for telefone, só dígitos
        if (/^(ph|phone)$/.test(key)) {
            v = v.replace(/\D+/g, '');
        }
        
        return v;
    }
    
    /**
     * Inicializa o Analytics e retorna os dados da operação.
     * 
     * @returns {void}
     */
    let fetchConfig = () => {
        const cfgUrl = `${SCRIPT_URL}/v1/Analytics/${encodeURIComponent(trkCode)}/init?leadId=${leadId}&url=${encodeURIComponent(location.href)}`;
        return fetch(cfgUrl, { 
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json());
    }

    /**
     * Registra a localização do usuário na storage.
     * 
     * @param {array} locationData Dados de localização.
     */
    let saveUserLocation = (locationData) => {
        // Salva os valores encontrados na storage
        Object.keys(locationData).forEach(key => {
            localStorage.setItem(key, locationData[key]);
        });
    }

    /**
     * Função que registra o ping.
     */
    let ping = () => {
        const currentUrl = new URL(window.location.href);
        const domain = currentUrl.origin;
        const path   = currentUrl.pathname;
        const params = currentUrl.search.slice(1);

        const allCookies = document.cookie.split('; ');

        // Extrai _fbp
        const fbp = allCookies.find(c => c.startsWith('_fbp='))?.split('=')[1] || '';

        // Extrai _fbc
        const fbc = allCookies.find(c => c.startsWith('_fbc='))?.split('=')[1] || '';
        
        const payload = Object.assign({
            leadId: leadId,
            domain: domain,
            path: path,
            params: params,
            fn: localStorage.getItem('fn') ?? '',
            ln: localStorage.getItem('ln') ?? '',
            em: localStorage.getItem('em') ?? '',
            ph: localStorage.getItem('ph') ?? '',
            ct: localStorage.getItem('ct') ?? '',
            st: localStorage.getItem('st') ?? '',
            zp: localStorage.getItem('zp') ?? '',
            country: localStorage.getItem('country') ?? '',
            ad_id: localStorage.getItem('dimpple_ad_id') ?? '',
            fbp: fbp,
            fbc: fbc,
            client_user_agent: navigator.userAgent,
            client_ip_address: localStorage.getItem('ip') ?? ''
        });

        const url = `${SCRIPT_URL}/v1/Analytics/${encodeURIComponent(trkCode)}/ping`;
        const body = new URLSearchParams(payload).toString();

        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, body);
        } else {
            // Fallback para GET com imagem
            new Image().src = `${url}?${body}`;
        }
    }

    /**
     * Atualiza os dados do lead.
     * 
     * @params {object} params Dados do lead salvos no banco de dados.
     */
    let updateLead = (params) => {
        if ((params.fn ?? '') && params.fn !== 'null') {
            localStorage.setItem('fn', params.fn);
        }

        if ((params.ln ?? '') && params.ln !== 'null') {
            localStorage.setItem('ln', params.ln);
        }

        if ((params.em ?? '') && params.em !== 'null') {
            localStorage.setItem('em', params.em);
        }

        if ((params.ph ?? '') && params.ph !== 'null') {
            localStorage.setItem('ph', params.ph);
        }

        if ((params.ct ?? '') && params.ct !== 'null') {
            localStorage.setItem('ct', params.ct);
        }

        if ((params.st ?? '') && params.st !== 'null') {
            localStorage.setItem('st', params.st);
        }

        if ((params.zp ?? '') && params.zp !== 'null') {
            localStorage.setItem('zp', params.zp);
        }

        if ((params.country ?? '') && params.country !== 'null') {
            localStorage.setItem('country', params.country);
        }

        if ((params.ip ?? '') && params.ip !== 'null') {
            localStorage.setItem('ip', params.ip);
        }
    }

    /**
     * Elimina elementos vazios do array.
     * 
     * @param {array} data Dados a serem tratados.
     * 
     * @returns {array}
     */
    function cleanDeep(data) {
        if (Array.isArray(data)) {
            return data
                .map(cleanDeep)
                .filter(item => item !== '' && item !== null && item !== undefined && !(typeof item === 'object' && Object.keys(item).length === 0));
        }
    
        if (typeof data === 'object' && data !== null) {
            return Object.fromEntries(
                Object.entries(data)
                    .map(([key, value]) => [key, cleanDeep(value)])
                    .filter(([, value]) => value !== '' && value !== null && value !== undefined && !(typeof value === 'object' && Object.keys(value).length === 0))
            );
        }
    
        return data;
    }

    /**
     * Configura os formulários e prepara a execução.
     * 
     * @param {object} data Dados dos formulários.
     * 
     * @return {void}
     */
    function setupForms(data) {
        const baseUrl = SCRIPT_URL + '/' + API_VERSION + '/Form/';
        
        // Evita duplicar configs caso init rode novamente (SPA/rotas)
        formsData = [];

        Object.keys(data).forEach(key => {
            formsData.push(Object.assign(data[key], { 'id': key }));

            document
            .querySelectorAll('a[href]')
            .forEach(link => {
                const raw = link.getAttribute('href');
                if (!raw) return;

                // Verifica se a URL contém a parte desejada (ignorando os parâmetros)
                try {
                    const url = new URL(raw);

                    if (url.origin + url.pathname === baseUrl + key) {
                        // Remove o link original
                        link.href = 'javascript: void(0);';
                        link.setAttribute('data-precheckout-id', key);
                    }
                } catch (e) {}
            });
        });

        DimpplePrecheckout.manager.register(formsData);

        // Garante que os cliques em [data-precheckout-id] funcionem
        DimpplePrecheckout.manager.enableGlobalDelegatedBinding();
    }

    /**
     * Converte um número para a medida em pixels.
     * 
     * @param {number} value Valor da medida.
     *  
     * @returns {string}
     */
    function toPx(value) {
        return value == null ? '0px' : (typeof value === 'number' ? value+'px' : value);
    }

    /**
     * Monta o fomrulário conforme as configurações.
     * 
     * @param {object} cfg Configurações do formulário.
     * 
     * @returns {object}
     */
    function createPrecheckoutPopup(cfg = {}) {
        cfg = Object.assign({ closeOnBackdrop: true }, cfg || {});

        // Host fixo no DOM "light" (garante z-index e stacking)
        const host = document.createElement('div');
        Object.assign(host.style, {
            position: 'fixed', 
            inset: '0',
            zIndex: '2147483000',
            display: 'none'
        });
        document.body.appendChild(host);

        const safeId = String(cfg.id).replace(/\./g, '-');

        // O host precisa ter seletores que os gatilhos reconhecem
        host.id = 'host-' + safeId;
        
        const shadow = host.attachShadow({ mode: 'open' });
        
        // Elementos
        const overlay = document.createElement('div');
        const dialog  = document.createElement('div');
        const box     = document.createElement('div');
        const titleEl = document.createElement('h2');
        const desc    = document.createElement('p');
        const form    = document.createElement('form');
        const actions = document.createElement('div');
        const submit  = document.createElement('button');
        const cancel  = document.createElement('a');

        // ID do formulário
        form.id = 'form-' + safeId;
        form.name = 'form-' + safeId;
        form.method = 'post';

        // A11y IDs
        const dialogId = 'dimpple-precheckout-' + safeId;
        const titleId  = dialogId + '-title';
        const descId   = dialogId + '-desc';

        // Estilos isolados (só valem dentro do shadow)
        const style = document.createElement('style');
        style.textContent = `
            /* Reset local e base tipográfica */
            :host, :host * { box-sizing: border-box; }
            .root { all: initial; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.4; }
            .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; }
            .dialog { width: min(92vw, 560px); max-height: 86vh; overflow: auto; background: ${cfg.background}; color: ${cfg.color}; border: ${toPx(cfg['border-size'])} solid ${cfg['border-color']}; border-radius: ${toPx(cfg['border-radius'])}; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18); padding: 24px; }
            .box { display: grid; gap: 16px; }
            .title { margin: 0; text-align: center; font-size: 22px; font-weight: 700; }
            .desc { margin: 0; text-align: center; opacity: .9; }
            .fields { display: grid; gap: 12px; }
            .field { display: grid; gap: 3px 0 6px; }
            .label { font-size: 14px; }
            .label.hidden { display: none; }
            .input { padding: 12px; border: 1px solid ${cfg['border-color']}; border-radius: ${toPx(cfg['border-radius'])}; background: #fff; color: #000; font: inherit; }
            .error .input { border-color: #d92d20; }
            .error-msg { font-size: 12px; color: #d92d20; }
            .actions { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 15px; }
            .btn { padding: 10px 16px; border-radius: ${toPx(cfg['border-radius'])}; cursor: pointer; font-weight: 600; font: inherit; }
            .btn-primary { border: 1px solid ${cfg['border-color']}; background: ${cfg.color}; color: ${cfg.background}; }
            .link-close { font-size: 14px; color: inherit; opacity: 0.7; text-decoration: underline; cursor: pointer; }
            .link-close:hover { opacity: 1; }
        `;

        // Atribui classes locais
        overlay.className = 'overlay root';
        dialog.className  = 'dialog';
        box.className     = 'box';
        titleEl.className = 'title';
        desc.className    = 'desc';
        actions.className = 'actions';

        // Título
        if (cfg.title) {
            titleEl.textContent = cfg.title || '';
            titleEl.id = titleId;
            box.appendChild(titleEl);
        }
        
        // Descrição central
        if (cfg.description) {
            desc.textContent = cfg.description || '';
            desc.id = descId;
            box.appendChild(desc);
        }
        
        // Campos básicos (você pode substituir depois dinamicamente)
        form.noValidate = true;

        // Nome
        const nameField = document.createElement('label');
        nameField.className = 'field';
        nameField.innerHTML = `
            <span class="label ${cfg.name_label_show ? '' : 'hidden'}">${cfg.name_label}</span>
            <input class="input" name="name" type="text" required placeholder="${cfg.name_placeholder || ''}" maxlength="100" autocomplete="name" />
            <span class="error-msg" aria-live="polite"></span>
        `;
        
        // E-mail
        const emailField = document.createElement('label');
        emailField.className = 'field';
        emailField.innerHTML = `
            <span class="label ${cfg.email_label_show ? '' : 'hidden'}">${cfg.email_label}</span>
            <input class="input" name="email" type="email" required placeholder="${cfg.email_placeholder || ''}" maxlength="100" autocomplete="email" />
            <span class="error-msg" aria-live="polite"></span>
        `;

        // Telefone (opcional por flag; se renderizado, é obrigatório)
        let phoneField = null;
        if (cfg.phone_show) {
            phoneField = document.createElement('label');
            phoneField.className = 'field';
            phoneField.innerHTML = `
                <span class="label ${cfg.phone_label_show ? '' : 'hidden'}">${cfg.phone_label}</span>
                <input class="input" name="phone" type="tel" inputmode="tel" required placeholder="${cfg.phone_mask || ''}" autocomplete="tel" />
                <span class="error-msg" aria-live="polite"></span>
            `;
        }
        
        const fieldsWrap = document.createElement('div');

        fieldsWrap.className = 'fields';
        fieldsWrap.appendChild(nameField);
        fieldsWrap.appendChild(emailField);
        
        if (phoneField) {
            fieldsWrap.appendChild(phoneField);
        }

        form.appendChild(fieldsWrap);

        // máscara telefone (se existir)
        const phoneInput = cfg.phone_show ? fieldsWrap.querySelector('input[name="phone"]') : null;
        function applyMask(mask, digits) {
            let out = '', di = 0;
            for (let i = 0; i < mask.length; i++) {
                const m = mask[i];
                if (m === '9') {
                    if (di < digits.length) out += digits[di++]; else break;
                } else {
                    out += m;
                }
            }
            return out;
        }
        if (phoneInput && cfg.phone_mask) {
            phoneInput.addEventListener('input', () => {
                const onlyDigits = phoneInput.value.replace(/\D+/g, '');
                phoneInput.value = applyMask(cfg.phone_mask, onlyDigits);
            });
        }

        box.appendChild(form);

        // Ações (dentro do form)
        submit.type = 'submit';
        submit.textContent = cfg.action_label;
        submit.className = 'btn btn-primary';
        submit.id = 'btn-' + safeId;

        // Sempre que clicarem no botão (mesmo que a validação falhe),
        // reemite um clique no host para o delegado global capturar.
        submit.addEventListener('click', () => {
            // Aplica classe do botão só durante o evento sintético
            const btnClass = 'btn-' + safeId;
            host.classList.add(btnClass);

            const clickEvt = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
            host.dispatchEvent(clickEvt);

            host.classList.remove(btnClass);
        });

        cancel.textContent = cfg.close_label;
        cancel.href = 'javascript:void(0)';
        cancel.className = 'link-close';
        cancel.id = 'close-' + safeId;

        // Sempre que clicarem no link, reemite um clique no host para o delegado global capturar.
        cancel.addEventListener('click', () => {
            // Aplica classe do link só durante o evento sintético
            const closeClass = 'close-' + safeId;
            host.classList.add(closeClass);

            const clickEvt = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
            host.dispatchEvent(clickEvt);

            host.classList.remove(closeClass);
        });

        actions.append(submit, cancel);
        form.appendChild(actions);

        // Monta demais elementos
        dialog.append(box);
        overlay.appendChild(dialog);
        shadow.append(style, overlay);

        // A11y
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        if (cfg.title) {
            dialog.setAttribute('aria-labelledby', titleId);
        }

        if (cfg.description) {
            dialog.setAttribute('aria-describedby', descId);
        }

        if (cfg.redirect) {
            const hiddenLink = document.createElement('a');
            
            hiddenLink.id = 'link-' + safeId;

            // Monta o href já com os parâmetros (sem depender do observer global)
            try {
                hiddenLink.href = appendParams(String(cfg.redirect), captured);
            } catch (_) {
                hiddenLink.href = cfg.redirect;
            }
            hiddenLink.style.display = 'none';
            form.appendChild(hiddenLink);
        }          

        // Validação ao enviar o formulário
        function setError(fieldWrap, msg) {
            if (!fieldWrap) return;
            fieldWrap.classList.add('error');
            const input = fieldWrap.querySelector('.input');
            const err = fieldWrap.querySelector('.error-msg');
            if (input) input.setAttribute('aria-invalid', 'true');
            if (err) err.textContent = msg || '';
        }
        function clearError(fieldWrap) {
            if (!fieldWrap) return;
            fieldWrap.classList.remove('error');
            const input = fieldWrap.querySelector('.input');
            const err = fieldWrap.querySelector('.error-msg');
            if (input) input.removeAttribute('aria-invalid');
            if (err) err.textContent = '';
        }
        function validate() {
            let firstInvalid = null;

            // Nome
            const iName = form.querySelector('input[name="name"]');
            const fName = iName ? iName.closest('.field') : null;
            clearError(fName);
            const nameVal = (iName?.value || '').trim();
            if (!iName || nameVal.length < 2) {
                setError(fName, 'Informe seu nome.');
                firstInvalid = firstInvalid || iName;
            }

            // E-mail
            const iEmail = form.querySelector('input[name="email"]');
            const fEmail = iEmail ? iEmail.closest('.field') : null;
            clearError(fEmail);
            const emailVal = (iEmail?.value || '').trim();
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal);
            if (!iEmail || !emailOk) {
                setError(fEmail, 'E‑mail inválido.');
                firstInvalid = firstInvalid || iEmail;
            }

            // Telefone (só valida se renderizado)
            if (cfg.phone_show) {
                const iPhone = form.querySelector('input[name="phone"]');
                const fPhone = iPhone ? iPhone.closest('.field') : null;
                clearError(fPhone);
                if (cfg.phone_mask && iPhone) {
                    const need = (cfg.phone_mask.match(/9/g) || []).length;
                    const got  = (iPhone.value || '').replace(/\D+/g, '').length;
                    if (got !== need) {
                        setError(fPhone, 'Informe seu celular.');
                        firstInvalid = firstInvalid || iPhone;
                    }
                } else if (!iPhone.value.trim()) {
                    setError(fPhone, 'Informe seu celular.');
                    firstInvalid = firstInvalid || iPhone;
                }
            }

            if (firstInvalid) firstInvalid.focus();
            return !firstInvalid;
        }

        function clearAllErrors() {
            form.querySelectorAll('.field').forEach(clearError);
        }

        function resetForm() {
            // Limpa valores
            form.reset();
          
            // Garante que campos fora do <form> ou com máscaras também limpem
            form.querySelectorAll('input, textarea, select').forEach(el => { el.value = ''; });
            
            clearAllErrors();
        }

        // Limpa erros on input
        form.addEventListener('input', (e) => {
            const wrap = e.target.closest('.field');
            if (wrap) clearError(wrap);
        });
        
        // Focus trap
        let lastFocused = null;
        
        function getFocusable() {
            return dialog.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
        }

        function trap(e) {
            if (e.key !== 'Tab') return;
            const items = getFocusable();
            
            if (!items.length) return;
            const first = items[0], last = items[items.length-1];
            
            if (e.shiftKey && shadow.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && shadow.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }

        // API
        let isOpen = false;

        /**
         * Abre a janela do formulário.
         */
        function open() {
            if (isOpen) return;
            isOpen = true;

            lastFocused = document.activeElement;
            host.style.display = 'block';

            document.body.style.overflow = 'hidden';

            resetForm();

            (dialog.querySelector('input, select, textarea, button') || dialog).focus();

            document.addEventListener('keydown', onKeydown);
            dialog.addEventListener('keydown', trap);
        }
        
        /**
         * Fecha a janela do formulário.
         */
        function close() {
            if (!isOpen) return;
            isOpen = false;

            host.style.display = 'none';
            document.body.style.overflow = '';
            
            document.removeEventListener('keydown', onKeydown);
            dialog.removeEventListener('keydown', trap);
            
            if (lastFocused && lastFocused.focus) lastFocused.focus();
        }
        
        function onKeydown(e) { if (e.key === 'Escape') close(); }

        // Events
        cancel.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay && cfg.closeOnBackdrop) close(); });
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const submit = form.querySelector('button[type="submit"]');
            if (submit) {
                submit.disabled = true; // Evita duplo clique
            }

            if (!validate()) {
                if (submit) submit.disabled = false; // Reabilita se houver erro
                return;
            }
            
            const fullName = form.querySelector('input[name="name"]')?.value.trim() || '';
            const email = form.querySelector('input[name="email"]')?.value.trim() || '';
            const phone = form.querySelector('input[name="phone"]')?.value.trim() || '';

            let firstName = '';
            let lastName = '';

            if (fullName) {
                const parts = fullName.split(/\s+/);
                firstName = parts[0];
                lastName = parts.length > 1 ? parts[parts.length - 1] : '';
            }

            // Primeiro nome
            if (firstName && firstName.trim()) {
                localStorage.setItem('fn', firstName.trim());
            }

            // Último nome
            if (lastName && lastName.trim()) {
                localStorage.setItem('ln', lastName.trim());
            }

            // E-mail
            if (email && email.trim()) {
                localStorage.setItem('em', email.trim());
            }

            // Telefone
            if (phone && phone.trim()) {
                localStorage.setItem('ph', phone.trim());
            }

            ping();

            const formClass = 'form-' + safeId;
            host.classList.add(formClass);

            // Dispara um submit "composed" no HOST para atravessar o Shadow DOM
            // (o delegateEvent no document vai capturar e acionar a conversão)
            const synthetic = new Event('submit', { bubbles: true, composed: true, cancelable: true });
            host.dispatchEvent(synthetic);

            host.classList.remove(formClass);

            let redirect = form.querySelector('a[id^="link-"]')?.href;

            if (redirect) {
                // Monta a URL corretamente com URLSearchParams (evita duplicar ?/& e faz encoding)
                const u = new URL(redirect, location.href);
                if (fullName && cfg.name_to) u.searchParams.set(cfg.name_to, fullName);
                if (email && cfg.email_to) u.searchParams.set(cfg.email_to, email);
                if (cfg.phone_show && phone && cfg.phone_to) u.searchParams.set(cfg.phone_to, phone);

                // Da oportunidade para beacons/trackers dispararem e então navegue
                setTimeout(() => {
                    if (submit) submit.disabled = false; // Reabilita ao final

                    location.href = u.toString();
                }, 3000);
            } else {
                if (submit) submit.disabled = false; // Reabilita ao final
            }
        });

        return {
            id: cfg.id,
            open, close,
            getFormElement() { return form; },
            getDialogElement() { return dialog; }
        };
    }

    // Gerenciador para múltiplos formulários
    const instances = new Map();
    let currentOpenId = null;

    /**
     * 
     * @param {string} id 
     */
    function ensureOnlyOneOpen(id) {
        if (currentOpenId && currentOpenId !== id) {
            const prev = instances.get(currentOpenId);
            if (prev) prev.close();
        }
        currentOpenId = id;
    }

    /**
     * Intercepta aberturas para garantir único aberto.
     */
    function wrapOpen(instance) {
        const _open = instance.open;
        instance.open = function() {
            ensureOnlyOneOpen(instance.id);
            _open();
        };
        return instance;
    }

    /**
     * Retorna se é acesso de bot.
     */
    function isBot() {
        const ua = navigator.userAgent || "";

        // Lista básica de padrões de bots/crawlers
        const botPatterns = /(bot|crawler|spider|facebookexternalhit|slackbot|whatsapp|preview|headless|python|curl)/i;
      
        // Heurísticas de headless
        const headless =
            navigator.webdriver || // Selenium / Puppeteer
            !navigator.languages || // Normalmente vazio em headless
            /HeadlessChrome/.test(navigator.userAgent); // Plugins ausentes

        return botPatterns.test(ua) || headless;
    }

    const Manager = {
        /**
         * Registra um conjunto de formulários.
         * 
         * @param {Array<{id:string, triggerSelector?:string}>} configs
         */
        register(configs) {
            (configs || []).forEach(cfg => {
                if (!cfg.id) return;
                if (instances.has(cfg.id)) return; // Evita duplicar

                const inst = wrapOpen(createPrecheckoutPopup(cfg));
                instances.set(cfg.id, inst);

                // Bind via seletor específico...
                if (cfg.triggerSelector) {
                    document.querySelectorAll(cfg.triggerSelector).forEach(n => {
                        n.addEventListener('click', (e)=>{ e.preventDefault(); inst.open(); }, { passive:false });
                    });
                }
            });
        },

        /**
         * Bind delegado único para qualquer elemento com data-precheckout-id.
         * Útil se DOM for dinâmico; listener é único.
         */
        enableGlobalDelegatedBinding() {
            if (this._delegated) return;
            this._delegated = true;

            document.addEventListener('click', (e) => {
                const el = e.target.closest('[data-precheckout-id]');
                if (!el) return;

                const id = el.getAttribute('data-precheckout-id');
                const inst = instances.get(id);
                
                if (inst) {
                    e.preventDefault();
                    inst.open();
                }
            }, { passive:false });
        },

        /**
         * APIs públicas
         */
        open(id) { const inst = instances.get(id); if (inst) inst.open(); },
        close(id) { const inst = instances.get(id); if (inst) inst.close(); },
        get(id) { return instances.get(id) || null; },
        list() { return Array.from(instances.keys()); }
    };

    /**
     * Exponha globalmente.
     */
    window.DimpplePrecheckout = Object.assign(window.DimpplePrecheckout || {}, {
        create: createPrecheckoutPopup,
        manager: Manager
    });

    window.DimppleAnalytics = {
        init: function(cfg = {}) {
            // Não executar para bots
            // if (isBot()) {
            //     console.info('Dimpple Analytics: acesso identificado como bot/headless — init ignorado.');
            //     return;
            // }

            // Previne execução duplicada
            if (window.__dimppleLoaded__) return;
            window.__dimppleLoaded__ = true;
            
            // Extrai o parâmetro "trk" recebido na chamada
            const thisScript = document.currentScript || Array.from(document.scripts).find(s => s.src && s.src.includes('analytics.js'));
            trkCode = cfg.trk || trkCode || (thisScript && (new URL(thisScript.src)).searchParams.get('trk')) || '';

            getCrossDomainLead().then(id => {
                // Mensagem publicitária
                console.info('Esta página está sendo traqueada pela Dimpple: https://dimpple.com');

                // Registra o ID do lead
                leadId = id;

                // Captura os parâmetros UTM, fbclid, src, sck e af
                paramNames.forEach(k => {
                    const v = getParam(k, window.location.href);
                    if (v) captured[k] = v;
                });

                localStorage.setItem('url_params', JSON.stringify(captured));

                // Inicia o script e carrega todas as configurações
                fetchConfig()
                    .then(response => {
                        // Log de localização
                        saveUserLocation(response.data.location);

                        // Atualização do lead
                        updateLead(response.data.lead);

                        // Atualiza o IP do usuário
                        localStorage.setItem('ip', response.data.ip);

                        // Reembala conversions no formato esperado ({ data: [...] })
                        const cfg = { data: response.data.conversions };

                        // Configura os formulários da página
                        setupForms(response.data.forms);

                        // Inicializa os pixels e, assim que prontos, registra os triggers
                        return initFbPixelsFromConfig(cfg)
                            .then(() => {
                                setupConversionTriggers(cfg);
                            });
                    })
                    .catch(err => console.error('Tracker config error:', err));

                // Dentro de init(), antes de setInterval:
                if (dimpplePingInterval) {
                    clearInterval(dimpplePingInterval);
                }

                // Inicializa o ping
                ping();
                dimpplePingInterval = setInterval(ping, 30000);

                // Garante execução mesmo se DOM já estiver pronto
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', propagateParams);
                } else {
                    // DOM já está carregado: executa na próxima macro‑task
                    setTimeout(propagateParams, 0);
                }
            });
        }
    };

    // Verifica se é modo manual via URL do script
    const thisScript = document.currentScript || Array.from(document.scripts).find(s => s.src && s.src.includes('analytics.js'));
    const isManual = thisScript?.src?.includes('manual=1');

    // Executa automaticamente, exceto se modo manual estiver ativado
    if (!isManual) {
        window.DimppleAnalytics.init();
    }
})(window, document);

;(function(){
    const STORAGE_KEYS = {
        fullName:  ['name', 'full_name', 'full-name', 'nome', 'corporate_name', 'form_fields[name]', 'form_fields[nome]'],
        firstName: ['first_name', 'firstname', 'first-name', 'nome_proprio', 'primeiro_nome', 'form_fields[firstname]', 'form_fields[primeiro_nome]'],
        lastName:  ['last_name', 'lastname', 'last-name', 'sobrenome', 'form_fields[lastname]', 'form_fields[sobrenome]'],
        email:     ['email', 'e-mail', 'email_address', 'email-address', 'form_fields[email]', 'form_fields[e-mail]', 'form_fields[field_email]'],
        phone:     ['phone', 'phone_number', 'phone-number', 'tel', 'telefone', 'celular', 'cellphone', 'whatsapp', 'whats', 'form_fields[phone]', 'form_fields[telefone]', 'form_fields[cellphone]', 'form_fields[whatsapp]', 'form_fields[celular]']
    };
  
    /**
     * Normaliza o primeiro e último nomes.
     * 
     * @param {string} fullName Nome completo.
     * @returns 
     */
    function normalizeNameParts(fullName) {
        const parts = fullName.trim().split(/\s+/);
        return {
            fn: parts[0] || '',
            ln: parts.length > 1 ? parts[parts.length - 1] : ''
        };
    }
  
    /**
     * Monitora o envio de formulários da página.
     */
    function monitorFormSubmissions() {
        document.addEventListener('submit', e => {
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
    
            const elements = Array.from(form.elements).filter(el => el.name);
            const values = {};
    
            // Busca pelo nome completo
            const fullEl = elements.find(el =>
                STORAGE_KEYS.fullName.includes(el.name.toLowerCase())
            );

            if (fullEl && fullEl.value.trim()) {
                Object.assign(values, normalizeNameParts(fullEl.value));
            } else {
                // Primeiro nome
                const fnEl = elements.find(el =>
                    STORAGE_KEYS.firstName.includes(el.name.toLowerCase())
                );
                if (fnEl && fnEl.value.trim()) {
                    values.fn = fnEl.value.trim();
                }
                
                // Último nome
                const lnEl = elements.find(el =>
                    STORAGE_KEYS.lastName.includes(el.name.toLowerCase())
                );
                if (lnEl && lnEl.value.trim()) {
                    values.ln = lnEl.value.trim();
                }
            }
    
            // E-mail
            const emEl = elements.find(el =>
                STORAGE_KEYS.email.includes(el.name.toLowerCase())
            );
            if (emEl && emEl.value.trim()) {
                values.em = emEl.value.trim();
            }
    
            // Telefone
            const phEl = elements.find(el =>
                STORAGE_KEYS.phone.includes(el.name.toLowerCase())
            );
            if (phEl && phEl.value.trim()) {
                values.ph = phEl.value.trim();
            }
    
            // Salva os valores encontrados na storage
            Object.keys(values).forEach(key => {
                localStorage.setItem(key, values[key]);
            });
        }, true);
    }
  
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', monitorFormSubmissions);
    } else {
        monitorFormSubmissions();
    }
})();
