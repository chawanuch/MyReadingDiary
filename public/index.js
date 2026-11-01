'use strict';

const STORAGE_KEY = 'my-reading-diary:p01:v1';
const MAX_BOOKS = 500;
const labels = { want: 'อยากอ่าน', reading: 'กำลังอ่าน', done: 'อ่านจบแล้ว' };
const $ = (id) => document.getElementById(id);
let books = [];
let filter = 'all';
let pendingDelete = null;
let editing = null;
let loaded = false;
let loading = false;
let busy = false;
let stale = false;

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
  return value >= '1000-01-01' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function newId() {
  // getRandomValues also works on HTTP LAN origins, unlike randomUUID.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validBook(book) {
  return book && typeof book === 'object' &&
    validDate(book.date) &&
    typeof book.id === 'string' && /^[a-fA-F0-9]{32}$/.test(book.id) &&
    typeof book.title === 'string' && book.title.trim().length > 0 && book.title.length <= 200 &&
    typeof book.author === 'string' && book.author.length <= 160 &&
    typeof book.notes === 'string' && book.notes.length <= 5000 &&
    Object.hasOwn(labels, book.status) &&
    Number.isInteger(book.pages) && book.pages >= 1 && book.pages <= 100000 &&
    Number.isInteger(book.current) && book.current >= 0 && book.current <= book.pages &&
    (book.status !== 'done' || book.current === book.pages);
}

try {
  if (localStorage.getItem(STORAGE_KEY) !== null) {
    $('legacy-notice').textContent = 'พบข้อมูลเดิมในเบราว์เซอร์ ยังไม่ได้นำเข้าฐานข้อมูลและยังคงเดิมโดยไม่ถูกแก้ไข รายการด้านล่างมาจากฐานข้อมูลส่วนกลางเท่านั้น';
    $('legacy-notice').hidden = false;
  }
} catch {
  $('legacy-notice').textContent = 'ตรวจข้อมูลเดิมในเบราว์เซอร์ไม่ได้ ไม่มีการนำเข้าหรือแก้ไขข้อมูลเดิม รายการด้านล่างมาจากฐานข้อมูลส่วนกลางเท่านั้น';
  $('legacy-notice').hidden = false;
}

function validSavedBook(book) {
  return validBook(book) && Number.isInteger(book.version) && book.version >= 1 && book.version <= 4294967295;
}

