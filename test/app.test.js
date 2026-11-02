// Chạy: npm test  (dùng PGlite in-memory, không cần cài PostgreSQL)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.SEED_DEMO = 'true';
delete process.env.DATABASE_URL;

const db = require('../src/db');
const seed = require('../src/seed');
const loans = require('../src/services/loans');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  await db.init();
  await seed.run();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.get().close();
});

const one = async (sql, params) => (await db.get().query(sql, params)).rows[0];
const userId = async (u) => (await one('SELECT id FROM users WHERE username = $1', [u])).id;
const bookId = async (isbn) => (await one('SELECT id FROM books WHERE isbn = $1', [isbn])).id;

async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { res, cookie };
}

test('healthz trả về ok và kết nối được database', async () => {
  const body = await (await fetch(`${base}/healthz`)).json();
  assert.equal(body.status, 'ok');
});

test('chưa đăng nhập thì bị chuyển về /login', async () => {
  const res = await fetch(`${base}/books`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('đăng nhập sai mật khẩu trả 401, đúng thì có cookie', async () => {
  assert.equal((await login('admin', 'sai-mat-khau')).res.status, 401);
  const ok = await login('admin', 'admin123');
  assert.equal(ok.res.status, 302);
  assert.match(ok.cookie, /token=/);
});

test('độc giả không vào được trang của thủ thư (403) nhưng xem được kho sách', async () => {
  const { cookie } = await login('docgia2', 'docgia123');
  assert.equal((await fetch(`${base}/loans`, { headers: { cookie } })).status, 403);
  const books = await fetch(`${base}/books?q=cloud`, { headers: { cookie } });
  assert.equal(books.status, 200);
  const page = await (await fetch(`${base}/books?q=%C4%91i%E1%BB%87n+to%C3%A1n`, { headers: { cookie } })).text();
  assert.match(page, /Điện toán đám mây căn bản/);
});

test('thủ thư xem được dashboard và báo cáo', async () => {
  const { cookie } = await login('admin', 'admin123');
  for (const path of ['/', '/loans', '/loans/new', '/readers', '/reports', '/books/new']) {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    assert.equal(res.status, 200, path);
  }
  const reports = await (await fetch(`${base}/reports`, { headers: { cookie } })).text();
  assert.match(reports, /12\.000/); // 6 ngày trễ × 2.000đ của phiếu quá hạn trong dữ liệu mẫu
});

test('API JSON tra cứu sách', async () => {
  const body = await (await fetch(`${base}/api/books?q=node`)).json();
  assert.equal(body.count, 1);
  assert.equal(body.books[0].title, 'Lập trình Web với Node.js');
});

test('mượn sách: giảm số bản còn lại, không mượn trùng cuốn đang mượn', async () => {
  const reader = await userId('docgia2');
  const book = await bookId('9786041000042'); // 2 bản
  await loans.createLoan(reader, book);
  assert.equal((await one('SELECT available_copies FROM books WHERE id = $1', [book])).available_copies, 1);
  await assert.rejects(async () => loans.createLoan(reader, book), /đang mượn cuốn sách này/);
});

test('độc giả đang có sách quá hạn không được mượn thêm', async () => {
  await assert.rejects(async () => loans.createLoan(await userId('docgia1'), await bookId('9786041000066')), /quá hạn/);
});

test('trả sách trễ hạn tính phạt 2.000đ/ngày và hoàn lại bản vào kho', async () => {
  const overdue = await one(
    'SELECT id, book_id FROM loans WHERE user_id = $1 AND returned_at IS NULL AND due_date < (now() AT TIME ZONE \'Asia/Ho_Chi_Minh\')::date',
    [await userId('docgia1')]
  );
  const before = (await one('SELECT available_copies FROM books WHERE id = $1', [overdue.book_id])).available_copies;
  const { fine } = await loans.returnLoan(overdue.id);
  assert.equal(fine, 12000);
  assert.equal((await one('SELECT available_copies FROM books WHERE id = $1', [overdue.book_id])).available_copies, before + 1);
  await assert.rejects(async () => loans.returnLoan(overdue.id), /đã được trả/);
});

test('gia hạn: được 1 lần, lần 2 bị từ chối, độc giả khác không gia hạn hộ được', async () => {
  const mine = await one('SELECT id FROM loans WHERE user_id = $1 AND returned_at IS NULL', [await userId('docgia4')]);
  await assert.rejects(async () => loans.renewLoan(mine.id, await userId('docgia2')), /Không tìm thấy/);
  await loans.renewLoan(mine.id, await userId('docgia4'));
  await assert.rejects(async () => loans.renewLoan(mine.id, await userId('docgia4')), /đã gia hạn 1 lần/);
});

test('giới hạn 5 cuốn đồng thời', async () => {
  const reader = await userId('docgia3');
  const isbns = ['9786041000011', '9786041000035', '9786041000059', '9786041000066', '9786041000073', '9786041000080'];
  let ok = 0;
  let lastError;
  for (const isbn of isbns) {
    try {
      await loans.createLoan(reader, await bookId(isbn));
      ok++;
    } catch (e) {
      lastError = e;
    }
  }
  assert.equal(ok, 5);
  assert.match(lastError.message, /tối đa 5 cuốn/);
});

test('cuốn sách cuối cùng chỉ cho 1 trong 2 người mượn đồng thời', async () => {
  const { id } = await one(
    "INSERT INTO books (title, author, category, total_copies, available_copies) VALUES ('Sách 1 bản', 'Tác giả', 'Thử nghiệm', 1, 1) RETURNING id"
  );
  const results = await Promise.allSettled([loans.createLoan(await userId('docgia2'), id), loans.createLoan(await userId('docgia4'), id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await one('SELECT available_copies FROM books WHERE id = $1', [id])).available_copies, 0);
});
