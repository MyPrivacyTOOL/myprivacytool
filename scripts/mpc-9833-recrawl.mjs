import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
const want = 'does not run a scan or send a report';
let ok = false;
for (let i = 0; i < 40 && !ok; i++) {
  await p.goto('https://www.myprivacytool.io/start?cb=' + Date.now(), { waitUntil: 'networkidle' });
  ok = (await p.locator('body').innerText()).includes(want);
  if (!ok) await new Promise((r) => setTimeout(r, 30000));
}
console.log('DEPLOYED_ON_START', ok, new Date().toISOString());
const show = async (u, label) => { await p.goto(u, { waitUntil: 'networkidle' }); const t = await p.locator('body').innerText(); console.log('\n=== ' + label + ' ===\n' + t.split('\n').filter((l) => /report|48|list|scan|minute|confirm/i.test(l)).slice(0, 14).join('\n')); };
await show('https://www.myprivacytool.io/start', '/start');
await p.getByRole('button', { name: /join the list/i }).click();
console.log('\n=== /start after Join the list ===\n' + (await p.locator('body').innerText()).split('\n').filter((l) => /report|enter your email/i.test(l)).join('\n'));
await show('https://www.myprivacytool.io/thank-you?source=start', '/thank-you?source=start');
await show('https://www.myprivacytool.io/business', '/business');
await b.close();
process.exit(ok ? 0 : 1);