async function request(url, method = 'GET', body) {
  const response = await fetch(url, {
    method, cache: 'no-store', signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const error = new Error('API request failed');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function updateControls() {
  const blocked = !loaded || loading || busy || stale;
  document.querySelectorAll('#add-top, #add-empty, .discovery-button, .card-actions button').forEach((button) => {
    button.disabled = blocked;
  });
  $('refresh-books').disabled = loading || busy;
  $('refresh-books').textContent = loading ? 'กำลังโหลด…' : (loaded ? 'รีเฟรชข้อมูล' : 'ลองโหลดอีกครั้ง');
  document.querySelectorAll('#book-form input, #book-form select, #book-form textarea, #book-form button, #delete-form button').forEach((control) => {
    control.disabled = busy;
  });
  $('book-form').setAttribute('aria-busy', String(busy));
  $('delete-form').setAttribute('aria-busy', String(busy));
  $('books').setAttribute('aria-busy', String(loading));
  $('save-book').textContent = busy ? 'กำลังดำเนินการ…' : 'บันทึกการอ่าน';
  $('confirm-delete').textContent = busy ? 'กำลังดำเนินการ…' : 'ยืนยันลบ';
}

async function loadBooks() {
  if (loading || busy) return;
  loading = true;
  $('load-status').textContent = 'กำลังโหลดบันทึกจากฐานข้อมูลส่วนกลาง…';
  render();
  try {
    const data = await request('/api/books');
    if (!Array.isArray(data.books) || data.books.length > MAX_BOOKS || !data.books.every(validSavedBook) ||
        new Set(data.books.map((book) => book.id)).size !== data.books.length) throw new Error('Invalid books response');
    books = data.books;
    loaded = true;
    stale = false;
    notify('');
    $('load-status').textContent = 'โหลดข้อมูลส่วนกลางแล้ว ทุกคนใช้รายการเดียวกัน กดรีเฟรชเพื่อดูการเปลี่ยนแปลงล่าสุด';
  } catch (error) {
    stale = true;
    $('load-status').textContent = error.status === 503
      ? 'ฐานข้อมูลยังไม่พร้อมใช้งาน กรุณากดลองโหลดอีกครั้ง'
      : 'โหลดข้อมูลไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง';
    if (loaded) notify('รายการที่แสดงเป็นข้อมูลครั้งก่อน ปิดการแก้ไขจนกว่าจะรีเฟรชสำเร็จ');
  } finally {
    loading = false;
    render();
  }
}

function mutationError(error) {
  // A lost response may follow a committed write. Require a read before any retry.
  stale = true;
  if (error.status === 409 || error.status === 404) {
    return 'ข้อมูลอาจถูกแก้ไขหรือลบแล้ว หรือถึงขีดจำกัดรายการ กรุณาปิดหน้าต่างแล้วกดรีเฟรชข้อมูลก่อนลองใหม่';
  }
  if (error.status === 503) {
    return 'ฐานข้อมูลยังไม่พร้อมใช้งาน ยังยืนยันผลไม่ได้ กรุณาปิดหน้าต่างแล้วกดรีเฟรชข้อมูลก่อนลองใหม่';
  }
  return 'ยังยืนยันผลไม่ได้ กรุณาปิดหน้าต่างแล้วกดรีเฟรชข้อมูลเพื่อตรวจผลก่อนลองใหม่';
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
    if (!loaded || loading || busy || stale) return;
    pendingDelete = { id: book.id, version: book.version };
    $('delete-copy').textContent = book.title;
    $('delete-error').textContent = '';
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
  $('empty').hidden = !loaded || loading || stale || visible.length !== 0;
  $('empty-copy').textContent = books.length ? 'ไม่พบหนังสือตามเงื่อนไข ลองเปลี่ยนคำค้นหาหรือสถานะ' : 'เพิ่มหนังสือที่กำลังอ่าน แล้วเก็บความประทับใจไปด้วยกัน';
  $('add-empty').hidden = books.length !== 0;
  if (!loaded) {
    for (const id of ['stat-total', 'stat-reading', 'stat-done', 'stat-pages', 'result-count']) $(id).textContent = '—';
  }
  updateControls();
}

function openForm(book) {
  if (!loaded || loading || busy || stale) return;
  editing = book && book.id ? { id: book.id, version: book.version } : null;
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
$('book-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!loaded || loading || busy || stale) {
    $('form-error').textContent = 'กรุณาปิดหน้าต่างแล้วรีเฟรชข้อมูลก่อนบันทึก';
    return;
  }
  const id = editing ? editing.id : '';
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
  if (!validBook(book) || !book.author || !book.notes) {
    $('form-error').textContent = 'กรุณากรอกชื่อหนังสือ ผู้เขียน วันที่ และสรุปเนื้อหาให้ครบ จำนวนหน้าที่อ่านต้องไม่เกินจำนวนหน้าทั้งหมด';
    return;
  }
  const payload = { ...book };
  if (id) {
    delete payload.id;
    payload.version = editing.version;
  }
  busy = true;
  updateControls();
  try {
    const data = await request(id ? `/api/books/${id}` : '/api/books', id ? 'PUT' : 'POST', payload);
    if (!validSavedBook(data.book) || data.book.id !== book.id ||
        data.book.version !== (id ? editing.version + 1 : 1)) throw new Error('Invalid saved book');
    books = id ? books.map((item) => item.id === id ? data.book : item) : [...books, data.book];
    $('book-dialog').close();
    notify('บันทึกลงฐานข้อมูลแล้ว');
  } catch (error) {
    $('form-error').textContent = mutationError(error);
  } finally {
    busy = false;
    render();
  }
});
$('delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  if (event.submitter && event.submitter.value === 'cancel') {
    $('delete-dialog').close();
    return;
  }
  if (!pendingDelete || stale || loading || !loaded) {
    $('delete-error').textContent = 'กรุณาปิดหน้าต่างแล้วรีเฟรชข้อมูลก่อนลบ';
    return;
  }
  busy = true;
  updateControls();
  try {
    const data = await request(`/api/books/${pendingDelete.id}`, 'DELETE', { version: pendingDelete.version });
    if (data.id !== pendingDelete.id) throw new Error('Invalid delete response');
    books = books.filter((book) => book.id !== pendingDelete.id);
    $('delete-dialog').close();
    notify('ลบรายการจากฐานข้อมูลแล้ว');
  } catch (error) {
    $('delete-error').textContent = mutationError(error);
  } finally {
    busy = false;
    render();
  }
});
$('delete-dialog').addEventListener('close', () => { pendingDelete = null; });
for (const id of ['book-dialog', 'delete-dialog']) {
  $(id).addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
}
$('refresh-books').addEventListener('click', loadBooks);
renderRecommendations();
loadBooks();

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
