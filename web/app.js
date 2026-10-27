/* SatSeva — offline-first seva diary.
 * Runs unmodified inside the Android WebView (native encrypted vault) and in a
 * browser preview (WebCrypto vault). No network call is ever made from this file:
 * updates are fetched, signature-checked and applied by the native layer only.
 */
(function () {
  'use strict';

  var NATIVE = window.SatSevaNative || null;
  var I18N = window.SatSevaI18n;
  var SCHEMA = 3;

  /* ------------------------------------------------------------------ utils */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  var PATHS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    home: '<path d="M3 10.2L12 3l9 7.2V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22z"/><path d="M4 17.5A2.5 2.5 0 016.5 15H20"/>',
    bowl: '<path d="M3 11h18a9 9 0 01-18 0z"/><path d="M8 7c0-1.5 1-2 1-3M12 6.5c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3"/><path d="M2 21h20"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    flame: '<path d="M12 2s5 5.2 5 10a5 5 0 01-10 0c0-4.8 5-10 5-10z"/><path d="M12 18a2.4 2.4 0 01-2.4-2.4c0-1.9 2.4-4.1 2.4-4.1s2.4 2.2 2.4 4.1A2.4 2.4 0 0112 18z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    hands: '<path d="M7 11V5.5a1.5 1.5 0 013 0V11M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6.5a1.5 1.5 0 013 0V13"/><path d="M17 11.5l1.8-1.8a1.5 1.5 0 012.2 2L16 18a6 6 0 01-6 3 6 6 0 01-6-6v-4"/>',
    gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>',
    share: '<path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M12 15V3M8 7l4-4 4 4"/>',
    megaphone: '<path d="M3 11v3l14 5V6zM17 9a3 3 0 010 6"/><path d="M6 14v4a2 2 0 004 0v-2.6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    shield: '<path d="M12 2l8 3.5v6c0 5-3.4 9.2-8 10.5-4.6-1.3-8-5.5-8-10.5v-6z"/><path d="M9 12l2 2 4-4"/>',
    download: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 19h16"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 6.3"/><path d="M20 5v6h-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6-3-3-4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z"/><path d="M14.5 5.5l4 4"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
    wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 15.5a5 5 0 017 0M5 12a10 10 0 013.5-2.3M19 12a10 10 0 00-7.5-2.9M12 19h.01"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9 2 2-2 2 2 2-3 3-2-2-2 2"/>'
  };
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = PATHS[name] || PATHS.info;
    return s;
  }
  var CATS = [
    { id: 'naam', icon: 'flame', key: 'catNaam' },
    { id: 'satsang', icon: 'megaphone', key: 'catSatsang' },
    { id: 'path', icon: 'book', key: 'catPath' },
    { id: 'bhandara', icon: 'bowl', key: 'catBhandara' },
    { id: 'seva', icon: 'hands', key: 'catSeva' },
    { id: 'daan', icon: 'gift', key: 'catDaan' },
    { id: 'prachar', icon: 'share', key: 'catPrachar' },
    { id: 'other', icon: 'sparkle', key: 'catOther' }
  ];
  function cat(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return CATS[7]; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return iso(new Date()); }
  function shiftISO(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ------------------------------------------------------------------ vault */
  /* Browser preview vault: deflate-raw then AES-256-GCM, key held non-extractable
   * in IndexedDB. Mirrors the native pipeline so the storage screen is honest in
   * both environments. */
  var BrowserVault = (function () {
    var DB = 'satseva-vault', STORE = 'kv';
    function open() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
          t.oncomplete = function () { db.close(); res(req && req.result); };
          t.onerror = function () { db.close(); rej(t.error); };
        });
      });
    }
    function key() {
      return tx('readonly', function (s) { return s.get('key'); }).then(function (k) {
        if (k) return k;
        return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
          .then(function (nk) { return tx('readwrite', function (s) { return s.put(nk, 'key'); }).then(function () { return nk; }); });
      });
    }
    function deflate(buf) {
      if (typeof CompressionStream !== 'function') return Promise.resolve({ data: buf, z: false });
      return new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
        .then(function (b) { return { data: new Uint8Array(b), z: true }; });
    }
    function inflate(buf) {
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    }
    return {
      save: function (json) {
        var raw = new TextEncoder().encode(json);
        return deflate(raw).then(function (c) {
          return key().then(function (k) {
            var iv = crypto.getRandomValues(new Uint8Array(12));
            return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode('satseva-web-v1') }, k, c.data)
              .then(function (ct) {
                var out = new Uint8Array(17 + ct.byteLength);
                out[0] = 83; out[1] = 87; out[2] = 86; out[3] = 49; out[4] = c.z ? 1 : 0;
                out.set(iv, 5); out.set(new Uint8Array(ct), 17);
                return tx('readwrite', function (s) { return s.put(out, 'journal'); }).then(function () {
                  return { raw: raw.length, compressed: c.data.length, stored: out.length };
                });
              });
          });
        });
      },
      load: function () {
        return tx('readonly', function (s) { return s.get('journal'); }).then(function (out) {
          if (!out) return null;
          return key().then(function (k) {
            return crypto.subtle.decrypt({ name: 'AES-GCM', iv: out.slice(5, 17), additionalData: new TextEncoder().encode('satseva-web-v1') }, k, out.slice(17))
              .then(function (pt) { return out[4] ? inflate(new Uint8Array(pt)) : pt; })
              .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
          });
        });
      },
      clear: function () { return tx('readwrite', function (s) { return s.delete('journal'); }); }
    };
  })();

  /* ------------------------------------------------------------------ state */
  function blank() {
    return {
      schema: SCHEMA,
      profile: { name: '', city: '' },
      entries: [],
      goal: { weekly: 180 },
      settings: { lang: 'hi', notifications: false, reminder: false, reminderTime: '20:00', autoUpdate: true, bannerTheme: 'dawn' },
      meta: { created: Date.now(), updated: Date.now(), uiHealthy: 0 }
    };
  }
  function sanitise(o) {
    var s = blank();
    if (!o || typeof o !== 'object') return s;
    if (o.profile) { s.profile.name = String(o.profile.name || '').slice(0, 40); s.profile.city = String(o.profile.city || '').slice(0, 60); }
    if (o.goal) s.goal.weekly = clamp(parseInt(o.goal.weekly, 10) || 180, 15, 10080);
    if (o.settings) {
      var st = o.settings;
      if (['en', 'hi', 'pa'].indexOf(st.lang) >= 0) s.settings.lang = st.lang;
      s.settings.notifications = !!st.notifications;
      s.settings.reminder = !!st.reminder;
      if (/^\d{2}:\d{2}$/.test(st.reminderTime || '')) s.settings.reminderTime = st.reminderTime;
      s.settings.autoUpdate = st.autoUpdate !== false;
      if (['dawn', 'ivory', 'night'].indexOf(st.bannerTheme) >= 0) s.settings.bannerTheme = st.bannerTheme;
    }
    if (Array.isArray(o.entries)) {
      s.entries = o.entries.slice(0, 20000).filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
        return {
          id: String(e.id || uid()).slice(0, 40),
          date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : todayISO(),
          cat: cat(e.cat).id,
          title: String(e.title || '').slice(0, 140),
          minutes: clamp(parseInt(e.minutes, 10) || 0, 0, 1440),
          place: String(e.place || '').slice(0, 90),
          note: String(e.note || '').slice(0, 2000),
          created: Number(e.created) || Date.now()
        };
      }).filter(function (e) { return e.title.length > 0; });
    }
    if (o.meta) { s.meta.created = Number(o.meta.created) || Date.now(); s.meta.uiHealthy = Number(o.meta.uiHealthy) || 0; }
    return s;
  }

  var state = blank();
  var t = I18N.make('hi');
  var route = 'today';
  var filter = 'all';
  var query = '';
  var info = { versionName: '1.0.0', versionCode: 1, uiVersion: 1, native: false, notifications: false, install: false };
  var feed = { events: [], notes: [], latest: null, checked: 0, status: 'idle', progress: 0, error: '', apkReady: false, required: false };
  var stats = { raw: 0, compressed: 0, stored: 0 };
  var saving = null;

  function lang() { return state.settings.lang; }
  function setLang(l) { state.settings.lang = l; t = I18N.make(l); document.documentElement.lang = l; }
  function loc() { return lang() === 'hi' ? 'hi-IN' : lang() === 'pa' ? 'pa-IN' : 'en-GB'; }
  function dateLabel(s, long) {
    if (s === todayISO()) return t('today');
    if (s === shiftISO(-1)) return t('yesterday');
    try {
      return parseISO(s).toLocaleDateString(loc(), long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' });
    } catch (e) { return s; }
  }
  function relTime(ms) {
    if (!ms) return t('never');
    var d = Math.floor((Date.now() - ms) / 1000);
    if (d < 60) return t('justNow');
    if (d < 3600) return t('minsAgo', { n: Math.floor(d / 60) });
    if (d < 86400) return t('hoursAgo', { n: Math.floor(d / 3600) });
    return t('daysAgo', { n: Math.floor(d / 86400) });
  }

  function persist() {
    state.meta.updated = Date.now();
    if (saving) return saving;
    var json = JSON.stringify(state);
    var job = NATIVE
      ? Promise.resolve().then(function () {
        var r = NATIVE.saveVault(json);
        if (r && r.indexOf('ok') !== 0) throw new Error(r);
        try { stats = JSON.parse(NATIVE.vaultStats()); } catch (e) { }
      })
      : BrowserVault.save(json).then(function (s) { stats = s; });
    saving = job.catch(function (e) { toast(t('errorTitle')); console.error(e); }).then(function () { saving = null; });
    return saving;
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ------------------------------------------------------------- aggregates */
  function entriesOn(d) { return state.entries.filter(function (e) { return e.date === d; }); }
  function minutesOn(d) { return entriesOn(d).reduce(function (a, e) { return a + e.minutes; }, 0); }
  function weekMinutes() { var s = 0; for (var i = 0; i < 7; i++) s += minutesOn(shiftISO(-i)); return s; }
  function streak() {
    var n = 0, i = entriesOn(todayISO()).length ? 0 : 1;
    for (; i < 400; i++) { if (entriesOn(shiftISO(-i)).length) n++; else break; }
    return n;
  }

  /* ------------------------------------------------------------------ shell */
  function header() {
    var hr = new Date().getHours();
    var greet = hr < 12 ? t('goodMorning') : hr < 17 ? t('goodAfternoon') : t('goodEvening');
    var name = state.profile.name || t('guest');
    var initials = (state.profile.name || '').trim().slice(0, 2).toUpperCase();
    return h('header', { class: 'app-header' }, [
      h('div', {}, [
        h('div', { class: 'greeting-label' }, [icon(hr < 18 ? 'sun' : 'moon'), h('span', { text: greet })]),
        h('div', { class: 'greeting-title', text: name })
      ]),
      h('div', { class: 'header-tools' }, [
        h('button', {
          class: 'circle-btn press', 'aria-label': t('notifications'), onclick: function () { navigate('more'); setTimeout(notificationsSheet, 60); }
        }, [icon('bell'), feed.latest && !feed.seen ? h('i', { class: 'notify-dot' }) : null]),
        h('button', { class: 'avatar press', 'aria-label': t('profile'), onclick: profileSheet, text: initials || 'ॐ' })
      ])
    ]);
  }

  function nav() {
    var items = [
      { id: 'today', icon: 'home', label: t('navToday') },
      { id: 'journal', icon: 'book', label: t('navJournal') },
      { id: 'fab' },
      { id: 'bhandara', icon: 'bowl', label: t('navBhandara') },
      { id: 'more', icon: 'dots', label: t('navMore') }
    ];
    return h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, items.map(function (it) {
      if (it.id === 'fab') return h('button', { class: 'nav-fab', 'aria-label': t('addSeva'), onclick: function () { sevaForm(null); } }, [icon('plus')]);
      var active = route === it.id;
      return h('button', {
        class: 'nav-button' + (active ? ' active' : ''), 'aria-current': active ? 'page' : null,
        onclick: function () { navigate(it.id); }
      }, [icon(it.icon), h('span', { text: it.label })]);
    }));
  }

  function navigate(r) {
    route = r; filter = 'all'; query = '';
    render();
    var main = document.getElementById('main');
    if (main) { main.scrollIntoView({ block: 'start', behavior: 'auto' }); }
    window.scrollTo(0, 0);
  }

  function render() {
    var hdr = document.getElementById('app-header');
    var main = document.getElementById('main');
    var nv = document.getElementById('navigation');
    hdr.innerHTML = ''; main.innerHTML = ''; nv.innerHTML = '';
    if (route === 'today') { hdr.appendChild(header()); main.appendChild(todayPage()); }
    else if (route === 'journal') main.appendChild(journalPage());
    else if (route === 'bhandara') main.appendChild(bhandaraPage());
    else main.appendChild(morePage());
    nv.appendChild(nav());
    renderGate();
  }

  /* ------------------------------------------------------------- today page */
  function statCard(ic, value, unit, label, accent) {
    return h('div', { class: 'stat-card' + (accent ? ' accent' : '') }, [
      icon(ic),
      h('div', { class: 'stat-value' }, [String(value), unit ? h('small', { text: unit }) : null]),
      h('div', { class: 'stat-name', text: label })
    ]);
  }

  function todayPage() {
    var list = entriesOn(todayISO()).sort(function (a, b) { return b.created - a.created; });
    var wk = weekMinutes(), goal = state.goal.weekly, pct = clamp(Math.round(wk / goal * 100), 0, 100);
    var page = h('div', { class: 'page' }, [
      h('section', { class: 'hero' }, [
        h('img', { src: 'assets/hero-diya.webp', alt: '' }),
        h('span', { class: 'hero-badge' }, [icon('lock'), h('span', { text: t('encrypted') })]),
        h('div', { class: 'hero-body' }, [
          h('span', { class: 'eyebrow', text: t('heroEyebrow') }),
          h('h1', { text: t('heroTitle') }),
          h('p', { text: t('heroBody') })
        ])
      ]),
      h('div', { class: 'stat-row' }, [
        statCard('sparkle', list.length, '', t('statToday'), true),
        statCard('flame', streak(), '', t('statStreak')),
        statCard('clock', wk, t('minutes'), t('statWeek'))
      ]),
      h('div', { style: { marginTop: '14px' } }, [
        h('button', { class: 'primary saffron press', onclick: function () { sevaForm(null); } }, [icon('plus'), h('span', { text: t('addSeva') })])
      ]),
      h('button', { class: 'goal-card press', onclick: goalSheet }, [
        ring(pct),
        h('div', { class: 'goal-copy' }, [
          h('strong', { text: t('weeklyGoal') }),
          h('span', { text: t('goalProgress', { a: wk, b: goal }) })
        ]),
        icon('chevron')
      ]),
      h('section', { class: 'section' }, [
        h('div', { class: 'section-title' }, [
          h('h2', { text: t('todayEntries') }),
          state.entries.length ? h('button', { class: 'text-btn', onclick: function () { navigate('journal'); } }, [h('span', { text: t('seeAll') }), icon('chevron')]) : null
        ]),
        list.length ? h('div', { class: 'entry-list' }, list.slice(0, 4).map(entryCard)) : emptyBlock('sparkle', t('emptyToday'), t('emptyTodayBody'))
      ]),
      h('section', { class: 'section' }, [
        h('div', { class: 'section-title' }, [h('h2', { text: t('weekActivity') })]),
        chart()
      ])
    ]);
    return page;
  }

  function ring(pct) {
    var C = 2 * Math.PI * 24;
    var wrap = h('div', { class: 'ring' });
    wrap.innerHTML = '<svg width="56" height="56" viewBox="0 0 56 56"><circle class="track" cx="28" cy="28" r="24"/><circle class="value" cx="28" cy="28" r="24" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - pct / 100)) + '"/></svg>';
    wrap.appendChild(h('b', { text: pct + '%' }));
    return wrap;
  }

  function chart() {
    var vals = [], max = 1;
    for (var i = 6; i >= 0; i--) { var d = shiftISO(-i); var m = minutesOn(d); vals.push({ d: d, m: m }); if (m > max) max = m; }
    return h('div', { class: 'chart-card' }, [
      h('div', { class: 'bars' }, vals.map(function (v, idx) {
        var pctH = Math.round(v.m / max * 78) + 5;
        var wd;
        try { wd = parseISO(v.d).toLocaleDateString(loc(), { weekday: 'narrow' }); } catch (e) { wd = ''; }
        return h('div', { class: 'bar-col' + (idx === 6 ? ' is-today' : '') }, [
          h('div', { class: 'bar' + (v.m ? ' filled' : ''), style: { height: pctH + '%' }, title: v.m + ' ' + t('minutes') }),
          h('span', { text: wd })
        ]);
      }))
    ]);
  }

  function entryCard(e) {
    var c = cat(e.cat);
    return h('button', { class: 'entry press', onclick: function () { entrySheet(e); } }, [
      h('div', { class: 'entry-thumb' + (['satsang', 'path', 'prachar'].indexOf(e.cat) >= 0 ? ' sage' : '') }, [icon(c.icon)]),
      h('div', { class: 'entry-main' }, [
        h('span', { class: 'entry-title', text: e.title }),
        h('div', { class: 'entry-meta' }, [
          h('span', { text: t(c.key) }),
          e.place ? h('i') : null, e.place ? h('span', { text: e.place }) : null,
          route === 'journal' ? h('i') : null, route === 'journal' ? h('span', { text: dateLabel(e.date) }) : null
        ])
      ]),
      h('div', { class: 'entry-end' }, [
        e.minutes ? h('span', { class: 'entry-mins' }, [String(e.minutes), h('small', { text: t('minutes') })]) : null,
        icon('chevron')
      ])
    ]);
  }

  function emptyBlock(ic, title, body, action) {
    return h('div', { class: 'empty' }, [
      h('div', { class: 'empty-mark' }, [icon(ic)]),
      h('strong', { text: title }), h('p', { text: body }),
      action || null
    ]);
  }

  /* ----------------------------------------------------------- journal page */
  function journalPage() {
    var page = h('div', {}, [
      h('div', { class: 'page-heading' }, [
        h('h1', { text: t('navJournal') }),
        h('p', { text: state.entries.length + ' ' + t('sevas') + ' · ' + t('offlineReady') })
      ])
    ]);
    var inner = h('div', { class: 'page' });
    var search = h('input', {
      type: 'search', placeholder: t('search'), value: query, 'aria-label': t('search'),
      oninput: function (ev) { query = ev.target.value; paint(); }
    });
    inner.appendChild(h('label', { class: 'field', style: { margin: '0 0 14px' } }, [search]));
    var rail = h('div', { class: 'chip-rail' });
    [{ id: 'all', key: 'all', icon: 'dots' }].concat(CATS).forEach(function (c) {
      rail.appendChild(h('button', {
        class: 'chip' + (filter === c.id ? ' active' : ''), onclick: function () { filter = c.id; paint(); }
      }, [icon(c.icon), h('span', { text: t(c.key) })]));
    });
    inner.appendChild(rail);
    var results = h('div', { style: { marginTop: '16px' } });
    inner.appendChild(results);
    page.appendChild(inner);

    function paint() {
      Array.prototype.forEach.call(rail.children, function (b, i) {
        var id = i === 0 ? 'all' : CATS[i - 1].id;
        b.className = 'chip' + (filter === id ? ' active' : '');
      });
      results.innerHTML = '';
      var q = query.trim().toLowerCase();
      var list = state.entries.filter(function (e) {
        if (filter !== 'all' && e.cat !== filter) return false;
        if (!q) return true;
        return (e.title + ' ' + e.note + ' ' + e.place + ' ' + t(cat(e.cat).key)).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return a.date === b.date ? b.created - a.created : (a.date < b.date ? 1 : -1); });
      if (!state.entries.length) {
        results.appendChild(emptyBlock('book', t('emptyJournal'), t('emptyJournalBody'),
          h('button', { class: 'primary saffron press', onclick: function () { sevaForm(null); } }, [icon('plus'), h('span', { text: t('addSevaShort') })])));
        return;
      }
      if (!list.length) { results.appendChild(emptyBlock('search', t('noResults'), '')); return; }
      var byDay = {}, order = [];
      list.forEach(function (e) { if (!byDay[e.date]) { byDay[e.date] = []; order.push(e.date); } byDay[e.date].push(e); });
      order.forEach(function (d) {
        results.appendChild(h('div', { class: 'day-label', text: dateLabel(d, true) }));
        results.appendChild(h('div', { class: 'entry-list' }, byDay[d].map(entryCard)));
      });
    }
    paint();
    return page;
  }

  /* ---------------------------------------------------------- bhandara page */
  function bhandaraPage() {
    var evs = feed.events || [];
    var page = h('div', {}, [
      h('div', { class: 'page-heading' }, [
        h('h1', { text: t('bhandaraTitle') }),
        h('p', { text: t('bhandaraIntro') })
      ]),
      h('div', { class: 'page' }, [
        h('div', { class: 'photo-rail' }, [
          photoCard('assets/hero-bhandara.webp', t('bannerStudio'), t('makeBanner'), function () { bannerForm(); }),
          photoCard('assets/hero-diya.webp', t('announcements'), evs.length ? evs.length + '' : t('noAnnouncements'), function () { checkUpdates(true); })
        ]),
        h('section', { class: 'section' }, [
          h('div', { class: 'section-title' }, [
            h('h2', { text: t('announcements') }),
            h('button', { class: 'text-btn', onclick: function () { checkUpdates(true); } }, [icon('refresh'), h('span', { text: t('checkNow') })])
          ]),
          evs.length
            ? h('div', { class: 'entry-list' }, evs.map(eventCard))
            : emptyBlock('calendar', t('noAnnouncements'), t('noAnnouncementsBody'))
        ]),
        h('section', { class: 'section' }, [
          h('div', { class: 'section-title' }, [h('h2', { text: t('bannerStudio') })]),
          h('div', { class: 'notice calm' }, [icon('image'), h('div', { text: t('bannerIntro') })]),
          h('button', { class: 'primary press', onclick: bannerForm }, [icon('image'), h('span', { text: t('makeBanner') })])
        ])
      ])
    ]);
    return page;
  }

  function photoCard(src, title, sub, onclick) {
    return h('button', { class: 'photo-card press', onclick: onclick }, [
      h('img', { src: src, alt: '' }),
      h('div', {}, [h('strong', { text: title }), h('span', { text: sub })])
    ]);
  }

  function eventCard(ev) {
    var d = ev.date ? parseISO(ev.date) : null;
    var mon = '';
    try { mon = d ? d.toLocaleDateString(loc(), { month: 'short' }) : ''; } catch (e) { }
    return h('button', { class: 'event-card press', onclick: function () { eventSheet(ev); } }, [
      h('div', { class: 'event-date' }, [
        h('b', { text: d ? String(d.getDate()) : '—' }),
        h('span', { text: mon })
      ]),
      h('div', { class: 'event-info' }, [
        h('strong', { text: pick(ev.title) }),
        h('p', { text: [pick(ev.place), ev.time || ''].filter(Boolean).join(' · ') }),
        ev.tag ? h('span', { class: 'event-tag', text: pick(ev.tag) }) : null
      ]),
      icon('chevron')
    ]);
  }
  function pick(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v[lang()] || v.en || v.hi || '';
  }

  /* ------------------------------------------------------------- more page */
  function row(ic, title, sub, onclick, right) {
    return h('button', { class: 'settings-row press', onclick: onclick }, [
      h('div', { class: 'settings-icon' }, [icon(ic)]),
      h('div', { class: 'settings-copy' }, [h('strong', { text: title }), sub ? h('small', { text: sub }) : null]),
      right || icon('chevron')
    ]);
  }
  function toggle(on) { return h('div', { class: 'switch' + (on ? ' on' : '') }); }

  function morePage() {
    var initials = (state.profile.name || '').trim().slice(0, 2).toUpperCase();
    return h('div', {}, [
      h('div', { class: 'page-heading' }, [h('h1', { text: t('moreTitle') })]),
      h('div', { class: 'page' }, [
        h('button', { class: 'profile-card press', onclick: profileSheet }, [
          h('div', { class: 'profile-logo', text: initials || 'ॐ' }),
          h('div', { style: { flex: '1' } }, [
            h('strong', { text: state.profile.name || t('guest') }),
            h('span', { text: state.profile.city || t('profileBody') })
          ]),
          icon('chevron')
        ]),
        h('div', { class: 'settings-group' }, [
          row('globe', t('language'), I18N.langs.filter(function (l) { return l.id === lang(); })[0].native, languageSheet),
          row('bell', t('notifications'), feedNativeNotif() ? t('notificationsOn') : t('notificationsBody'), notificationsSheet),
          row('clock', t('dailyReminder'), state.settings.reminder ? state.settings.reminderTime : t('reminderBody'), reminderSheet, toggle(state.settings.reminder)),
          row('target', t('weeklyGoal'), state.goal.weekly + ' ' + t('minutes'), goalSheet)
        ]),
        h('div', { class: 'settings-group' }, [
          row('database', t('storage'), t('storageBody'), storageSheet),
          row('lock', t('backup'), t('backupBody'), backupSheet),
          row('shield', t('permissions'), '', permissionsSheet)
        ]),
        h('div', { class: 'settings-group' }, [
          row('download', t('updates'), feed.latest ? t('updateAvailable') : t('updatesBody'), updatesSheet,
            feed.latest ? h('span', { class: 'settings-value', style: { color: 'var(--saffron-ink)' }, text: feed.latest.versionName || '' }) : icon('chevron')),
          row('info', t('about'), 'v' + info.versionName, aboutSheet)
        ]),
        h('p', { class: 'form-note', style: { marginTop: '20px' } }, [t('independent')])
      ])
    ]);
  }
  function feedNativeNotif() { return NATIVE ? !!info.notifications : state.settings.notifications; }

  /* ----------------------------------------------------------------- sheets */
  var sheetEl, sheetBody;
  function openSheet(node) {
    sheetEl = document.getElementById('sheet');
    sheetBody = document.getElementById('sheet-content');
    sheetBody.innerHTML = '';
    sheetBody.appendChild(node);
    if (!sheetEl.open) sheetEl.showModal();
    sheetEl.scrollTop = 0;
  }
  function closeSheet() { if (sheetEl && sheetEl.open) sheetEl.close(); }
  function sheetHead(title, desc) {
    return h('div', {}, [
      h('div', { class: 'sheet-head' }, [
        h('h2', { text: title }),
        h('button', { 'aria-label': t('close'), onclick: closeSheet }, [icon('close')])
      ]),
      desc ? h('p', { class: 'sheet-desc', text: desc }) : null
    ]);
  }
  function field(label, input, help) {
    return h('label', { class: 'field' }, [h('span', { text: label }), input, help ? h('div', { class: 'field-help', text: help }) : null]);
  }

  function sevaForm(entry) {
    var editing = !!entry;
    var e = entry || { id: uid(), date: todayISO(), cat: 'naam', title: '', minutes: 30, place: '', note: '', created: Date.now() };
    var draft = JSON.parse(JSON.stringify(e));
    var titleIn = h('input', { type: 'text', value: draft.title, placeholder: t('fieldTitleHint'), maxlength: 140, oninput: function (ev) { draft.title = ev.target.value; } });
    var dateIn = h('input', { type: 'date', value: draft.date, max: todayISO(), onchange: function (ev) { draft.date = ev.target.value || todayISO(); } });
    var minIn = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '1440', value: draft.minutes, oninput: function (ev) { draft.minutes = clamp(parseInt(ev.target.value, 10) || 0, 0, 1440); } });
    var placeIn = h('input', { type: 'text', value: draft.place, placeholder: t('fieldPlaceHint'), maxlength: 90, oninput: function (ev) { draft.place = ev.target.value; } });
    var noteIn = h('textarea', { placeholder: t('fieldNoteHint'), maxlength: 2000, oninput: function (ev) { draft.note = ev.target.value; } });
    noteIn.value = draft.note;
    var grid = h('div', { class: 'cat-grid' });
    CATS.forEach(function (c) {
      grid.appendChild(h('button', {
        class: 'cat-option' + (draft.cat === c.id ? ' selected' : ''), onclick: function () {
          draft.cat = c.id;
          Array.prototype.forEach.call(grid.children, function (b, i) { b.className = 'cat-option' + (CATS[i].id === c.id ? ' selected' : ''); });
        }
      }, [icon(c.icon), h('span', { text: t(c.key) })]));
    });
    var err = h('div', { class: 'inline-error', hidden: true });
    var body = h('div', {}, [
      sheetHead(editing ? t('edit') : t('addSevaShort'), t('privacyNote')),
      field(t('fieldTitle'), titleIn),
      h('div', { class: 'field' }, [h('span', { text: t('fieldCategory') }), grid]),
      h('div', { class: 'field-grid' }, [field(t('fieldDate'), dateIn), field(t('fieldMinutes') + ' (' + t('minutes') + ')', minIn)]),
      field(t('fieldPlace'), placeIn),
      field(t('fieldNote'), noteIn),
      err,
      h('div', { class: 'sticky-cta' }, [
        h('button', {
          class: 'primary saffron press', onclick: function () {
            if (!draft.title.trim()) { err.hidden = false; err.textContent = t('needTitle'); titleIn.focus(); return; }
            draft.title = draft.title.trim();
            if (editing) {
              state.entries = state.entries.map(function (x) { return x.id === draft.id ? draft : x; });
            } else { state.entries.push(draft); }
            persist(); closeSheet(); render(); toast(editing ? t('updated') : t('saved'));
            if (NATIVE) { try { NATIVE.markHealthy(); } catch (x) { } }
          }
        }, [icon('check'), h('span', { text: editing ? t('saveChanges') : t('save') })]),
        h('div', { class: 'form-note' }, [icon('lock'), h('span', { text: t('offlineReady') })])
      ])
    ]);
    openSheet(body);
    setTimeout(function () { if (!editing) titleIn.focus(); }, 320);
  }

  function entrySheet(e) {
    var c = cat(e.cat);
    openSheet(h('div', {}, [
      sheetHead(e.title, t(c.key) + ' · ' + dateLabel(e.date, true)),
      h('div', { class: 'stat-row', style: { marginTop: '4px' } }, [
        statCard(c.icon, e.minutes || 0, t('minutes'), t('timeGiven'), true),
        statCard('calendar', parseISO(e.date).getDate(), '', dateLabel(e.date)),
        statCard('pin', e.place ? '•' : '—', '', e.place || t('fieldPlace'))
      ]),
      e.note ? h('div', { class: 'section' }, [
        h('div', { class: 'section-title' }, [h('h2', { text: t('fieldNote') })]),
        h('div', { class: 'detail-note', text: e.note })
      ]) : null,
      h('div', { class: 'sticky-cta' }, [
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'secondary press', onclick: function () { closeSheet(); setTimeout(function () { sevaForm(e); }, 180); } }, [icon('edit'), h('span', { text: t('edit') })]),
          h('button', { class: 'secondary press danger', onclick: function () { confirmDelete(e); } }, [icon('trash'), h('span', { text: t('delete') })])
        ]),
        h('div', { class: 'form-note' }, [icon('lock'), h('span', { text: t('notedOn') + ' ' + dateLabel(e.date, true) })])
      ])
    ]));
  }

  function confirmDelete(e) {
    openSheet(h('div', {}, [
      sheetHead(t('deleteSeva'), t('deleteSevaBody')),
      h('div', { class: 'sticky-cta' }, [
        h('button', {
          class: 'primary press', style: { background: '#B4553C' }, onclick: function () {
            state.entries = state.entries.filter(function (x) { return x.id !== e.id; });
            persist(); closeSheet(); render(); toast(t('deleted'));
          }
        }, [icon('trash'), h('span', { text: t('delete') })]),
        h('div', { style: { height: '10px' } }),
        h('button', { class: 'primary ghost press', onclick: closeSheet }, [h('span', { text: t('cancel') })])
      ])
    ]));
  }

  function profileSheet() {
    var n = h('input', { type: 'text', value: state.profile.name, maxlength: 40, placeholder: t('guest') });
    var c = h('input', { type: 'text', value: state.profile.city, maxlength: 60, placeholder: t('fieldPlaceHint') });
    openSheet(h('div', {}, [
      sheetHead(t('profile'), t('profileBody')),
      field(t('nameField'), n), field(t('cityField'), c),
      h('div', { class: 'sticky-cta' }, [h('button', {
        class: 'primary saffron press', onclick: function () {
          state.profile.name = n.value.trim(); state.profile.city = c.value.trim();
          persist(); closeSheet(); render(); toast(t('updated'));
        }
      }, [icon('check'), h('span', { text: t('save') })])])
    ]));
  }

  function languageSheet() {
    var list = h('div', { class: 'lang-list' });
    I18N.langs.forEach(function (l) {
      list.appendChild(h('button', {
        class: 'lang-option' + (lang() === l.id ? ' selected' : ''), onclick: function () {
          setLang(l.id); persist(); closeSheet(); render(); toast(t('updated'));
        }
      }, [
        h('div', {}, [h('strong', { text: l.native }), h('span', { text: l.label })]),
        h('div', { class: 'lang-check' }, [lang() === l.id ? icon('check') : null])
      ]));
    });
    openSheet(h('div', {}, [sheetHead(t('language'), t('languageBody')), list]));
  }

  function goalSheet() {
    var inp = h('input', { type: 'number', min: '15', max: '10080', step: '15', value: state.goal.weekly, inputmode: 'numeric' });
    openSheet(h('div', {}, [
      sheetHead(t('weeklyGoal'), t('goalBody')),
      field(t('minutes'), inp),
      h('div', { class: 'chip-rail', style: { padding: '2px 0', margin: '0' } }, [60, 120, 180, 300, 420].map(function (v) {
        return h('button', { class: 'chip' + (state.goal.weekly === v ? ' active' : ''), onclick: function () { inp.value = v; } }, [h('span', { text: v + ' ' + t('minutes') })]);
      })),
      h('div', { class: 'sticky-cta' }, [h('button', {
        class: 'primary saffron press', onclick: function () {
          state.goal.weekly = clamp(parseInt(inp.value, 10) || 180, 15, 10080);
          persist(); closeSheet(); render(); toast(t('updated'));
        }
      }, [icon('check'), h('span', { text: t('save') })])])
    ]));
  }

  function reminderSheet() {
    var on = !state.settings.reminder;
    var time = h('input', { type: 'time', value: state.settings.reminderTime });
    openSheet(h('div', {}, [
      sheetHead(t('dailyReminder'), t('reminderBody')),
      field(t('reminderTime'), time),
      h('div', { class: 'notice calm' }, [icon('info'), h('div', { text: t('pushBody') })]),
      h('div', { class: 'sticky-cta' }, [h('button', {
        class: 'primary saffron press', onclick: function () {
          state.settings.reminder = on; state.settings.reminderTime = time.value || '20:00';
          if (NATIVE) {
            try {
              if (on && !info.notifications) NATIVE.requestNotifications();
              var p = state.settings.reminderTime.split(':');
              NATIVE.setReminder(on, parseInt(p[0], 10), parseInt(p[1], 10));
            } catch (e) { }
          }
          persist(); closeSheet(); render(); toast(t('updated'));
        }
      }, [icon(on ? 'check' : 'close'), h('span', { text: on ? t('allow') : t('cancel') })])])
    ]));
  }

  function notificationsSheet() {
    var granted = feedNativeNotif();
    openSheet(h('div', {}, [
      sheetHead(t('notifications'), t('notificationsBody')),
      h('div', { class: 'notice' + (granted ? ' calm' : '') }, [icon(granted ? 'check' : 'bell'), h('div', { text: granted ? t('notificationsOn') : t('pushBody') })]),
      h('div', { class: 'settings-group' }, [
        row('megaphone', t('announcements'), t('pushTitle'), function () { checkUpdates(true); closeSheet(); navigate('bhandara'); }),
        row('download', t('updates'), t('deltaNote'), function () { closeSheet(); setTimeout(updatesSheet, 200); })
      ]),
      h('div', { class: 'sticky-cta' }, [
        NATIVE
          ? h('button', {
            class: 'primary saffron press', onclick: function () {
              try { granted ? NATIVE.openNotificationSettings() : NATIVE.requestNotifications(); } catch (e) { }
              setTimeout(function () { refreshInfo(); closeSheet(); render(); }, 900);
            }
          }, [icon('bell'), h('span', { text: granted ? t('openSettings') : t('enableNotifications') })])
          : h('button', { class: 'primary ghost press', onclick: closeSheet }, [h('span', { text: t('close') })])
      ])
    ]));
  }

  function permissionsSheet() {
    var rows = [
      ['bell', t('permNotif'), t('permNotifWhy'), NATIVE ? !!info.notifications : false, function () { try { NATIVE.requestNotifications(); } catch (e) { } }],
      ['image', t('permStorage'), t('permStorageWhy'), true, null],
      ['download', t('permInstall'), t('permInstallWhy'), NATIVE ? !!info.install : false, function () { try { NATIVE.openInstallSettings(); } catch (e) { } }]
    ];
    openSheet(h('div', {}, [
      sheetHead(t('permissions'), t('privacyNote')),
      h('div', { class: 'settings-group' }, rows.map(function (r) {
        return h('div', { class: 'settings-row' }, [
          h('div', { class: 'settings-icon' }, [icon(r[0])]),
          h('div', { class: 'settings-copy' }, [h('strong', { text: r[1] }), h('small', { text: r[2] })]),
          r[3] ? h('span', { class: 'settings-value', style: { color: 'var(--sage)' }, text: t('granted') })
            : (NATIVE && r[4] ? h('button', { class: 'secondary press', onclick: function () { r[4](); setTimeout(function () { refreshInfo(); closeSheet(); }, 900); } }, [h('span', { text: t('allow') })])
              : h('span', { class: 'settings-value', text: t('notGranted') }))
        ]);
      })),
      h('div', { class: 'sticky-cta' }, [h('button', { class: 'primary ghost press', onclick: closeSheet }, [h('span', { text: t('close') })])])
    ]));
  }

  function storageSheet() {
    var raw = stats.raw || JSON.stringify(state).length;
    var zip = stats.compressed || Math.round(raw * 0.3);
    var enc = stats.stored || zip + 33;
    var max = Math.max(raw, 1);
    var saved = raw > 0 ? Math.max(0, Math.round((1 - enc / raw) * 100)) : 0;
    function meter(label, val, cls) {
      return h('div', { class: 'meter-row' }, [
        h('div', { class: 'meter-head' }, [h('b', { text: label }), h('span', { text: bytes(val) })]),
        h('div', { class: 'meter' }, [h('i', { class: cls, style: { width: clamp(val / max * 100, 2, 100) + '%' } })])
      ]);
    }
    openSheet(h('div', {}, [
      sheetHead(t('storage'), t('storageIntro')),
      h('div', { class: 'chart-card' }, [
        meter(t('rawJson'), raw, ''),
        meter(t('compressedOnly'), zip, 'zip'),
        meter(t('storedBytes'), enc, 'enc'),
        h('div', { class: 'saving-pill' }, [icon('sparkle'), h('span', { text: t('smallerBy', { n: saved }) })])
      ]),
      h('div', { class: 'notice calm' }, [icon('shield'), h('div', { text: t('entriesCount', { n: state.entries.length }) + ' · ' + t('privacyNote') })]),
      h('div', { class: 'sticky-cta' }, [h('button', { class: 'primary ghost press', onclick: function () { closeSheet(); setTimeout(backupSheet, 200); } }, [icon('lock'), h('span', { text: t('backup') })])])
    ]));
  }

  /* --------------------------------------------------------------- backups */
  var b64 = {
    enc: function (u8) { var s = ''; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); },
    dec: function (s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  };
  function deriveKey(pass, salt) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' }, base,
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function packBackup(pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(state));
    var pre = typeof CompressionStream === 'function'
      ? new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return new Uint8Array(b); })
      : Promise.resolve(plain);
    return pre.then(function (data) {
      return deriveKey(pass, salt).then(function (k) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode('satseva-backup-v1') }, k, data);
      }).then(function (ct) {
        var out = new Uint8Array(36 + ct.byteLength);
        out.set(new TextEncoder().encode('SATSEVA1'), 0); out.set(salt, 8); out.set(iv, 24); out.set(new Uint8Array(ct), 36);
        return out;
      });
    });
  }
  function unpackBackup(u8, pass) {
    if (u8.length < 52 || new TextDecoder().decode(u8.subarray(0, 8)) !== 'SATSEVA1') return Promise.reject(new Error('format'));
    var salt = u8.subarray(8, 24), iv = u8.subarray(24, 36);
    return deriveKey(pass, salt).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode('satseva-backup-v1') }, k, u8.subarray(36));
    }).then(function (pt) {
      var head = new Uint8Array(pt, 0, Math.min(2, pt.byteLength));
      var isZ = head[0] === 0x78 || (pt.byteLength > 1 && typeof DecompressionStream === 'function');
      if (typeof DecompressionStream === 'function') {
        return new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
          .catch(function () { return pt; });
      }
      return pt;
    }).then(function (plain) { return sanitise(JSON.parse(new TextDecoder().decode(plain))); });
  }

  function backupSheet() {
    var pass = h('input', { type: 'password', minlength: 8, placeholder: '••••••••', autocomplete: 'new-password' });
    var err = h('div', { class: 'inline-error', hidden: true });
    var exportBtn = h('button', { class: 'primary saffron press' }, [icon('download'), h('span', { text: t('exportBackup') })]);
    exportBtn.addEventListener('click', function () {
      if (pass.value.length < 8) { err.hidden = false; err.textContent = t('passwordShort'); return; }
      err.hidden = true; exportBtn.disabled = true;
      packBackup(pass.value).then(function (u8) {
        var name = 'SatSeva-' + todayISO() + '.seva';
        if (NATIVE) { NATIVE.exportBackup(name, b64.enc(u8)); }
        else { downloadBlob(new Blob([u8], { type: 'application/octet-stream' }), name); }
        toast(t('backupDone'));
      }).catch(function () { err.hidden = false; err.textContent = t('errorTitle'); })
        .then(function () { exportBtn.disabled = false; });
    });
    var fileIn = h('input', { type: 'file', accept: '.seva,application/octet-stream', hidden: true });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0]; if (!f) return;
      if (pass.value.length < 8) { err.hidden = false; err.textContent = t('passwordShort'); return; }
      f.arrayBuffer().then(function (ab) { return unpackBackup(new Uint8Array(ab), pass.value); })
        .then(function (restored) { confirmRestore(restored); })
        .catch(function () { err.hidden = false; err.textContent = t('wrongPassword'); });
      fileIn.value = '';
    });
    var body = h('div', {}, [
      sheetHead(t('backup'), t('backupBody')),
      field(t('password'), pass, t('passwordHint')),
      err, exportBtn,
      h('div', { style: { height: '10px' } }),
      h('button', {
        class: 'primary ghost press', onclick: function () {
          if (NATIVE) {
            if (pass.value.length < 8) { err.hidden = false; err.textContent = t('passwordShort'); return; }
            window.SatSevaBackupPicked = function (dataB64) {
              unpackBackup(b64.dec(dataB64), pass.value).then(confirmRestore)
                .catch(function () { err.hidden = false; err.textContent = t('wrongPassword'); openSheet(body); });
            };
            try { NATIVE.importBackup(); } catch (e) { toast(t('errorTitle')); }
          } else { fileIn.click(); }
        }
      }, [icon('refresh'), h('span', { text: t('importBackup') })]),
      fileIn,
      h('div', { class: 'notice' }, [icon('info'), h('div', { text: t('restoreWarning') })])
    ]);
    openSheet(body);
  }
  function confirmRestore(restored) {
    openSheet(h('div', {}, [
      sheetHead(t('importBackup'), t('restoreWarning')),
      h('div', { class: 'notice calm' }, [icon('book'), h('div', { text: t('entriesCount', { n: restored.entries.length }) })]),
      h('div', { class: 'sticky-cta' }, [
        h('button', {
          class: 'primary saffron press', onclick: function () {
            var keepLang = lang();
            state = restored; setLang(keepLang);
            persist(); closeSheet(); render(); toast(t('restoreDone'));
          }
        }, [icon('check'), h('span', { text: t('replaceJournal') })]),
        h('div', { style: { height: '10px' } }),
        h('button', { class: 'primary ghost press', onclick: closeSheet }, [h('span', { text: t('cancel') })])
      ])
    ]));
  }
  function downloadBlob(blob, name) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* --------------------------------------------------------- banner studio */
  function bannerForm() {
    var d = {
      title: t('bannerTitleDefault'), subtitle: t('bannerSubtitleDefault'),
      date: todayISO(), time: '10:00', venue: state.profile.city || '', host: state.profile.name || '',
      theme: state.settings.bannerTheme
    };
    var canvas = h('canvas', { class: 'poster-preview', width: '1080', height: '1350' });
    var inputs = {};
    function inp(key, label, type, ph) {
      var el = h('input', {
        type: type || 'text', value: d[key], placeholder: ph || '', oninput: function (ev) { d[key] = ev.target.value; draw(); }
      });
      inputs[key] = el; return field(label, el);
    }
    var themes = h('div', { class: 'theme-row' });
    [['dawn', t('themeDawn')], ['ivory', t('themeIvory')], ['night', t('themeNight')]].forEach(function (th) {
      themes.appendChild(h('button', {
        class: 'theme-swatch ' + th[0] + (d.theme === th[0] ? ' selected' : ''), onclick: function () {
          d.theme = th[0]; state.settings.bannerTheme = th[0]; persist();
          Array.prototype.forEach.call(themes.children, function (b, i) {
            b.className = 'theme-swatch ' + ['dawn', 'ivory', 'night'][i] + (['dawn', 'ivory', 'night'][i] === th[0] ? ' selected' : '');
          });
          draw();
        }
      }, [h('span', { text: th[1] })]));
    });
    function draw() { drawPoster(canvas, d); }
    var saveBtn = h('button', { class: 'primary saffron press' }, [icon('download'), h('span', { text: t('savePng') })]);
    saveBtn.addEventListener('click', function () {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var name = 'SatSeva-Bhandara-' + d.date + '.png';
        if (NATIVE) {
          blob.arrayBuffer().then(function (ab) {
            try { NATIVE.saveBanner(name, b64.enc(new Uint8Array(ab))); toast(t('bannerSaved')); }
            catch (e) { toast(t('errorTitle')); }
          });
        } else { downloadBlob(blob, name); toast(t('browserDownloaded')); }
      }, 'image/png');
    });
    var shareBtn = h('button', { class: 'secondary press' }, [icon('share'), h('span', { text: t('shareBanner') })]);
    shareBtn.addEventListener('click', function () {
      var text = [d.title, d.subtitle, dateLabel(d.date, true) + ' ' + d.time, d.venue, d.host].filter(Boolean).join('\n');
      if (NATIVE) {
        canvas.toBlob(function (blob) {
          blob.arrayBuffer().then(function (ab) {
            try { NATIVE.shareBanner('SatSeva-Bhandara.png', b64.enc(new Uint8Array(ab)), text); } catch (e) { toast(t('errorTitle')); }
          });
        }, 'image/png');
      } else if (navigator.share) { navigator.share({ text: text }).catch(function () { }); }
      else { downloadBlob(new Blob([text], { type: 'text/plain' }), 'bhandara.txt'); }
    });
    openSheet(h('div', {}, [
      sheetHead(t('bannerStudio'), t('bannerIntro')),
      canvas,
      inp('title', t('bannerTitleField')),
      inp('subtitle', t('bannerSubtitle')),
      h('div', { class: 'field-grid' }, [inp('date', t('fieldDate'), 'date'), inp('time', t('bannerTime'), 'time')]),
      inp('venue', t('bannerVenue'), 'text', t('fieldPlaceHint')),
      inp('host', t('bannerHost'), 'text', t('fieldPlaceHint')),
      h('div', { class: 'field' }, [h('span', { text: t('bannerTheme') }), themes]),
      h('div', { class: 'sticky-cta' }, [saveBtn, h('div', { style: { height: '10px' } }), shareBtn])
    ]));
    setTimeout(draw, 60);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }

  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    var words = String(text).split(/\s+/), line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; } else line = test;
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lh); });
    return lines.length * lh;
  }

  function drawPoster(canvas, d) {
    var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    var TH = {
      dawn: { bg1: '#FFF6E6', bg2: '#F6D9A9', ink: '#5A3A14', sub: '#8A6534', accent: '#D9762A', rule: '#E0B87C' },
      ivory: { bg1: '#FFFFFF', bg2: '#EFE9DE', ink: '#26241E', sub: '#6E675B', accent: '#C2611F', rule: '#DCD4C6' },
      night: { bg1: '#2A2723', bg2: '#463A2C', ink: '#FBEFD9', sub: '#CBB894', accent: '#EDAB63', rule: '#6B5B45' }
    }[d.theme] || null;
    if (!TH) TH = { bg1: '#FFF6E6', bg2: '#F6D9A9', ink: '#5A3A14', sub: '#8A6534', accent: '#D9762A', rule: '#E0B87C' };
    var g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, TH.bg1); g.addColorStop(1, TH.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // decorative arch
    ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = TH.accent;
    ctx.beginPath(); ctx.arc(W / 2, 330, 250, Math.PI, 0); ctx.lineTo(W / 2 + 250, 470); ctx.lineTo(W / 2 - 250, 470); ctx.closePath(); ctx.fill(); ctx.restore();
    // border
    ctx.strokeStyle = TH.rule; ctx.lineWidth = 3; ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = TH.accent; ctx.lineWidth = 1.5; ctx.strokeRect(60, 60, W - 120, H - 120);
    ctx.textAlign = 'center';
    // flame glyph
    ctx.fillStyle = TH.accent;
    ctx.beginPath();
    ctx.moveTo(W / 2, 175); ctx.bezierCurveTo(W / 2 + 62, 250, W / 2 + 78, 285, W / 2 + 78, 320);
    ctx.bezierCurveTo(W / 2 + 78, 368, W / 2 + 43, 400, W / 2, 400);
    ctx.bezierCurveTo(W / 2 - 43, 400, W / 2 - 78, 368, W / 2 - 78, 320);
    ctx.bezierCurveTo(W / 2 - 78, 285, W / 2 - 62, 250, W / 2, 175); ctx.closePath(); ctx.fill();
    ctx.fillStyle = TH.bg1; ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.ellipse(W / 2, 340, 26, 42, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    // lamp
    ctx.fillStyle = TH.ink; ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.ellipse(W / 2, 424, 120, 26, 0, 0, Math.PI); ctx.fill(); ctx.globalAlpha = 1;

    var font = '"Manrope","Noto",system-ui,sans-serif';
    ctx.fillStyle = TH.sub; ctx.font = '700 30px ' + font;
    ctx.fillText(t('invocation'), W / 2, 510);
    ctx.fillStyle = TH.ink; ctx.font = '800 96px ' + font;
    var used = wrapText(ctx, d.title || t('bannerTitleDefault'), W / 2, 625, W - 200, 108, 2);
    ctx.fillStyle = TH.sub; ctx.font = '600 38px ' + font;
    wrapText(ctx, d.subtitle || '', W / 2, 640 + used, W - 240, 52, 2);
    // rule
    ctx.strokeStyle = TH.rule; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 130, 880); ctx.lineTo(W / 2 + 130, 880); ctx.stroke();
    ctx.fillStyle = TH.accent; ctx.beginPath(); ctx.arc(W / 2, 880, 8, 0, Math.PI * 2); ctx.fill();
    // details
    ctx.fillStyle = TH.ink; ctx.font = '800 54px ' + font;
    ctx.fillText(dateLabel(d.date, true), W / 2, 962);
    ctx.font = '600 40px ' + font; ctx.fillStyle = TH.sub;
    if (d.time) ctx.fillText(d.time, W / 2, 1022);
    ctx.font = '600 36px ' + font; ctx.fillStyle = TH.ink;
    if (d.venue) wrapText(ctx, d.venue, W / 2, 1100, W - 220, 48, 2);
    if (d.host) { ctx.font = '600 30px ' + font; ctx.fillStyle = TH.sub; ctx.fillText(t('bannerHost') + ': ' + d.host, W / 2, 1218); }
    ctx.font = '700 22px ' + font; ctx.fillStyle = TH.sub; ctx.globalAlpha = .75;
    ctx.fillText('SatSeva', W / 2, 1288); ctx.globalAlpha = 1;
  }

  function eventSheet(ev) {
    openSheet(h('div', {}, [
      sheetHead(pick(ev.title), [dateLabel(ev.date, true), ev.time].filter(Boolean).join(' · ')),
      ev.image ? h('div', { class: 'sheet-hero' }, [h('img', { src: ev.image, alt: '' })]) : null,
      ev.place ? h('div', { class: 'notice calm' }, [icon('pin'), h('div', { text: pick(ev.place) })]) : null,
      pick(ev.body) ? h('div', { class: 'detail-note', text: pick(ev.body) }) : null,
      h('div', { class: 'sticky-cta' }, [
        h('button', {
          class: 'primary press', onclick: function () {
            var text = [pick(ev.title), dateLabel(ev.date, true) + ' ' + (ev.time || ''), pick(ev.place), pick(ev.body)].filter(Boolean).join('\n');
            if (NATIVE) { try { NATIVE.shareText(text); } catch (e) { } }
            else if (navigator.share) navigator.share({ text: text }).catch(function () { });
            else downloadBlob(new Blob([text], { type: 'text/plain' }), 'bhandara.txt');
          }
        }, [icon('share'), h('span', { text: t('shareBanner') })]),
        h('div', { style: { height: '10px' } }),
        h('button', {
          class: 'primary ghost press', onclick: function () {
            closeSheet();
            setTimeout(function () {
              bannerForm();
              setTimeout(function () {
                var sc = document.getElementById('sheet-content');
                var ins = sc.querySelectorAll('input');
                if (ins[0]) { ins[0].value = pick(ev.title); ins[0].dispatchEvent(new Event('input')); }
              }, 120);
            }, 200);
          }
        }, [icon('image'), h('span', { text: t('makeBanner') })])
      ])
    ]));
  }

  /* ---------------------------------------------------------------- updates */
  function updatesSheet() {
    var body = h('div', {});
    function paint() {
      body.innerHTML = '';
      var latest = feed.latest;
      body.appendChild(sheetHead(t('updates'), t('deltaNote')));
      body.appendChild(h('div', { class: 'version-card' }, [
        h('img', { src: 'assets/logo.svg', alt: '' }),
        h('h3', { text: t('appName') }),
        h('p', { text: t('tagline') }),
        h('div', { class: 'version-line' }, [h('span', { text: t('installedVersion') }), h('strong', { text: 'v' + info.versionName + ' (' + info.versionCode + ')' })]),
        h('div', { class: 'version-line' }, [h('span', { text: t('interfaceVersion') }), h('strong', { text: 'r' + info.uiVersion })]),
        h('div', { class: 'version-line' }, [h('span', { text: t('latestVersion') }), h('strong', { text: latest ? (latest.versionName || '—') : (feed.status === 'checking' ? t('checking') : t('upToDate')) })]),
        h('div', { class: 'version-line' }, [h('span', { text: t('lastChecked', { when: '' }).trim() }), h('strong', { text: relTime(feed.checked) })])
      ]));
      if (feed.error) body.appendChild(h('div', { class: 'inline-error', text: feed.error }));
      if (latest && feed.notes && feed.notes.length) {
        body.appendChild(h('div', { class: 'release-notes' }, [
          h('h4', { text: t('whatsNew') }),
          h('ul', {}, feed.notes.map(function (n) { return h('li', { text: pick(n) || String(n) }); }))
        ]));
      }
      if (feed.status === 'downloading') {
        body.appendChild(h('div', { class: 'progress' }, [h('i', { style: { width: feed.progress + '%' } })]));
        body.appendChild(h('p', { class: 'sheet-desc', text: t('downloading', { n: feed.progress }) }));
      }
      if (latest && latest.filesChanged) body.appendChild(h('p', { class: 'sheet-desc', text: t('filesChanged', { n: latest.filesChanged, size: bytes(latest.downloadBytes || 0) }) }));
      if (latest && latest.apk) body.appendChild(h('div', { class: 'notice' }, [icon('info'), h('div', { text: t('apkNote') })]));
      if (feed.status === 'verified') body.appendChild(h('div', { class: 'notice calm' }, [icon('shield'), h('div', { text: t('signatureOk') })]));

      var cta = h('div', { class: 'sticky-cta' });
      if (feed.apkReady) {
        cta.appendChild(h('button', { class: 'primary saffron press', onclick: function () { try { NATIVE.installApk(); } catch (e) { toast(t('errorTitle')); } } }, [icon('download'), h('span', { text: t('installUpdate') })]));
      } else if (feed.status === 'ready') {
        cta.appendChild(h('button', { class: 'primary saffron press', onclick: function () { try { NATIVE.applyUi(); } catch (e) { } } }, [icon('refresh'), h('span', { text: t('restartToApply') })]));
      } else if (latest) {
        cta.appendChild(h('button', {
          class: 'primary saffron press', disabled: feed.status === 'downloading', onclick: function () {
            try { latest.apk ? NATIVE.downloadApk() : NATIVE.downloadUi(); } catch (e) { toast(t('errorTitle')); }
          }
        }, [icon('download'), h('span', { text: feed.status === 'downloading' ? t('downloading', { n: feed.progress }) : t('downloadUpdate') })]));
      } else {
        cta.appendChild(h('button', {
          class: 'primary ghost press', disabled: feed.status === 'checking', onclick: function () { checkUpdates(true); }
        }, [icon('refresh'), h('span', { text: feed.status === 'checking' ? t('checking') : t('checkNow') })]));
      }
      body.appendChild(cta);
      body.appendChild(h('div', { class: 'settings-group' }, [
        h('div', { class: 'settings-row' }, [
          h('div', { class: 'settings-icon' }, [icon('wifiOff')]),
          h('div', { class: 'settings-copy' }, [h('strong', { text: t('autoUpdate') }), h('small', { text: t('autoUpdateBody') })]),
          h('button', {
            class: 'switch' + (state.settings.autoUpdate ? ' on' : ''), 'aria-label': t('autoUpdate'), onclick: function () {
              state.settings.autoUpdate = !state.settings.autoUpdate; persist(); paint();
              if (NATIVE) { try { NATIVE.setAutoUpdate(state.settings.autoUpdate); } catch (e) { } }
            }
          })
        ])
      ]));
      if (info.mirrors) body.appendChild(h('div', { class: 'mirror-list' }, [h('b', { text: t('channel') + ': ' }), document.createTextNode(String(info.mirrors))]));
    }
    paint();
    openSheet(body);
    window.__repaintUpdates = paint;
    if (!feed.checked) checkUpdates(false);
  }

  function checkUpdates(force) {
    if (!NATIVE) {
      feed.checked = Date.now(); feed.status = 'idle';
      if (force) toast(t('upToDate'));
      if (window.__repaintUpdates) window.__repaintUpdates();
      return;
    }
    feed.status = 'checking'; feed.error = '';
    if (window.__repaintUpdates) window.__repaintUpdates();
    try { NATIVE.checkUpdates(!!force); } catch (e) { feed.status = 'idle'; feed.error = t('updateFailed'); }
  }

  function renderGate() {
    var gate = document.getElementById('update-gate');
    if (!feed.required) { if (gate) gate.remove(); return; }
    if (gate) return;
    gate = h('div', { class: 'update-gate', id: 'update-gate' }, [
      h('img', { src: 'assets/logo.svg', alt: '' }),
      h('h2', { text: t('requiredTitle') }),
      h('p', { text: t('requiredBody') }),
      h('button', {
        class: 'primary saffron press', onclick: function () {
          try { feed.apkReady ? NATIVE.installApk() : (feed.latest && feed.latest.apk ? NATIVE.downloadApk() : NATIVE.downloadUi()); }
          catch (e) { toast(t('updateFailed')); }
        }
      }, [icon('download'), h('span', { text: t('requiredUpdate') })]),
      h('div', { class: 'gate-status', id: 'gate-status', text: feed.status === 'downloading' ? t('downloading', { n: feed.progress }) : '' })
    ]);
    document.body.appendChild(gate);
  }

  /* --------------------------------------------------------------- about */
  function aboutSheet() {
    openSheet(h('div', {}, [
      sheetHead(t('about'), t('aboutBody')),
      h('div', { class: 'version-card' }, [
        h('img', { src: 'assets/logo.svg', alt: '' }),
        h('h3', { text: t('appName') + ' · v' + info.versionName }),
        h('p', { text: t('forSangat') }),
        h('div', { class: 'version-line' }, [h('span', { text: 'Android' }), h('strong', { text: String(info.androidRelease || '—') })]),
        h('div', { class: 'version-line' }, [h('span', { text: t('interfaceVersion') }), h('strong', { text: 'r' + info.uiVersion })])
      ]),
      h('div', { class: 'notice calm' }, [icon('shield'), h('div', { text: t('privacyNote') })]),
      h('p', { class: 'form-note' }, [t('independent')]),
      h('div', { class: 'sticky-cta' }, [h('button', { class: 'primary ghost press', onclick: closeSheet }, [h('span', { text: t('close') })])])
    ]));
  }

  /* ------------------------------------------------------- native plumbing */
  function refreshInfo() {
    if (!NATIVE) return;
    try { info = Object.assign(info, JSON.parse(NATIVE.getInfo())); } catch (e) { }
    try { stats = JSON.parse(NATIVE.vaultStats()); } catch (e) { }
    try {
      var f = JSON.parse(NATIVE.updateState());
      feed.latest = f.latest || null; feed.notes = f.notes || []; feed.events = f.events || [];
      feed.status = f.status || 'idle'; feed.progress = f.progress || 0;
      feed.apkReady = !!f.apkReady; feed.required = !!f.required; feed.error = f.error || '';
      if (f.checked) feed.checked = f.checked;
    } catch (e) { }
  }

  window.SatSevaEvent = function (name, payload) {
    var data = {};
    try { data = payload ? JSON.parse(payload) : {}; } catch (e) { }
    if (name === 'updateState') { refreshInfo(); if (window.__repaintUpdates) window.__repaintUpdates(); renderGate(); if (route === 'bhandara') render(); }
    else if (name === 'toast') { toast(data.text || ''); }
    else if (name === 'backupReady') {
      try {
        unpackBackup(b64.dec(data.data), data.pass || '').then(confirmRestore).catch(function () { toast(t('wrongPassword')); });
      } catch (e) { toast(t('wrongPassword')); }
    }
    else if (name === 'restored') { boot(); }
    else if (name === 'info') { refreshInfo(); render(); }
  };
  window.SatSevaAskPassword = function () { backupSheet(); };
  window.SatSevaBack = function () {
    var sh = document.getElementById('sheet');
    if (sh && sh.open) { closeSheet(); return true; }
    if (feed.required) return true;
    if (route !== 'today') { navigate('today'); return true; }
    return false;
  };

  /* ------------------------------------------------------------------ boot */
  function seedPreview() {
    var s = blank();
    s.settings.lang = (navigator.language || 'en').slice(0, 2) === 'hi' ? 'hi' : 'en';
    s.profile = { name: s.settings.lang === 'hi' ? 'हरि' : 'Hari', city: 'Kurukshetra' };
    var samples = [
      ['naam', s.settings.lang === 'hi' ? 'प्रातः नाम जप' : 'Morning naam jaap', 45, 0],
      ['bhandara', s.settings.lang === 'hi' ? 'भंडारे में सब्ज़ी काटी' : 'Cut vegetables for the bhandara', 90, 0],
      ['satsang', s.settings.lang === 'hi' ? 'सत्संग सुना' : 'Listened to satsang', 60, -1],
      ['seva', s.settings.lang === 'hi' ? 'आश्रम की सफ़ाई' : 'Cleaned the ashram hall', 40, -2],
      ['path', s.settings.lang === 'hi' ? 'वाणी का पाठ' : 'Read the vaani', 30, -3],
      ['daan', s.settings.lang === 'hi' ? 'अन्न दान' : 'Offered grain', 20, -5]
    ];
    samples.forEach(function (x, i) {
      s.entries.push({ id: uid() + i, cat: x[0], title: x[1], minutes: x[2], date: shiftISO(x[3]), place: '', note: '', created: Date.now() - i * 3600000 });
    });
    return s;
  }

  function boot() {
    var start = NATIVE
      ? Promise.resolve().then(function () {
        refreshInfo();
        var raw = NATIVE.loadVault();
        return raw ? sanitise(JSON.parse(raw)) : blank();
      })
      : BrowserVault.load().then(function (o) { return o ? sanitise(o) : seedPreview(); });

    start.catch(function (e) { console.error(e); return NATIVE ? blank() : seedPreview(); }).then(function (s) {
      state = s;
      setLang(state.settings.lang);
      if (!NATIVE) document.getElementById('preview-banner').hidden = false;
      render();
      var splash = document.getElementById('splash');
      setTimeout(function () {
        splash.classList.add('off');
        setTimeout(function () { splash.remove(); }, 460);
      }, NATIVE ? 260 : 620);
      if (NATIVE) {
        try { NATIVE.markHealthy(); NATIVE.setAutoUpdate(state.settings.autoUpdate); } catch (e) { }
        setTimeout(function () { checkUpdates(false); }, 1400);
      } else { persist(); }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var sheet = document.getElementById('sheet');
    sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
    var clear = document.getElementById('clear-preview');
    if (clear) clear.addEventListener('click', function () {
      BrowserVault.clear().then(function () { state = blank(); setLang(state.settings.lang); persist(); render(); document.getElementById('preview-banner').hidden = true; toast(t('updated')); });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && NATIVE) { refreshInfo(); render(); }
    });
    boot();
  });
})();
