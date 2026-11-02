const express = require('express');
const db = require('../db');
const { requireLogin, requireAdmin } = require('../middleware');

const router = express.Router();
const PAGE_SIZE = 8;

router.get('/books', requireLogin, async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(title ILIKE $${params.length} OR author ILIKE $${params.length} OR isbn ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = (await db.get().query(`SELECT count(*)::int AS n FROM books ${clause}`, params)).rows[0].n;
  const books = (
    await db.get().query(`SELECT * FROM books ${clause} ORDER BY title LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params)
  ).rows;
  const categories = (await db.get().query('SELECT DISTINCT category FROM books ORDER BY category')).rows.map((r) => r.category);

  res.render('books/index', { title: 'Kho sách', books, categories, q, category, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total });
});

// API JSON công khai cho tra cứu: GET /api/books?q=...
router.get('/api/books', async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const { rows } = await db.get().query(
    'SELECT id, isbn, title, author, category, publish_year, available_copies, total_copies FROM books WHERE title ILIKE $1 OR author ILIKE $1 ORDER BY title LIMIT 50',
    [q]
  );
  res.json({ count: rows.length, books: rows });
});

const emptyBook = { isbn: '', title: '', author: '', category: '', publish_year: '', total_copies: 1 };

router.get('/books/new', requireAdmin, (req, res) => res.render('books/form', { title: 'Thêm sách', book: emptyBook, error: null, action: '/books' }));

function parseBook(body) {
  const b = {
    isbn: (body.isbn || '').trim() || null,
    title: (body.title || '').trim(),
    author: (body.author || '').trim(),
    category: (body.category || '').trim(),
    publish_year: body.publish_year ? parseInt(body.publish_year, 10) : null,
    total_copies: parseInt(body.total_copies, 10),
  };
  let error = null;
  if (!b.title || !b.author || !b.category) error = 'Vui lòng nhập đủ tên sách, tác giả và thể loại.';
  else if (!Number.isInteger(b.total_copies) || b.total_copies < 0) error = 'Số bản phải là số nguyên không âm.';
  else if (b.publish_year !== null && (b.publish_year < 1000 || b.publish_year > new Date().getFullYear() + 1)) error = 'Năm xuất bản không hợp lệ.';
  return { b, error };
}

router.post('/books', requireAdmin, async (req, res) => {
  const { b, error } = parseBook(req.body);
  const fail = (msg) => res.status(400).render('books/form', { title: 'Thêm sách', book: b, error: msg, action: '/books' });
  if (error) return fail(error);
  try {
    await db.get().query(
      'INSERT INTO books (isbn, title, author, category, publish_year, total_copies, available_copies) VALUES ($1,$2,$3,$4,$5,$6,$6)',
      [b.isbn, b.title, b.author, b.category, b.publish_year, b.total_copies]
    );
  } catch (err) {
    if (err.code === '23505') return fail('Mã ISBN đã tồn tại.');
    throw err;
  }
  res.flash('success', `Đã thêm sách "${b.title}"`);
  res.redirect('/books');
});

router.get('/books/:id/edit', requireAdmin, async (req, res) => {
  const book = (await db.get().query('SELECT * FROM books WHERE id = $1', [req.params.id])).rows[0];
  if (!book) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Sách không tồn tại.' });
  res.render('books/form', { title: 'Sửa sách', book, error: null, action: `/books/${book.id}` });
});

router.post('/books/:id', requireAdmin, async (req, res) => {
  const { b, error } = parseBook(req.body);
  const action = `/books/${req.params.id}`;
  const fail = (msg) => res.status(400).render('books/form', { title: 'Sửa sách', book: { ...b, id: req.params.id }, error: msg, action });
  if (error) return fail(error);
  try {
    // available = total - số bản đang cho mượn; không cho giảm tổng số bản thấp hơn số đang mượn
    const result = await db.get().query(
      `UPDATE books SET isbn=$1, title=$2, author=$3, category=$4, publish_year=$5, total_copies=$6,
              available_copies = $6 - (total_copies - available_copies)
        WHERE id = $7 AND $6 >= (total_copies - available_copies)`,
      [b.isbn, b.title, b.author, b.category, b.publish_year, b.total_copies, req.params.id]
    );
    if (result.rowCount === 0) return fail('Tổng số bản không được nhỏ hơn số bản đang cho mượn.');
  } catch (err) {
    if (err.code === '23505') return fail('Mã ISBN đã tồn tại.');
    throw err;
  }
  res.flash('success', 'Đã cập nhật thông tin sách');
  res.redirect('/books');
});

router.post('/books/:id/delete', requireAdmin, async (req, res) => {
  try {
    await db.get().query('DELETE FROM books WHERE id = $1', [req.params.id]);
    res.flash('success', 'Đã xóa sách');
  } catch (err) {
    if (err.code !== '23503') throw err; // khóa ngoại: sách đã có lịch sử mượn
    res.flash('danger', 'Không thể xóa sách đã có lịch sử mượn. Hãy đặt số bản về 0 nếu không còn lưu hành.');
  }
  res.redirect('/books');
});

module.exports = router;
