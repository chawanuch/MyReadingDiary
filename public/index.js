'use strict';

const STORAGE_KEY = 'my-reading-diary:p01:v1';
const MAX_BOOKS = 500;
const labels = { want: 'อยากอ่าน', reading: 'กำลังอ่าน', done: 'อ่านจบแล้ว' };
const $ = (id) => document.getElementById(id);
let books = [];
let filter = 'all';
let pendingDelete = null;

const THEME_KEY = 'my-reading-diary:p01:theme';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let preferredTheme = null;
try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') preferredTheme = savedTheme;
} catch {
  // Theme switching remains available when browser storage is blocked.
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101c2d' : '#f4f9ff';
}

function syncTheme() {
  applyTheme(preferredTheme || (systemTheme.matches ? 'dark' : 'light'));
}

$('theme-toggle').addEventListener('click', () => {
  preferredTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(preferredTheme);
  try {
    localStorage.setItem(THEME_KEY, preferredTheme);
    $('theme-toggle').title = 'เปิดหรือปิดโหมดกลางคืน';
  } catch {
    $('theme-toggle').title = 'เปลี่ยนโหมดแล้ว แต่เบราว์เซอร์ไม่อนุญาตให้จำการตั้งค่า';
  }
});
systemTheme.addEventListener('change', syncTheme);
window.addEventListener('storage', (event) => {
  if (event.key !== THEME_KEY && event.key !== null) return;
  preferredTheme = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
  syncTheme();
});
syncTheme();

function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function newId() {
  // getRandomValues also works on HTTP LAN origins, unlike randomUUID.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validBook(book) {
  return book && typeof book === 'object' &&
    validDate(book.date) &&
    typeof book.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(book.id) &&
    typeof book.title === 'string' && book.title.trim().length > 0 && book.title.length <= 200 &&
    typeof book.author === 'string' && book.author.length <= 160 &&
    typeof book.notes === 'string' && book.notes.length <= 5000 &&
    Object.hasOwn(labels, book.status) &&
    Number.isInteger(book.pages) && book.pages >= 1 && book.pages <= 100000 &&
    Number.isInteger(book.current) && book.current >= 0 && book.current <= book.pages &&
    (book.status !== 'done' || book.current === book.pages);
}

function starterBooks() {
  const examples = [
    ['เจ้าชายน้อย (The Little Prince)', 'Antoine de Saint-Exupéry', 120, 'การเดินทางของเจ้าชายน้อย ชวนคิดเรื่องมิตรภาพ ความรัก และคุณค่าของสิ่งสำคัญ'],
    ['โต๊ะโตะจัง เด็กหญิงข้างหน้าต่าง', 'Tetsuko Kuroyanagi', 240, 'เรื่องราววัยเด็กในโรงเรียนที่เข้าใจความแตกต่างและเปิดโอกาสให้เด็กเป็นตัวเอง'],
    ['The Secret Garden (สวนปริศนา)', 'Frances Hodgson Burnett', 320, 'เด็กหญิงและเพื่อนร่วมฟื้นฟูสวนที่ถูกปิดตาย พร้อมเรียนรู้พลังของธรรมชาติและมิตรภาพ'],
    ['Around the World in Eighty Days (รอบโลกในแปดสิบวัน)', 'Jules Verne', 300, 'การผจญภัยรอบโลกภายใต้เวลาจำกัด เต็มไปด้วยการแก้ปัญหาและการพบวัฒนธรรมใหม่']
  ];
  return examples.map(([title, author, pages, summary], index) => ({
    id: `starter-${index + 1}`,
    title, author, pages,
    current: 0,
    status: 'want',
    date: localDate(),
    notes: `รายการตัวอย่างสำหรับหนังสือที่อยากอ่าน: ${summary} ยังไม่ได้เริ่มอ่าน จำนวน ${pages} หน้าเป็นค่าตัวอย่าง โปรดปรับตามฉบับจริง วันที่เป็นวันที่เพิ่มตัวอย่าง ไม่ใช่ประวัติการอ่านจริง`
  }));
}

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  // Seed only a new browser; an intentionally emptied diary must stay empty.
  if (raw === null) {
    books = starterBooks();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    } catch {
      notify('แสดงหนังสือตัวอย่างชั่วคราว แต่ยังบันทึกไม่ได้ กรุณาตรวจสิทธิ์หรือพื้นที่จัดเก็บของเบราว์เซอร์');
    }
  } else {
    if (raw.length > 4000000) throw new Error('Storage limit');
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length > MAX_BOOKS) throw new Error('Invalid storage');
    // Older records have no date; preserve them without inventing a reading date.
    const migrated = saved.map((book) => book && typeof book === 'object' && !Object.hasOwn(book, 'date') ? { ...book, date: null } : book);
    if (!migrated.every((book) => book && (book.date === null ? validBook({ ...book, date: '2000-01-01' }) : validBook(book))) ||
        new Set(migrated.map((book) => book.id)).size !== migrated.length) throw new Error('Invalid storage');
    books = migrated;
  }
} catch {
  notify('ไม่สามารถอ่านข้อมูลเดิมได้ ข้อมูลเดิมยังไม่ถูกลบ กรุณาสำรองข้อมูลก่อนบันทึกรายการใหม่');
  // Do not overwrite unreadable data when the next form is submitted.
  $('book-form').dataset.storageBlocked = 'true';
}

