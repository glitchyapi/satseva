/* SatSeva Release Console — runs entirely client side.
 * Nothing here is a secret at rest in the repository: the GitHub token lives in
 * sessionStorage (only if you tick "remember") and the signing key is imported
 * as a non-extractable CryptoKey. Publishing is one atomic Git commit.
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var S = { token: '', repo: 'glitchyapi/satseva', branch: 'main', key: null, config: null, feed: null, events: [], tree: null };

  function log(msg, kind) {
    var el = $('#log');
    var stamp = new Date().toLocaleTimeString();
    el.textContent += '\n[' + stamp + '] ' + msg;
    el.scrollTop = el.scrollHeight;
    if (kind === 'error') console.error(msg);
  }
  function show(sel, on) { $(sel).classList.toggle('hidden', !on); }
  function enc(s) { return new TextEncoder().encode(s); }
  function hex(buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function b64(bytes) { var s = ''; var u = new Uint8Array(bytes); for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
  function unb64(s) { var bin = atob(s.replace(/\s/g, '')); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function sha256(bytes) { return crypto.subtle.digest('SHA-256', bytes).then(hex); }

  /* ------------------------------------------------------------- GitHub API */
  function gh(path, opts) {
    opts = opts || {};
    return fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'Authorization': 'Bearer ' + S.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.message) ? j.message + ' (' + r.status + ')' : 'HTTP ' + r.status);
        return j;
      });
    });
  }

  /* --------------------------------------------------------- key management */
  var KeyStore = (function () {
    function open() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open('satseva-console', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction('keys', mode), req = fn(t.objectStore('keys'));
          t.oncomplete = function () { db.close(); res(req && req.result); };
          t.onerror = function () { db.close(); rej(t.error); };
        });
      });
    }
    return {
      put: function (k) { return tx('readwrite', function (s) { return s.put(k, 'release'); }); },
      get: function () { return tx('readonly', function (s) { return s.get('release'); }); },
      del: function () { return tx('readwrite', function (s) { return s.delete('release'); }); }
    };
  })();

  function pemToDer(pem) {
    var body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    if (!body) throw new Error('Empty PEM');
    return unb64(body);
  }
  function importKey(pem, remember) {
    var der;
    if (/BEGIN EC PRIVATE KEY/.test(pem)) throw new Error('This is a SEC1 EC key. Convert it with: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem');
    der = pemToDer(pem);
    return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
      .then(function (k) {
        S.key = k;
        if (remember) return KeyStore.put(k);
      }).then(keyFingerprint).then(function (fp) {
        $('#key-state').className = 'note calm';
        $('#key-state').innerHTML = 'Signing key loaded. Public key SHA-256:<br><code style="font-size:11px;word-break:break-all">' + fp + '</code>';
        log('Signing key imported (' + fp.slice(0, 16) + '…)');
      });
  }
  /* Derive the public key by signing and recovering is not possible with
   * WebCrypto, so we verify against the published feed instead: sign a probe
   * and check it against the public key the APK ships. */
  function keyFingerprint() {
    return gh('/repos/' + S.repo + '/contents/app/src/main/assets/update-public.der?ref=' + S.branch)
      .then(function (r) { return sha256(unb64(r.content)); })
      .catch(function () { return 'unavailable'; });
  }
  function verifyKeyMatches() {
    if (!S.key) return Promise.reject(new Error('Import the release signing key first (Signing key tab).'));
    var probe = enc('satseva-key-check');
    return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, S.key, probe)
      .then(function (sig) {
        return gh('/repos/' + S.repo + '/contents/app/src/main/assets/update-public.der?ref=' + S.branch)
          .then(function (r) {
            return crypto.subtle.importKey('spki', unb64(r.content), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
              .then(function (pub) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, probe); });
          });
      }).then(function (ok) {
        if (!ok) throw new Error('This private key does not match the public key inside the APK. Installed apps would reject the release.');
        return true;
      });
  }

  /* ---------------------------------------------------------------- connect */
  function connect() {
    S.token = $('#token').value.trim();
    S.repo = $('#repo').value.trim();
    S.branch = $('#branch').value.trim() || 'main';
    if (!S.token || !S.repo) { $('#connect-err').textContent = 'A repository and a token are required.'; show('#connect-err', true); return; }
    $('#do-connect').disabled = true;
    gh('/repos/' + S.repo).then(function (r) {
      if (!r.permissions || !r.permissions.push) throw new Error('This token cannot write to ' + S.repo);
      if ($('#remember').checked) sessionStorage.setItem('satseva-token', S.token);
      sessionStorage.setItem('satseva-repo', S.repo);
      $('#conn-state').textContent = S.repo;
      $('#conn-state').className = 'pill';
      show('#connect', false); show('#app', true); show('#signout', true);
      $('#actions-link').href = 'https://github.com/' + S.repo + '/actions';
      log('Connected to ' + S.repo + ' as an authorised publisher.');
      return KeyStore.get();
    }).then(function (k) {
      if (k) { S.key = k; return keyFingerprint().then(function (fp) { $('#key-state').className = 'note calm'; $('#key-state').innerHTML = 'Signing key restored from this browser. Public key SHA-256:<br><code style="font-size:11px;word-break:break-all">' + fp + '</code>'; }); }
    }).then(loadConfig).then(loadFeed).then(loadEvents).then(loadFiles).then(loadReleases)
      .catch(function (e) {
        $('#connect-err').textContent = e.message; show('#connect-err', true);
        log('Connect failed: ' + e.message, 'error');
      }).then(function () { $('#do-connect').disabled = false; });
  }

  function readRepoJson(path, fallback) {
    return gh('/repos/' + S.repo + '/contents/' + path + '?ref=' + S.branch)
      .then(function (r) { return { sha: r.sha, data: JSON.parse(new TextDecoder().decode(unb64(r.content))) }; })
      .catch(function () { return { sha: null, data: fallback }; });
  }

  function loadConfig() {
    return readRepoJson('release-config.json', {}).then(function (r) {
      S.config = r.data; S.configSha = r.sha;
      $('#ui-version').value = (parseInt(r.data.uiVersion, 10) || 1) + 1;
      $('#ui-min').value = r.data.uiMinVersion || 0;
      $('#apk-name').value = r.data.versionName || '1.0.0';
      $('#apk-code').value = (parseInt(r.data.versionCode, 10) || 1) + 1;
      $('#apk-min').value = r.data.minVersionCode || 1;
      $('#ntfy-topic').value = (r.data.push && r.data.push.ntfyTopic) || '';
    });
  }

  function loadFeed() {
    var url = 'https://raw.githubusercontent.com/' + S.repo + '/' + S.branch + '/docs/updates/stable.json?cb=' + Date.now();
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (f) {
        S.feed = f;
        var el = $('#feed-state');
        if (!f) { el.innerHTML = '<p class="sub">No feed published yet.</p>'; return; }
        var bytes = (f.ui.files || []).reduce(function (a, x) { return a + x.bytes; }, 0);
        el.innerHTML =
          kv('Channel', f.channel) +
          kv('Interface release', 'r' + f.ui.version) +
          kv('App version', f.app.versionName + ' (code ' + f.app.versionCode + ')') +
          kv('Minimum app code', f.app.minVersionCode) +
          kv('Forced interface minimum', f.ui.minVersion || 0) +
          kv('Files', f.ui.files.length + ' · ' + (bytes / 1024).toFixed(1) + ' KB total') +
          kv('Announcements', (f.content.events || []).length) +
          kv('Published', new Date(f.published).toLocaleString()) +
          kv('Universal URL', url.split('?')[0]);
      });
  }
  function kv(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + String(v) + '</b></div>'; }

  /* ------------------------------------------------------------ atomic commit */
  function commitFiles(files, message) {
    var headRef, baseCommit, baseTree;
    return gh('/repos/' + S.repo + '/git/ref/heads/' + S.branch)
      .then(function (r) { headRef = r.object.sha; return gh('/repos/' + S.repo + '/git/commits/' + headRef); })
      .then(function (c) { baseCommit = c; baseTree = c.tree.sha; return Promise.all(files.map(function (f) {
        return gh('/repos/' + S.repo + '/git/blobs', { method: 'POST', body: { content: b64(f.bytes), encoding: 'base64' } })
          .then(function (b) { return { path: f.path, mode: '100644', type: 'blob', sha: b.sha }; });
      })); })
      .then(function (entries) {
        return gh('/repos/' + S.repo + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
      })
      .then(function (t) {
        return gh('/repos/' + S.repo + '/git/commits', { method: 'POST', body: { message: message, tree: t.sha, parents: [headRef] } });
      })
      .then(function (c) {
        return gh('/repos/' + S.repo + '/git/refs/heads/' + S.branch, { method: 'PATCH', body: { sha: c.sha } }).then(function () { return c; });
      });
  }

  function repoTree() {
    return gh('/repos/' + S.repo + '/git/trees/' + S.branch + '?recursive=1').then(function (r) {
      if (r.truncated) throw new Error('Repository tree is truncated; publish from the CLI instead.');
      S.tree = r.tree; return r.tree;
    });
  }
  function readBlob(sha) {
    return gh('/repos/' + S.repo + '/git/blobs/' + sha).then(function (b) { return unb64(b.content); });
  }

  /* ---------------------------------------------------------- publish interface */
  function publishUi() {
    var btn = $('#publish-ui');
    btn.disabled = true;
    $('#release-state').className = 'pill warn'; $('#release-state').textContent = 'Working…'; show('#release-state', true);
    var manifest, payload, signature, webFiles = [];

    verifyKeyMatches().then(function () {
      log('Signing key matches the public key shipped in the APK.');
      return repoTree();
    }).then(function (tree) {
      var entries = tree.filter(function (t) { return t.type === 'blob' && t.path.indexOf('web/') === 0; });
      if (!entries.length) throw new Error('No files under web/');
      log('Hashing ' + entries.length + ' interface files…');
      return entries.reduce(function (chain, e) {
        return chain.then(function () {
          return readBlob(e.sha).then(function (bytes) {
            return sha256(bytes).then(function (digest) {
              webFiles.push({ path: e.path.slice(4), sha256: digest, bytes: bytes.length });
            });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return readRepoJson('content/events.json', []);
    }).then(function (ev) {
      var cfg = S.config || {};
      var lines = function (id, fallback) {
        var v = $(id).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        return v.length ? v : fallback;
      };
      manifest = {
        schema: 1,
        channel: cfg.channel || 'stable',
        published: Date.now(),
        app: {
          versionName: cfg.versionName || '1.0.0',
          versionCode: parseInt(cfg.versionCode, 10) || 1,
          minVersionCode: parseInt(cfg.minVersionCode, 10) || 1
        },
        ui: {
          version: parseInt($('#ui-version').value, 10),
          minAppVersionCode: parseInt($('#ui-min-app').value, 10) || 1,
          minVersion: parseInt($('#ui-min').value, 10) || 0,
          bases: cfg.uiBases || ['https://raw.githubusercontent.com/' + S.repo + '/' + S.branch + '/docs/updates/ui/'],
          files: webFiles.sort(function (a, b) { return a.path < b.path ? -1 : 1; }),
          remove: []
        },
        content: {
          events: ev.data || [],
          notes: {
            en: lines('#notes-en', ['Interface improvements and fixes.']),
            hi: lines('#notes-hi', ['इंटरफ़ेस में सुधार।']),
            pa: lines('#notes-pa', ['ਇੰਟਰਫੇਸ ਵਿੱਚ ਸੁਧਾਰ।'])
          }
        },
        push: cfg.push || { ntfyHost: 'https://ntfy.sh', ntfyTopic: '' }
      };
      if (S.feed && S.feed.app && S.feed.app.apk) manifest.app.apk = S.feed.app.apk;
      payload = enc(JSON.stringify(manifest, null, 2) + '\n');
      return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, S.key, payload);
    }).then(function (sig) {
      signature = sig;
      var files = [{ path: 'docs/updates/stable.json', bytes: payload },
                   { path: 'docs/updates/stable.json.sig', bytes: enc(b64(sig) + '\n') }];
      // Mirror the interface bytes next to the feed so Pages/jsDelivr can serve them.
      var entries = S.tree.filter(function (t) { return t.type === 'blob' && t.path.indexOf('web/') === 0; });
      return entries.reduce(function (chain, e) {
        return chain.then(function () {
          return readBlob(e.sha).then(function (bytes) { files.push({ path: 'docs/updates/ui/' + e.path.slice(4), bytes: bytes }); });
        });
      }, Promise.resolve()).then(function () {
        var cfg = Object.assign({}, S.config, {
          uiVersion: manifest.ui.version,
          uiMinVersion: manifest.ui.minVersion,
          uiMinAppVersionCode: manifest.ui.minAppVersionCode
        });
        files.push({ path: 'release-config.json', bytes: enc(JSON.stringify(cfg, null, 2) + '\n') });
        S.config = cfg;
        log('Committing ' + files.length + ' files as one atomic commit…');
        return commitFiles(files, 'release: interface r' + manifest.ui.version);
      });
    }).then(function (c) {
      log('Published interface r' + manifest.ui.version + ' — commit ' + c.sha.slice(0, 8));
      log('Devices will pick this up on their next check. Signature: ' + b64(signature).slice(0, 24) + '…');
      $('#release-state').className = 'pill'; $('#release-state').textContent = 'Published r' + manifest.ui.version;
      $('#ui-version').value = manifest.ui.version + 1;
      return loadFeed();
    }).catch(function (e) {
      log('Publish failed: ' + e.message, 'error');
      $('#release-state').className = 'pill bad'; $('#release-state').textContent = 'Failed';
      alert(e.message);
    }).then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------- announcements */
  function loadEvents() {
    return readRepoJson('content/events.json', []).then(function (r) {
      S.events = Array.isArray(r.data) ? r.data : [];
      renderEvents();
    });
  }
  function blankEvent() { return { id: 'ev-' + Date.now(), date: '', time: '', title: { en: '', hi: '', pa: '' }, place: { en: '', hi: '', pa: '' }, body: { en: '', hi: '', pa: '' }, tag: { en: 'Bhandara', hi: 'भंडारा', pa: 'ਭੰਡਾਰਾ' } }; }
  function renderEvents() {
    var host = $('#events'); host.innerHTML = '';
    if (!S.events.length) host.innerHTML = '<p class="sub">No announcements. The app shows an honest empty state.</p>';
    S.events.forEach(function (ev, i) {
      var d = document.createElement('div'); d.className = 'event';
      d.innerHTML =
        '<div class="row"><b style="font-size:13px">' + (ev.title && (ev.title.en || ev.title.hi) || 'Untitled') + '</b>' +
        '<button class="btn ghost small" data-del="' + i + '">Remove</button></div>' +
        '<div class="grid3" style="margin-top:10px">' +
        '<label class="f"><span>Date (confirmed only)</span><input type="date" data-k="date" value="' + (ev.date || '') + '"></label>' +
        '<label class="f"><span>Time</span><input type="time" data-k="time" value="' + (ev.time || '') + '"></label>' +
        '<label class="f"><span>Tag (EN)</span><input type="text" data-k="tag.en" value="' + esc(ev.tag && ev.tag.en || '') + '"></label>' +
        '</div>' +
        ['title', 'place', 'body'].map(function (k) {
          return '<div class="grid3">' + ['en', 'hi', 'pa'].map(function (l) {
            return '<label class="f"><span>' + k + ' · ' + l + '</span>' +
              (k === 'body' ? '<textarea data-k="' + k + '.' + l + '">' + esc(ev[k] && ev[k][l] || '') + '</textarea>'
                : '<input type="text" data-k="' + k + '.' + l + '" value="' + esc(ev[k] && ev[k][l] || '') + '">') + '</label>';
          }).join('') + '</div>';
        }).join('');
      d.addEventListener('input', function (e) {
        var k = e.target.getAttribute('data-k'); if (!k) return;
        var parts = k.split('.');
        if (parts.length === 1) ev[parts[0]] = e.target.value;
        else { ev[parts[0]] = ev[parts[0]] || {}; ev[parts[0]][parts[1]] = e.target.value; }
      });
      d.querySelector('[data-del]').addEventListener('click', function () { S.events.splice(i, 1); renderEvents(); });
      host.appendChild(d);
    });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function saveEvents() {
    var bad = S.events.filter(function (e) { return !e.date || !(e.title && (e.title.en || e.title.hi)); });
    if (bad.length) { alert('Every announcement needs a confirmed date and a title.'); return; }
    commitFiles([{ path: 'content/events.json', bytes: enc(JSON.stringify(S.events, null, 2) + '\n') }],
      'content: update Bhandara announcements')
      .then(function (c) { log('Announcements saved (' + c.sha.slice(0, 8) + '). Publish an interface release to deliver them.'); alert('Saved. Now publish an interface release to deliver them.'); })
      .catch(function (e) { alert(e.message); });
  }

  /* ------------------------------------------------------------------ android */
  function dispatchBuild() {
    var body = {
      ref: S.branch,
      inputs: {
        version_name: $('#apk-name').value.trim(),
        version_code: String(parseInt($('#apk-code').value, 10)),
        min_version_code: String(parseInt($('#apk-min').value, 10))
      }
    };
    gh('/repos/' + S.repo + '/actions/workflows/android-release.yml/dispatches', { method: 'POST', body: body })
      .then(function () { log('Android build dispatched. Watch it at https://github.com/' + S.repo + '/actions'); alert('Build dispatched. Wait for the run to finish, then reload releases.'); })
      .catch(function (e) { alert(e.message + '\n\nThe workflow must exist on the default branch before it can be dispatched.'); });
  }
  function loadReleases() {
    return gh('/repos/' + S.repo + '/releases?per_page=8').then(function (rs) {
      var el = $('#releases');
      if (!rs.length) { el.innerHTML = '<p class="sub">No releases yet.</p>'; return; }
      el.innerHTML = '<table><thead><tr><th>Tag</th><th>Asset</th><th>Size</th><th>Downloads</th><th></th></tr></thead><tbody>' +
        rs.map(function (r) {
          var a = (r.assets || [])[0];
          return '<tr><td><b>' + esc(r.tag_name) + '</b></td><td>' + (a ? esc(a.name) : '—') + '</td>' +
            '<td class="mono">' + (a ? (a.size / 1024).toFixed(0) + ' KB' : '—') + '</td>' +
            '<td class="mono">' + (a ? a.download_count : '—') + '</td>' +
            '<td><a class="btn ghost small" href="' + r.html_url + '" target="_blank" rel="noopener">Open</a></td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (e) { $('#releases').innerHTML = '<p class="sub">' + esc(e.message) + '</p>'; });
  }

  /* --------------------------------------------------------------------- push */
  function sendPush() {
    var topic = $('#ntfy-topic').value.trim();
    if (!topic) { alert('Set a topic first.'); return; }
    var host = (S.config && S.config.push && S.config.push.ntfyHost) || 'https://ntfy.sh';
    fetch(host + '/' + topic, {
      method: 'POST',
      headers: { 'Title': $('#push-title').value || 'SatSeva', 'Priority': $('#push-priority').value, 'Tags': 'pray' },
      body: $('#push-body').value
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function () { log('Alert sent to topic ' + topic); alert('Alert sent. Devices see it while open, or on their next background check.'); })
      .catch(function (e) { alert('Could not send: ' + e.message); });
  }
  function saveTopic() {
    var cfg = Object.assign({}, S.config);
    cfg.push = Object.assign({ ntfyHost: 'https://ntfy.sh' }, cfg.push, { ntfyTopic: $('#ntfy-topic').value.trim() });
    commitFiles([{ path: 'release-config.json', bytes: enc(JSON.stringify(cfg, null, 2) + '\n') }], 'config: set push topic')
      .then(function () { S.config = cfg; log('Push topic saved to config. Publish an interface release so devices receive it.'); alert('Saved. Publish an interface release to deliver the topic to devices.'); })
      .catch(function (e) { alert(e.message); });
  }

  /* --------------------------------------------------------------- file editor */
  function loadFiles() {
    return repoTree().then(function (tree) {
      var sel = $('#file-pick'); sel.innerHTML = '';
      tree.filter(function (t) { return t.type === 'blob' && /^(web|content)\//.test(t.path); }).forEach(function (t) {
        var o = document.createElement('option'); o.value = t.path; o.textContent = t.path; o.setAttribute('data-sha', t.sha); sel.appendChild(o);
      });
    });
  }
  function loadFile() {
    var path = $('#file-pick').value; if (!path) return;
    gh('/repos/' + S.repo + '/contents/' + path + '?ref=' + S.branch).then(function (r) {
      $('#file-body').value = new TextDecoder().decode(unb64(r.content));
      $('#file-label').textContent = path;
      log('Loaded ' + path);
    }).catch(function (e) { alert(e.message); });
  }
  function commitFile() {
    var path = $('#file-pick').value; if (!path) return;
    if (!confirm('Commit changes to ' + path + '?')) return;
    commitFiles([{ path: path, bytes: enc($('#file-body').value) }], 'edit: ' + path)
      .then(function (c) { log('Committed ' + path + ' (' + c.sha.slice(0, 8) + '). Publish a release to deliver it.'); alert('Committed. Publish an interface release to deliver it.'); })
      .catch(function (e) { alert(e.message); });
  }

  /* -------------------------------------------------------------------- wire */
  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      $$('[data-panel]').forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-panel') !== b.getAttribute('data-tab')); });
    });
  });
  $('#do-connect').addEventListener('click', connect);
  $('#token').addEventListener('keydown', function (e) { if (e.key === 'Enter') connect(); });
  $('#signout').addEventListener('click', function () { sessionStorage.clear(); location.reload(); });
  $('#publish-ui').addEventListener('click', publishUi);
  $('#reload-feed').addEventListener('click', loadFeed);
  $('#add-event').addEventListener('click', function () { S.events.push(blankEvent()); renderEvents(); });
  $('#save-events').addEventListener('click', saveEvents);
  $('#build-apk').addEventListener('click', dispatchBuild);
  $('#send-push').addEventListener('click', sendPush);
  $('#save-topic').addEventListener('click', saveTopic);
  $('#gen-topic').addEventListener('click', function () {
    var a = new Uint8Array(9); crypto.getRandomValues(a);
    $('#ntfy-topic').value = 'satseva-' + Array.from(a).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  });
  $('#load-file').addEventListener('click', loadFile);
  $('#commit-file').addEventListener('click', commitFile);
  $('#import-key').addEventListener('click', function () {
    importKey($('#key-pem').value, $('#key-remember').checked)
      .then(function () { $('#key-pem').value = ''; })
      .catch(function (e) { $('#key-state').className = 'note bad'; $('#key-state').textContent = e.message; });
  });
  $('#forget-key').addEventListener('click', function () {
    KeyStore.del().then(function () { S.key = null; $('#key-state').className = 'note'; $('#key-state').textContent = 'No signing key loaded.'; });
  });

  var saved = sessionStorage.getItem('satseva-token');
  if (saved) {
    $('#token').value = saved;
    $('#repo').value = sessionStorage.getItem('satseva-repo') || $('#repo').value;
    $('#remember').checked = true;
  }
})();
