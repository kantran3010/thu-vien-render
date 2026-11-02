const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { rules } = require('../config');
const { requireLogin, requireAdmin } = require('../middleware');
const { syncLocks, accountStatus } = require('../services/accounts');

const router = express.Router();
const { TODAY } = db;
const q = (sql, params) => db.get().query(sql, params);

// Trang chủ: số liệu tổng quan (thủ thư) hoặc tình trạng mượn sách (độc giả)
router.get('/', requireLogin, async (req, res) => {
  if (req.user.role === 'admin') {
    await syncLocks(q);
    const stats = (
      await q(`SELECT
        (SELECT count(*)::int FROM books) AS titles,
        (SELECT coalesce(sum(total_copies),0)::int FROM books) AS copies,
        (SELECT coalesce(sum(available_copies),0)::int FROM books) AS available,
        (SELECT count(*)::int FROM users WHERE role = 'reader') AS readers,
        (SELECT count(*)::int FROM loans WHERE returned_at IS NULL) AS borrowing,
        (SELECT count(*)::int FROM loans WHERE returned_at IS NULL AND due_date < ${TODAY}) AS overdue,
        (SELECT coalesce(sum(fine_amount),0)::int FROM loans WHERE fine_paid_at IS NOT NULL) AS fines,
        (SELECT coalesce(sum(fine_amount),0)::int FROM loans WHERE returned_at IS NOT NULL AND fine_amount > 0 AND fine_paid_at IS NULL) AS unpaid,
        (SELECT count(*)::int FROM users WHERE role = 'reader' AND locked_at IS NOT NULL) AS locked`)
    ).rows[0];
    return res.render('dashboard', { title: 'Tổng quan', stats, mine: null });
  }
  const mine = (
    await q(`SELECT count(*) FILTER (WHERE returned_at IS NULL)::int AS borrowing,
                    count(*) FILTER (WHERE returned_at IS NULL AND due_date < ${TODAY})::int AS overdue
               FROM loans WHERE user_id = $1`, [req.user.id])
  ).rows[0];
  res.render('dashboard', { title: 'Tổng quan', stats: null, mine, rules, account: await accountStatus(req.user.id) });
});

// Báo cáo thống kê
router.get('/reports', requireAdmin, async (req, res) => {
  const topBooks = (
    await q(`SELECT b.title, b.author, count(l.id)::int AS times
               FROM loans l JOIN books b ON b.id = l.book_id
              GROUP BY b.id ORDER BY times DESC, b.title LIMIT 5`)
  ).rows;
  const byCategory = (
    await q(`SELECT b.category, count(l.id)::int AS times
               FROM loans l JOIN books b ON b.id = l.book_id
              GROUP BY b.category ORDER BY times DESC`)
  ).rows;
  const overdue = (
    await q(`SELECT l.id, u.full_name, u.card_code, b.title, l.due_date,
                    (${TODAY} - l.due_date)::int AS days_late,
                    (${TODAY} - l.due_date) * ${rules.finePerDay} AS fine
               FROM loans l JOIN users u ON u.id = l.user_id JOIN books b ON b.id = l.book_id
              WHERE l.returned_at IS NULL AND l.due_date < ${TODAY}
              ORDER BY days_late DESC`)
  ).rows;
  const monthly = (
    await q(`SELECT to_char(date_trunc('month', borrowed_at), 'MM/YYYY') AS month, count(*)::int AS times
               FROM loans GROUP BY date_trunc('month', borrowed_at)
              ORDER BY date_trunc('month', borrowed_at) DESC LIMIT 6`)
  ).rows.reverse();
  res.render('reports', { title: 'Báo cáo', topBooks, byCategory, overdue, monthly });
});

// Quản lý độc giả
router.get('/readers', requireAdmin, async (req, res) => {
  await syncLocks(q);
  const readers = (
    await q(`SELECT u.id, u.full_name, u.username, u.card_code, u.phone, u.email, u.locked_at,
                    coalesce(sum(CASE WHEN l.returned_at IS NOT NULL AND l.fine_amount > 0 AND l.fine_paid_at IS NULL THEN l.fine_amount
                                      WHEN l.returned_at IS NULL AND l.due_date < ${TODAY} THEN (${TODAY} - l.due_date) * ${rules.finePerDay} END), 0)::int AS debt,
                    count(l.id) FILTER (WHERE l.returned_at IS NULL)::int AS borrowing,
                    count(l.id) FILTER (WHERE l.returned_at IS NULL AND l.due_date < ${TODAY})::int AS overdue
               FROM users u LEFT JOIN loans l ON l.user_id = u.id
              WHERE u.role = 'reader' GROUP BY u.id ORDER BY u.full_name`)
  ).rows;
  res.render('readers', { title: 'Độc giả', readers, error: null, form: {} });
});

router.post('/readers', requireAdmin, async (req, res) => {
  const f = Object.fromEntries(['username', 'full_name', 'phone', 'email'].map((k) => [k, (req.body[k] || '').trim()]));
  const password = req.body.password || '';
  const render = async (error) => {
    const readers = (await q("SELECT u.id, u.full_name, u.username, u.card_code, u.phone, u.email, u.locked_at, 0 AS debt, 0 AS borrowing, 0 AS overdue FROM users u WHERE role = 'reader' ORDER BY full_name")).rows;
    res.status(400).render('readers', { title: 'Độc giả', readers, error, form: f });
  };
  if (!/^[a-zA-Z0-9_.]{4,30}$/.test(f.username)) return render('Tên đăng nhập gồm 4-30 ký tự chữ, số, dấu chấm hoặc gạch dưới.');
  if (!f.full_name) return render('Vui lòng nhập họ tên.');
  if (password.length < 6) return render('Mật khẩu tối thiểu 6 ký tự.');
  if ((await q('SELECT 1 FROM users WHERE username = $1', [f.username])).rows.length) return render('Tên đăng nhập đã tồn tại.');

  const id = (
    await q("INSERT INTO users (username, full_name, password_hash, role, phone, email) VALUES ($1,$2,$3,'reader',$4,$5) RETURNING id", [
      f.username, f.full_name, bcrypt.hashSync(password, 10), f.phone || null, f.email || null,
    ])
  ).rows[0].id;
  await q("UPDATE users SET card_code = 'DG' || lpad(id::text, 4, '0') WHERE id = $1", [id]);
  res.flash('success', `Đã tạo thẻ độc giả cho ${f.full_name}`);
  res.redirect('/readers');
});

module.exports = router;
