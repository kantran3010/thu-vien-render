const jwt = require('jsonwebtoken');
const config = require('./config');
const { AppError } = require('./services/loans');

const COOKIE = 'token';

function signIn(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, config.jwtSecret, { expiresIn: '8h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 8 * 3600 * 1000 });
}

function signOut(res) {
  res.clearCookie(COOKIE);
}

// Gắn user (nếu đã đăng nhập) và flash message vào res.locals cho mọi view
function loadSession(req, res, next) {
  res.locals.user = null;
  try {
    if (req.cookies.token) res.locals.user = jwt.verify(req.cookies.token, config.jwtSecret);
  } catch {
    signOut(res);
  }
  req.user = res.locals.user;

  res.locals.flash = null;
  if (req.cookies.flash) {
    try {
      res.locals.flash = JSON.parse(req.cookies.flash);
    } catch {}
    res.clearCookie('flash');
  }
  res.flash = (type, text) => res.cookie('flash', JSON.stringify({ type, text }), { httpOnly: true, sameSite: 'lax', maxAge: 60000 });
  next();
}

const requireLogin = (req, res, next) => (req.user ? next() : res.redirect('/login'));

const requireAdmin = (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).render('error', { title: 'Không có quyền', message: 'Chức năng này chỉ dành cho thủ thư.' });
  next();
};

// Chạy một thao tác nghiệp vụ; nếu vi phạm quy tắc (AppError) thì báo lỗi và quay lại trang cũ
async function perform(res, backUrl, action, successText) {
  try {
    const result = await action();
    res.flash('success', typeof successText === 'function' ? successText(result) : successText);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    res.flash('danger', err.message);
  }
  res.redirect(backUrl);
}

module.exports = { signIn, signOut, loadSession, requireLogin, requireAdmin, perform };
