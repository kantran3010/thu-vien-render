const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const db = require('./db');
const config = require('./config');
const { loadSession } = require('./middleware');
const { AppError } = require('./services/loans');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render đặt app sau reverse proxy (HTTPS)
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'cdn.jsdelivr.net'],
          'style-src': ["'self'", 'cdn.jsdelivr.net'],
          'font-src': ["'self'", 'cdn.jsdelivr.net'],
        },
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health check cho Render: kiểm tra cả kết nối database
  app.get('/healthz', async (req, res) => {
    try {
      await db.get().query('SELECT 1');
      res.json({ status: 'ok', db: db.get().kind });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use(loadSession);
  app.use((req, res, next) => {
    res.locals.rules = config.rules;
    res.locals.path = req.path;
    res.locals.money = (n) => Number(n).toLocaleString('vi-VN') + ' đ';
    next();
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/admin'));
  app.use(require('./routes/books'));
  app.use(require('./routes/loans'));

  app.use((req, res) => res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn tìm không tồn tại.' }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof AppError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).render('error', { title: 'Lỗi', message: status === 500 ? 'Hệ thống gặp sự cố, vui lòng thử lại sau.' : err.message });
  });

  return app;
}

module.exports = { createApp };
