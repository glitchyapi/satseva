/* Headless device-viewport smoke test + screenshots.
 * Exercises the real UI: boot, add seva, filter, banner render, language switch,
 * storage figures and the update sheet. Fails loudly on any console error. */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, '..', 'artifacts', 'screens');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));

  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('  shot', name); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await wait(1600);
  await shot('01-today');

  // add a seva through the real form
  await page.click('.nav-fab');
  await wait(500);
  await page.type('#sheet-content input[type=text]', 'भंडारे के लिए रोटियाँ बनाईं');
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('.cat-option')];
    opts.find(o => o.textContent.includes('भंडारा') || o.textContent.includes('Bhandara')).click();
  });
  await shot('02-add-seva');
  await page.evaluate(() => {
    [...document.querySelectorAll('#sheet-content .primary')].find(b => b.textContent.trim().length).click();
  });
  await wait(700);
  const added = await page.evaluate(() => document.querySelectorAll('.entry').length);
  console.log('  entries visible after save:', added);
  await shot('03-today-after-save');

  // journal + filter
  await page.evaluate(() => [...document.querySelectorAll('.nav-button')][1].click());
  await wait(600);
  await shot('04-journal');
  await page.evaluate(() => document.querySelectorAll('.chip')[3].click());
  await wait(400);
  await shot('05-journal-filtered');

  // entry detail
  await page.evaluate(() => { const e = document.querySelector('.entry'); if (e) e.click(); });
  await wait(500);
  await shot('06-entry-detail');
  await page.evaluate(() => document.querySelector('#sheet .sheet-head button').click());
  await wait(300);

  // bhandara + banner studio
  await page.evaluate(() => [...document.querySelectorAll('.nav-button')][2].click());
  await wait(600);
  await shot('07-bhandara');
  await page.evaluate(() => {
    [...document.querySelectorAll('.primary')].find(b => /बैनर|banner/i.test(b.textContent)).click();
  });
  await wait(1200);
  await shot('08-banner-studio');
  const posterInk = await page.evaluate(() => {
    const c = document.querySelector('canvas'); if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] !== d[0] || d[i + 1] !== d[1]) n++;
    return n;
  });
  console.log('  poster non-uniform samples:', posterInk);
  await page.evaluate(() => document.querySelector('#sheet .sheet-head button').click());
  await wait(300);

  // settings, storage, language
  await page.evaluate(() => [...document.querySelectorAll('.nav-button')][3].click());
  await wait(600);
  await shot('09-more');
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-row')].find(r => /संग्रह|Storage/i.test(r.textContent)).click();
  });
  await wait(700);
  await shot('10-storage');
  const meters = await page.$$eval('.meter-head', els => els.map(e => e.textContent));
  console.log('  storage meters:', JSON.stringify(meters));
  await page.evaluate(() => document.querySelector('#sheet .sheet-head button').click());
  await wait(300);

  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-row')].find(r => /भाषा|Language/i.test(r.textContent)).click();
  });
  await wait(500);
  await shot('11-language');
  await page.evaluate(() => {
    [...document.querySelectorAll('.lang-option')].find(o => /English/.test(o.textContent)).click();
  });
  await wait(700);
  await shot('12-more-english');

  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-row')].find(r => /App version|ऐप संस्करण/i.test(r.textContent)).click();
  });
  await wait(700);
  await shot('13-version');
  await page.evaluate(() => document.querySelector('#sheet .sheet-head button').click());
  await wait(300);

  // Punjabi rendering
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-row')].find(r => /Language|भाषा/i.test(r.textContent)).click();
  });
  await wait(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('.lang-option')].find(o => /ਪੰਜਾਬੀ/.test(o.textContent)).click();
  });
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll('.nav-button')][0].click());
  await wait(700);
  await shot('14-today-punjabi');

  // desktop presentation
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await wait(700);
  await shot('15-desktop');

  // persistence across reload
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  const persisted = await page.evaluate(() => document.querySelectorAll('.entry').length);
  console.log('  entries after reload:', persisted);

  await browser.close();
  if (errors.length) { console.error('\nERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nSMOKE TEST PASSED — no console errors, no failed requests.');
})().catch(e => { console.error(e); process.exit(1); });
