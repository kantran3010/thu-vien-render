const db = require('./db');
const seed = require('./seed');
const config = require('./config');
const { createApp } = require('./app');

(async () => {
  await db.init();
  await seed.run();
  const server = createApp().listen(config.port, '0.0.0.0', () => {
    console.log(`Thư viện đang chạy tại cổng ${config.port} (database: ${db.get().kind})`);
  });

  // Render gửi SIGTERM khi deploy bản mới: đóng kết nối gọn gàng
  process.on('SIGTERM', () => server.close(() => db.get().close().then(() => process.exit(0))));
})().catch((err) => {
  console.error('Không khởi động được ứng dụng:', err);
  process.exit(1);
});
