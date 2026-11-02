const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signIn, signOut } = require('../middleware');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('login', { title: 'Đăng nhập', error: 'Thử đăng nhập quá nhiều lần, vui lòng đợi 15 phút.' }),
});

router.get('/login', (req, res) => (req.user ? res.redirect('/') : res.render('login', { title: 'Đăng nhập', error: null })));

router.post('/login', loginLimiter, async (req, res) => {
  const { username = '', password = '' } = req.body;
  const user = (await db.get().query('SELECT * FROM users WHERE username = $1', [username.trim()])).rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { title: 'Đăng nhập', error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }
  signIn(res, user);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  signOut(res);
  res.redirect('/login');
});

router.get('/register', (req, res) => res.render('register', { title: 'Đăng ký độc giả', error: null, form: {} }));

router.post('/register', async (req, res) => {
  const f = Object.fromEntries(['username', 'full_name', 'phone', 'email'].map((k) => [k, (req.body[k] || '').trim()]));
  const password = req.body.password || '';
  const fail = (error) => res.status(400).render('register', { title: 'Đăng ký độc giả', error, form: f });

  if (!/^[a-zA-Z0-9_.]{4,30}$/.test(f.username)) return fail('Tên đăng nhập gồm 4-30 ký tự chữ, số, dấu chấm hoặc gạch dưới.');
  if (!f.full_name) return fail('Vui lòng nhập họ tên.');
  if (password.length < 6) return fail('Mật khẩu tối thiểu 6 ký tự.');

  const { rows } = await db.get().query('SELECT 1 FROM users WHERE username = $1', [f.username]);
  if (rows.length) return fail('Tên đăng nhập đã tồn tại.');

  const created = (
    await db.get().query(
      `INSERT INTO users (username, full_name, password_hash, role, phone, email)
       VALUES ($1, $2, $3, 'reader', $4, $5) RETURNING id, full_name, role`,
      [f.username, f.full_name, bcrypt.hashSync(password, 10), f.phone || null, f.email || null]
    )
  ).rows[0];
  await db.get().query("UPDATE users SET card_code = 'DG' || lpad(id::text, 4, '0') WHERE id = $1", [created.id]);
  signIn(res, created);
  res.flash('success', 'Đăng ký thành công! Chào mừng bạn đến thư viện.');
  res.redirect('/');
});

module.exports = router;