function persist(next) {
  if ($('book-form').dataset.storageBlocked) {
    notify('ยังบันทึกไม่ได้ เนื่องจากข้อมูลเดิมอ่านไม่ได้ กรุณาสำรองข้อมูลและแก้ไขพื้นที่จัดเก็บก่อน');
    return false;
  }
  try {
    const serialized = JSON.stringify(next);
    if (serialized.length > 4000000) throw new Error('Storage limit');
    localStorage.setItem(STORAGE_KEY, serialized);
    books = next;
    notify('');
    render();
    return true;
  } catch {
    notify('บันทึกไม่สำเร็จ พื้นที่อาจเต็มหรือเบราว์เซอร์ไม่อนุญาต ข้อมูลที่บันทึกไว้ก่อนหน้านี้ยังอยู่');
    return false;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const recommendations = [
  { title: 'Anne of Green Gables (แอนน์แห่งกรีนเกเบิลส์)', author: 'L. M. Montgomery', cover: 'anne', genre: 'COMING OF AGE / เติบโตด้วยจินตนาการ', tagline: 'โลกสดใส เมื่อมองผ่านจินตนาการ', summary: 'แอนน์ เด็กหญิงกำพร้าผู้เปี่ยมจินตนาการ ได้เริ่มชีวิตใหม่ที่กรีนเกเบิลส์ พร้อมเรียนรู้มิตรภาพ ครอบครัว และการยอมรับตัวเอง', alt: 'ภาพปกออกแบบใหม่สำหรับ Anne of Green Gables' },
  { title: 'Heidi (ไฮดี้)', author: 'Johanna Spyri', cover: 'heidi', genre: 'CLASSIC / อ้อมกอดแห่งขุนเขา', tagline: 'ความสุขเล็ก ๆ บนภูเขาลูกใหญ่', summary: 'ไฮดี้ไปอาศัยกับคุณปู่บนเทือกเขาแอลป์ ความสดใสและน้ำใจของเธอค่อย ๆ เชื่อมความสัมพันธ์ของผู้คนรอบตัว ผ่านธรรมชาติและมิตรภาพ', alt: 'ภาพปกออกแบบใหม่สำหรับ Heidi' },
  { title: 'Peter Pan (ปีเตอร์แพน)', author: 'J. M. Barrie', cover: 'peter-pan', genre: 'FANTASY / ดินแดนแห่งวัยเยาว์', tagline: 'โบยบินไปกับความฝันที่ไม่ยอมโต', summary: 'เวนดี้และน้อง ๆ ออกเดินทางกับปีเตอร์แพนสู่เนเวอร์แลนด์ พบเหล่าเด็กหลงทางและกัปตันฮุก ในการผจญภัยที่ชวนคิดถึงวัยเด็กและการเติบโต', alt: 'ภาพปกออกแบบใหม่สำหรับ Peter Pan' },
  { title: 'The Wonderful Wizard of Oz (พ่อมดมหัศจรรย์แห่งออซ)', author: 'L. Frank Baum', cover: 'wizard-oz', genre: 'ADVENTURE / เส้นทางสู่บ้าน', tagline: 'สิ่งที่ตามหา อาจอยู่ในตัวเรา', summary: 'โดโรธีและโตโต้ออกเดินทางบนถนนอิฐสีเหลืองไปหาพ่อมดแห่งออซ พร้อมเพื่อนใหม่ที่ต่างค้นหาปัญญา หัวใจ และความกล้าหาญ', alt: 'ภาพปกออกแบบใหม่สำหรับ The Wonderful Wizard of Oz' },
  { title: 'Alice in Wonderland (อลิซในแดนมหัศจรรย์)', author: 'Lewis Carroll', cover: 'alice', genre: 'FANTASY / โลกจินตนาการ', tagline: 'หลงทางบ้าง ก็อาจเจอโลกใหม่', summary: 'ตามกระต่ายขาวสู่ดินแดนที่ทุกอย่างเป็นไปได้ การผจญภัยเปี่ยมจินตนาการที่ชวนมองโลกด้วยความสงสัยใคร่รู้', alt: 'ภาพปกออกแบบใหม่ รูปกระต่ายสีชมพูบนพื้นสีน้ำเงิน' },
  { title: 'Pride and Prejudice (ทรนงกับอคติ)', author: 'Jane Austen', cover: 'pride-prejudice', genre: 'ROMANCE / รักเหนืออคติ', tagline: 'เมื่อหัวใจ อ่านระหว่างบรรทัด', summary: 'เรื่องราวของเอลิซาเบธ เบนเน็ตกับมิสเตอร์ดาร์ซี ที่ชวนสำรวจความรัก ชนชั้น และการตัดสินคนจากความประทับใจแรก', alt: 'ภาพปกออกแบบใหม่ ลายดอกไม้สีทองบนพื้นสีไวน์แดง' },
  { title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', cover: 'sherlock', genre: 'MYSTERY / ไขปริศนา', tagline: 'ทุกรายละเอียด มีเรื่องซ่อนอยู่', summary: 'รวมคดีสืบสวนของเชอร์ล็อก โฮล์มส์และหมอวัตสัน ฝึกมองเบาะแสเล็ก ๆ ผ่านการสังเกตและเหตุผลอันเฉียบคม', alt: 'ภาพปกออกแบบใหม่ แว่นขยายสีทองบนพื้นสีเขียวเข้ม' },
  { title: 'Little Women (สี่ดรุณี)', author: 'Louisa May Alcott', cover: 'little-women', genre: 'COMING OF AGE / เติบโตไปด้วยกัน', tagline: 'ความฝันเติบโต ในบ้านหลังเล็ก', summary: 'ติดตามสี่พี่น้องตระกูลมาร์ชผ่านความฝัน ความผูกพัน และการเลือกเส้นทางของตัวเอง เรื่องอบอุ่นของการเติบโตและครอบครัว', alt: 'ภาพปกออกแบบใหม่ บ้านหลังเล็กสีครีมบนพื้นสีอิฐ' }
];

function renderRecommendations() {
  $('recommendations').replaceChildren(...recommendations.map((book, index) => {
    const article = element('article', 'discovery-card');
    article.style.setProperty('--order', index);
    const art = element('div', 'discovery-art');
    const image = element('img');
    image.src = `/images/${book.cover}.png`;
    image.alt = book.alt;
    image.width = 800;
    image.height = 1000;
    image.loading = 'lazy';
    image.decoding = 'async';
    art.append(element('span', 'discovery-number', `0${index + 1}`), image);
    const copy = element('div', 'discovery-copy');
    const button = element('button', 'discovery-button', 'เลือกเล่มนี้ +');
    button.type = 'button';
    button.setAttribute('aria-label', `เลือก ${book.title} ลงบันทึก`);
    button.addEventListener('click', () => openForm({
      id: '', title: book.title, author: book.author, pages: '', current: 0,
      date: localDate(), status: 'want',
      notes: `เรื่องย่อแนะนำ (ยังไม่ใช่บันทึกการอ่านของฉัน): ${book.summary}`
    }));
    copy.append(element('p', 'discovery-genre', book.genre), element('h3', '', book.title),
      element('p', 'discovery-author', book.author), element('p', 'discovery-tagline', book.tagline),
      element('p', 'discovery-summary', book.summary), button);
    article.append(art, copy);
    return article;
  }));
}

function bookIllustration(title) {
  const normalized = title.toLocaleLowerCase('th-TH');
  const recommended = recommendations.find((book) => normalized === book.title.toLocaleLowerCase('th-TH'));
  if (recommended) return [null, recommended.cover, recommended.alt];
  const illustrations = [
    [/เจ้าชายน้อย|little prince/, 'little-prince', 'เจ้าชายน้อยกับดอกกุหลาบบนดาวใต้ท้องฟ้าที่มีดวงดาว'],
    [/โต๊ะโตะจัง|totto[ -]?chan/, 'totto-chan', 'เด็กหญิงหน้าโรงเรียนที่ใช้ตู้รถไฟเป็นห้องเรียน'],
    [/secret garden|สวนปริศนา/, 'secret-garden', 'เด็กหญิงหน้าประตูสวนลับท่ามกลางต้นไม้และดอกไม้'],
    [/รอบโลกในแปดสิบวัน|around the world in eighty days/, 'eighty-days', 'บอลลูนเหนือแผนที่โลก สื่อถึงการเดินทางผจญภัย']
  ];
  return illustrations.find(([pattern]) => pattern.test(normalized));
}

function card(book) {
  const article = element('article', 'book-card');
  const cover = element('div', 'book-cover');
  const illustration = bookIllustration(book.title);
  if (illustration) {
    cover.classList.add('illustrated');
    if (recommendations.some((item) => item.cover === illustration[1])) cover.classList.add('portrait');
    const image = element('img', 'book-illustration');
    image.src = `/images/${illustration[1]}.png`;
    image.alt = illustration[2];
    image.width = 960;
    image.height = 600;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      cover.classList.remove('illustrated');
      image.remove();
    }, { once: true });
    cover.append(image);
  }
  cover.append(element('span', 'cover-label', 'MY READING COLLECTION'), element('h3', '', book.title));
  const body = element('div', 'book-body');
  body.append(element('span', 'badge', labels[book.status]), element('h3', '', book.title),
    element('p', 'book-meta', book.author || 'ไม่ระบุผู้เขียน'));
  const date = element('time', 'book-meta', book.date ? `วันที่อ่าน: ${new Date(`${book.date}T00:00:00`).toLocaleDateString('th-TH')}` : 'ยังไม่ระบุวันที่อ่าน (รายการเดิม)');
  if (book.date) date.dateTime = book.date;
  body.append(date);
  const progress = element('progress', 'progress');
  progress.max = book.pages;
  progress.value = book.current;
  progress.setAttribute('aria-label', `อ่าน ${book.current} จาก ${book.pages} หน้า`);
  body.append(progress, element('p', 'page-count', `${book.current.toLocaleString('th-TH')} / ${book.pages.toLocaleString('th-TH')} หน้า`));
  if (book.notes) body.append(element('p', 'book-notes', book.notes));
  const actions = element('div', 'card-actions');
  const edit = element('button', 'text-button', 'แก้ไข');
  edit.type = 'button';
  edit.setAttribute('aria-label', `แก้ไข ${book.title}`);
  edit.addEventListener('click', () => openForm(book));
  const remove = element('button', 'text-button delete', 'ลบ');
  remove.type = 'button';
  remove.setAttribute('aria-label', `ลบ ${book.title}`);
  remove.addEventListener('click', () => {
    pendingDelete = book.id;
    $('delete-copy').textContent = book.title;
    $('delete-dialog').returnValue = 'cancel';
    $('delete-dialog').showModal();
  });
  actions.append(edit, remove);
  body.append(actions);
  article.append(cover, body);
  return article;
}

function render() {
  $('stat-total').textContent = books.length;
  $('stat-reading').textContent = books.filter((book) => book.status === 'reading').length;
  $('stat-done').textContent = books.filter((book) => book.status === 'done').length;
  $('stat-pages').textContent = books.reduce((sum, book) => sum + book.current, 0).toLocaleString('th-TH');
  const search = $('search').value.trim().toLocaleLowerCase('th-TH');
  const visible = books.filter((book) => (filter === 'all' || book.status === filter) &&
    [book.title, book.author, book.notes].some((text) => text.toLocaleLowerCase('th-TH').includes(search)));
  $('books').replaceChildren(...visible.map(card));
  $('result-count').textContent = `${visible.length} เล่ม`;
  $('empty').hidden = visible.length !== 0;
  $('empty-copy').textContent = books.length ? 'ไม่พบหนังสือตามเงื่อนไข ลองเปลี่ยนคำค้นหาหรือสถานะ' : 'เพิ่มหนังสือที่กำลังอ่าน แล้วเก็บความประทับใจไปด้วยกัน';
  $('add-empty').hidden = books.length !== 0;
}

function openForm(book) {
  $('book-form').reset();
  $('book-id').value = book ? book.id : '';
  $('dialog-title').textContent = book && book.id ? 'แก้ไขบันทึกการอ่าน' : 'เพิ่มบันทึกการอ่าน';
  $('form-error').textContent = '';
  $('date').value = book ? (book.date || '') : localDate();
  if (book) {
    for (const field of ['title', 'author', 'pages', 'current', 'status', 'notes']) $(field).value = book[field];
  }
  $('book-dialog').showModal();
  $('title').focus();
}

for (const id of ['add-top', 'add-empty']) $(id).addEventListener('click', () => openForm());
for (const id of ['close-dialog', 'cancel-dialog']) $(id).addEventListener('click', () => $('book-dialog').close());
$('search').addEventListener('input', render);
document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    render();
  });
});
$('status').addEventListener('change', () => {
  if ($('status').value === 'done' && $('pages').value) $('current').value = $('pages').value;
});
$('book-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = $('book-id').value;
  if (!id && books.length >= MAX_BOOKS) {
    $('form-error').textContent = `เก็บหนังสือได้สูงสุด ${MAX_BOOKS} เล่ม`;
    return;
  }
  const book = {
    id: id || newId(),
    date: $('date').value,
    title: $('title').value.trim(),
    author: $('author').value.trim(),
    pages: Number($('pages').value),
    current: Number($('current').value),
    status: $('status').value,
    notes: $('notes').value.trim()
  };
  if (book.status === 'done') book.current = book.pages;
  if (!validBook(book) || !book.author || !book.notes || book.date < '0001-01-01') {
    $('form-error').textContent = 'กรุณากรอกชื่อหนังสือ ผู้เขียน วันที่ และสรุปเนื้อหาให้ครบ จำนวนหน้าที่อ่านต้องไม่เกินจำนวนหน้าทั้งหมด';
    return;
  }
  const next = id ? books.map((item) => item.id === id ? book : item) : [book, ...books];
  if (persist(next)) $('book-dialog').close();
  else $('form-error').textContent = 'บันทึกไม่สำเร็จ กรุณาปิดหน้าต่างเพื่ออ่านข้อความแจ้งเตือน';
});
$('delete-dialog').addEventListener('close', () => {
  if ($('delete-dialog').returnValue === 'delete' && pendingDelete) {
    persist(books.filter((book) => book.id !== pendingDelete));
  }
  pendingDelete = null;
});
renderRecommendations();
window.addEventListener('storage', (event) => {
  if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) {
    notify('ข้อมูลถูกเปลี่ยนจากแท็บอื่น กรุณารีโหลดหน้านี้ก่อนแก้ไขต่อเพื่อป้องกันการเขียนทับ');
    $('book-form').dataset.storageBlocked = 'true';
  }
});
render();

async function loadShareCode() {
  try {
    const response = await fetch('/api/share', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Share unavailable');
    const config = await response.json();
    if (!config.url) {
      $('share-status').textContent = 'ยังไม่ได้ตั้งค่าลิงก์เข้าเว็บสำหรับมือถือ';
      return;
    }
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid share URL');
    $('share-link').href = url.href;
    $('share-link').textContent = url.href;
    $('share-link').hidden = false;
    const image = $('share-qr');
    image.addEventListener('load', () => {
      $('share-code').hidden = false;
      $('share-status').textContent = 'เปิดกล้องมือถือเพื่อสแกน หรือแตะลิงก์ด้านบน';
    }, { once: true });
    image.addEventListener('error', () => {
      $('share-status').textContent = 'โหลด QR Code ไม่สำเร็จ สามารถเปิดลิงก์ด้านบนแทนได้';
    }, { once: true });
    image.src = '/api/share/qr.png';
  } catch {
    $('share-status').textContent = 'ยังโหลด QR Code ไม่ได้ กรุณารีโหลดหน้าเว็บเพื่อลองอีกครั้ง';
  }
}
loadShareCode();
