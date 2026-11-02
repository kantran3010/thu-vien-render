const express = require('express');
const db = require('../db');
const { rules } = require('../config');
const { requireLogin, requireAdmin, perform } = require('../middleware');
const loans = require('../services/loans');

const router = express.Router();
const { TODAY } = db;

// Danh sách phiếu mượn (thủ thư). Cột status tính bằng SQL: returned / overdue / borrowing
const LOAN_SELECT = `
  SELECT l.*, u.full_name, u.card_code, b.title,
         CASE WHEN l.returned_at IS NOT NULL THEN 'returned'
              WHEN l.due_date < ${TODAY} THEN 'overdue'
              ELSE 'borrowing' END AS status,
         CASE WHEN l.returned_at IS NULL AND l.due_date < ${TODAY}
              THEN (${TODAY} - l.due_date) * ${rules.finePerDay} ELSE l.fine_amount END AS fine
    FROM loans l
    JOIN users u ON u.id = l.user_id
    JOIN books b ON b.id = l.book_id`;

router.get('/loans', requireAdmin, async (req, res) => {
  const status = ['borrowing', 'overdue', 'returned'].includes(req.query.status) ? req.query.status : '';
  const rows = (await db.get().query(`SELECT * FROM (${LOAN_SELECT}) x ${status ? 'WHERE status = $1' : ''} ORDER BY id DESC LIMIT 200`, status ? [status] : [])).rows;
  res.render('loans/index', { title: 'Phiếu mượn', loans: rows, status });
});

router.get('/loans/new', requireAdmin, async (req, res) => {
  const readers = (await db.get().query("SELECT id, full_name, card_code FROM users WHERE role = 'reader' ORDER BY full_name")).rows;
  const books = (await db.get().query('SELECT id, title, author, available_copies FROM books WHERE available_copies > 0 ORDER BY title')).rows;
  res.render('loans/new', { title: 'Lập phiếu mượn', readers, books, selectedReader: req.query.reader || '' });
});

router.post('/loans', requireAdmin, (req, res) =>
  perform(res, '/loans/new', () => loans.createLoan(Number(req.body.user_id), Number(req.body.book_id)), (r) => `Đã cho "${r.reader.full_name}" mượn "${r.book.title}" (hạn trả sau ${rules.loanDays} ngày)`)
);

router.post('/loans/:id/return', requireAdmin, (req, res) =>
  perform(res, '/loans', () => loans.returnLoan(Number(req.params.id)), (r) => (r.fine > 0 ? `Đã nhận trả sách. Tiền phạt trả trễ: ${r.fine.toLocaleString('vi-VN')} đ` : 'Đã nhận trả sách đúng hạn'))
);

router.post('/loans/:id/renew', requireLogin, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  return perform(res, isAdmin ? '/loans' : '/my-loans', () => loans.renewLoan(Number(req.params.id), isAdmin ? null : req.user.id), `Đã gia hạn thêm ${rules.renewDays} ngày`);
});

// Độc giả xem sách của mình
router.get('/my-loans', requireLogin, async (req, res) => {
  const rows = (await db.get().query(`SELECT * FROM (${LOAN_SELECT}) x WHERE user_id = $1 ORDER BY id DESC`, [req.user.id])).rows;
  res.render('loans/mine', { title: 'Sách của tôi', loans: rows });
});

module.exports = router;
