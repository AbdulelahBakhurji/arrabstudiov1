import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '..');
const app = path.resolve(bundle, '../../../apps/desktop');
const require = createRequire(path.join(app, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const out = path.join(here, '.build');
await build({configFile: path.join(app, 'vite.config.ts'), root: app, publicDir: false,
  define: {'import.meta.env.VITE_ARRAB_API_URL': JSON.stringify('https://design-preview.invalid'),
    'process.env.NODE_ENV': JSON.stringify('production')},
  build: {outDir: out, emptyOutDir: true, assetsInlineLimit: 10000000, cssCodeSplit: false,
    lib: {entry: path.join(app, 'src/main.tsx'), name: 'ArrabDesign', formats: ['iife'], fileName: () => 'app.js'},
    rollupOptions: {output: {inlineDynamicImports: true}}}});
const files = await readdir(out);
const css = (await Promise.all(files.filter(x => x.endsWith('.css')).map(x => readFile(path.join(out, x), 'utf8')))).join('\n');
const js = await readFile(path.join(out, 'app.js'), 'utf8');
const adapter = await readFile(path.join(here, 'offline-preview.js'), 'utf8');
const routes = [
  ['الأفراد', [
    ['المحادثة والرفاق', '/individuals'], ['اللوحة', '/individuals/board'], ['المهام والمواضيع', '/individuals/work'],
    ['أنا والذاكرة', '/individuals/me'], ['الاتصالات', '/individuals/connectors'], ['الحساب', '/individuals/account'], ['الإعدادات', '/individuals/settings']]],
  ['المنظمات', [
    ['الاستوديو', '/organizations'], ['المحادثة', '/organizations/chat'], ['العمل المشترك', '/organizations/cowork'],
    ['القوى العاملة', '/organizations/workforce'], ['مكتب الموظف', '/organizations/desk/design-agent'],
    ['الاتصالات', '/organizations/connectors'], ['النشاط', '/organizations/activity'], ['الحساب', '/organizations/account'], ['الإعدادات', '/organizations/settings']]],
  ['الدخول', [['تسجيل الدخول', 'sign-in']]],
];
await writeFile(path.join(bundle, 'screens.json'), JSON.stringify(routes, null, 2) + '\n');
const guide = routes.map(([group, links]) => `<section><h3>${group}</h3><div>${links.map(([label, route]) => `<button data-design-route="${route}">${label}</button>`).join('')}</div></section>`).join('');
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arrab — التصميم المحسّن</title>
<style>${css}</style><style>
#design-guide-open{position:fixed;bottom:5px;left:7px;z-index:9999;font:11px system-ui;background:#fff;color:#514768;border:1px solid #d9d2e5;border-radius:20px;padding:5px 12px;box-shadow:0 2px 10px #0001;cursor:pointer}
#design-guide{direction:rtl;width:min(660px,92vw);max-height:86vh;overflow:auto;border:1px solid #ddd5e8;border-radius:22px;padding:25px;background:#faf9fd;color:#242030;margin:auto;font:14px/1.8 system-ui}
#design-guide::backdrop{background:#17112277;backdrop-filter:blur(5px)}
#design-guide h2{font-size:21px;font-weight:650;margin:0 0 5px}#design-guide p{color:#736680;margin-bottom:20px}#design-guide h3{font-size:13px;margin:16px 0 8px;font-weight:650}
#design-guide section div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#design-guide button{cursor:pointer;border:1px solid #ddd5e8;border-radius:10px;padding:9px 12px;background:white;text-align:right;color:#332942}
#design-guide button:hover{background:#eee7fb}#design-guide-close{float:left}#design-guide :focus-visible,#design-guide-open:focus-visible{outline:2px solid #8971bf;outline-offset:3px}
</style></head><body><div id="root"></div><button id="design-guide-open">شاشات التصميم · معاينة</button><dialog id="design-guide"><button id="design-guide-close" aria-label="إغلاق">×</button><h2>التصميم المحسّن — البرنامج كاملًا</h2><p>نسخة محسّنة تحفظ المسودات وتختصر خطوات المهام وتحسّن القراءة. تصفّح الشاشات وجرّب القوائم والنوافذ واللغة والثيم. البيانات توضيحية، والتغييرات مؤقتة حتى إعادة تحميل الملف. خدمات الذكاء الاصطناعي والاتصالات والدفع لا تتصل بالخارج في هذه المعاينة.</p>${guide}</dialog>
<script>${adapter.replace(/<\/script/gi, '<\\/script')}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
await writeFile(path.join(bundle, 'Arrab-Design.html'), html);
await rm(out, {recursive: true, force: true});
console.log('Created standalone Arrab-Design.html (' + html.length + ' characters)');
