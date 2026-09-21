import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const sharp = require('sharp');

// Illustrative, static vector overview of the improved design. This does not
// render, execute, or capture the application, and contains no external assets.
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview');
const c = { bg: '#e8e9f0', card: '#f8f9fd', subtle: '#edeef5', line: '#d9dae5', text: '#17171f', muted: '#625f70', faint: '#656272', lavender: '#c9bcff', soft: '#e5dffd', focus: '#756096' };
const elements = [];
const add = value => elements.push(value);
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rect = (x,y,w,h,r,fill,stroke='none',sw=1) => add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
const circle = (x,y,r,fill,stroke='none',sw=1) => add(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
const text = (value,x,y,size=15,color=c.text,anchor='end',weight=400) => add(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(value)}</text>`);
const icon = (type,x,y,size=24,color=c.text) => {
 const paths = {
  chat: '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tasks:'<path d="m3 6 2 2 4-4M12 6h9M3 13l2 2 4-4M12 13h9M4 20h3M12 20h9"/>',
  person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  star:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/><path d="M21 2v4M19 4h4"/>',
  arrow:'<path d="M6 18 18 6M7 6h11v11"/>',
  up:'<path d="M12 20V4m-7 7 7-7 7 7"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  moon:'<path d="M20 15A8.5 8.5 0 0 1 9 4a8.5 8.5 0 1 0 11 11Z"/>',
  check:'<path d="m5 12 4 4 10-10"/>',
  chevron:'<path d="m7 10 5 5 5-5"/>',
 };
 add(`<g transform="translate(${x-size/2} ${y-size/2}) scale(${size/24})" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[type]}</g>`);
};
rect(0,0,1400,990,0,c.bg);
// Header and familiar quiet controls.
circle(64,44,22,c.card); text('A',64,52,26,c.text,'middle',800); text('Arrab Studio',102,51,21,c.text,'start',600);
rect(1013,26,220,38,19,c.subtle,c.line);rect(1113,29,116,32,16,c.text);text('الأفراد',1171,51,14,'#fff','middle');text('المنظمات',1065,51,14,c.muted,'middle');
circle(1270,45,20,c.subtle,c.line);text('ع',1270,51,18,c.muted,'middle');circle(1322,45,20,c.subtle,c.line);icon('moon',1322,45,20);circle(1370,45,20,c.subtle,c.line);text('م',1370,51,16,c.text,'middle');
// Original rounded vertical navigation rail.
rect(1292,95,84,839,42,c.card,c.line);
for (const [i,label,type] of [[0,'المحادثة','chat'],[1,'اللوحة','grid'],[2,'المهام','tasks'],[3,'أنا','person']]) {
 const y=140+i*106; circle(1334,y,23,i===0?c.text:c.card,i===0?c.text:c.line);icon(type,1334,y,23,i===0?'#fff':c.muted);text(label,1334,y+46,13,i===0?c.text:c.muted,'middle',i===0?600:400);
}
text('ARRAB / COMPANIONS',1252,118,12,c.faint,'end');text('المحادثة',1252,159,32,c.text,'end',600);
rect(40,112,242,44,22,c.subtle,c.line);rect(161,116,117,36,18,c.card);text('الشخصي',219,140,15,c.text,'middle',500);text('المهني',101,140,15,c.muted,'middle');
// Companion selection, matching the reference's simple purple face.
circle(1206,225,34,c.lavender,c.focus,2);icon('star',1206,225,31);text('عام',1206,279,15,c.text,'middle',500);text('مساحة لكل شيء',1206,300,12,c.faint,'middle');
add(`<circle cx="1098" cy="225" r="33" fill="none" stroke="${c.faint}" stroke-dasharray="3 4"/>`);icon('plus',1098,225,25,c.muted);text('إضافة',1098,279,15,c.text,'middle');text('رفيق جديد',1098,300,12,c.faint,'middle');
rect(40,219,145,42,21,c.bg,c.line);text('كل الرفاق',106,246,14,c.text,'middle');text('•••',162,245,15,c.muted,'middle');
// Main conversation room.
rect(40,329,1216,605,25,c.card);add(`<path d="M40 407H1256" stroke="${c.line}"/>`);
circle(1204,368,20,c.subtle,c.line);icon('star',1204,368,21);text('عام',1166,375,17,c.text,'end',600);
rect(63,348,193,41,21,c.card,c.line);text('الذاكرة والأسلوب',173,375,14,c.text,'middle');icon('arrow',85,368,16,c.muted);
circle(649,487,40,c.soft);icon('star',649,487,39);text('مساحتك، على راحتك',649,561,13,c.faint,'middle');text('وش في بالك اليوم؟',649,606,34,c.text,'middle',500);text('ابدأ بفكرة، سؤال، أو حتى يوم طويل.',649,643,17,c.muted,'middle');
rect(474,675,179,48,14,c.card,c.line);text('كان يوماً طويلاً',571,705,14,c.muted,'middle');icon('arrow',492,699,15,c.muted);
rect(665,675,202,48,14,c.card,c.line);text('لخّص لي هذا النص',771,705,14,c.muted,'middle');icon('arrow',685,699,15,c.muted);
// More readable controls and a saved unsent draft, without changing the room.
rect(1058,757,166,38,19,c.card,c.line);text('أريد أن أفضفض فقط',1141,782,13,c.muted,'middle');rect(943,757,103,38,19,c.card,c.line);text('أريد رأيك',994,782,13,c.muted,'middle');text('عام سيردّ عليك',77,782,13,c.faint,'start');
rect(76,809,1148,70,24,c.subtle,c.line);
circle(1168,844,20,c.card,c.line);icon('star',1168,844,22);icon('chevron',1134,844,15,c.muted);text('اكتب اللي في بالك…',1101,850,17,c.faint,'end');
circle(110,844,23,'#96949d');icon('up',110,844,23,'#fff');
text('على راحتك.',1215,907,12,c.faint,'end');text('Enter للإرسال · Shift + Enter لسطر جديد',80,907,12,c.faint,'start');
// Explicit artifact provenance, separate from product UI.
text('تصوّر ثابت للواجهة المحسّنة — معاينة توضيحية وليست لقطة من التطبيق',1256,970,13,c.muted,'end');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="990" viewBox="0 0 1400 990" role="img" aria-label="تصوّر ثابت للواجهة المحسّنة"><title>Arrab Studio — illustrative improved interface</title><style>text { font-family: 'SF Arabic', Tahoma, Arial, sans-serif; }</style>${elements.join('\n')}</svg>`;
await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'arrab-improved.svg'),svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(output,'arrab-improved.png'));
console.log('Created illustrative static SVG and PNG:',output);
