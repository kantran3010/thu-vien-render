const bcrypt = require('bcryptjs');
const db = require('./db');
const { isProd, rules } = require('./config');

const { TODAY } = db;

const BOOKS = [
  ['9786041000011', 'Lập trình Web với Node.js', 'Nguyễn Văn An', 'Công nghệ thông tin', 2022, 4],
  ['9786041000028', 'Cơ sở dữ liệu quan hệ và PostgreSQL', 'Trần Thị Bình', 'Công nghệ thông tin', 2021, 3],
  ['9786041000035', 'Điện toán đám mây căn bản', 'Lê Quốc Cường', 'Công nghệ thông tin', 2023, 5],
  ['9786041000042', 'Giải thuật và cấu trúc dữ liệu', 'Phạm Minh Đức', 'Công nghệ thông tin', 2019, 2],
  ['9786041000059', 'Kinh tế vi mô', 'Hoàng Thu Hà', 'Kinh tế', 2020, 3],
  ['9786041000066', 'Nguyên lý kế toán', 'Đặng Thị Hạnh', 'Kinh tế', 2018, 3],
  ['9786041000073', 'Quản trị nhân lực', 'Vũ Thanh Hải', 'Quản trị', 2021, 2],
  ['9786041000080', 'Luật Lao động và An sinh xã hội', 'Bùi Hữu Lộc', 'Luật', 2022, 3],
  ['9786041000097', 'Tâm lý học đại cương', 'Ngô Mỹ Linh', 'Khoa học xã hội', 2017, 2],
  ['9786041000103', 'Dế Mèn phiêu lưu ký', 'Tô Hoài', 'Văn học', 2015, 6],
  ['9786041000110', 'Số đỏ', 'Vũ Trọng Phụng', 'Văn học', 2016, 3],
  ['9786041000127', 'Đắc nhân tâm', 'Dale Carnegie', 'Kỹ năng sống', 2020, 4],
];

const READERS = [
  ['docgia1', 'Nguyễn Minh Anh', 'DG0001', '0901000001', 'minhanh@example.com'],
  ['docgia2', 'Trần Quốc Bảo', 'DG0002', '0901000002', 'quocbao@example.com'],
  ['docgia3', 'Lê Thị Cẩm', 'DG0003', '0901000003', 'thicam@example.com'],
  ['docgia4', 'Phạm Hoàng Dũng', 'DG0004', '0901000004', 'hoangdung@example.com'],
];

async function ensureAdmin() {
  const q = db.get().query;
  const exists = (await q("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")).rows.length > 0;
  if (exists) return;
  const password = process.env.ADMIN_PASSWORD || (isProd ? null : 'admin123');
  if (!password) throw new Error('Cần đặt biến môi trường ADMIN_PASSWORD để tạo tài khoản thủ thư lần đầu');
  const username = process.env.ADMIN_USERNAME || 'admin';
  await q("INSERT INTO users (username, full_name, password_hash, role) VALUES ($1, 'Thủ thư', $2, 'admin')", [
    username,
    bcrypt.hashSync(password, 10),
  ]);
  console.log(`[seed] Đã tạo tài khoản thủ thư "${username}"`);
}

// Dữ liệu mẫu để demo: sách, độc giả và vài phiếu mượn (trong đó có 1 phiếu quá hạn, 1 phiếu đã trả trễ)
async function seedDemo() {
  const q = db.get().query;
  if ((await q('SELECT 1 FROM books LIMIT 1')).rows.length > 0) return;

  for (const [isbn, title, author, category, year, copies] of BOOKS) {
    await q(
      'INSERT INTO books (isbn, title, author, category, publish_year, total_copies, available_copies) VALUES ($1,$2,$3,$4,$5,$6,$6)',
      [isbn, title, author, category, year, copies]
    );
  }
  const hash = bcrypt.hashSync('docgia123', 10);
  for (const [username, name, card, phone, email] of READERS) {
    await q(
      "INSERT INTO users (username, full_name, password_hash, role, card_code, phone, email) VALUES ($1,$2,$3,'reader',$4,$5,$6)",
      [username, name, hash, card, phone, email]
    );
  }

  const uid = async (u) => (await q('SELECT id FROM users WHERE username = $1', [u])).rows[0].id;
  const bid = async (isbn) => (await q('SELECT id FROM books WHERE isbn = $1', [isbn])).rows[0].id;
  // [độc giả, isbn, mượn cách đây (ngày), đã trả cách đây (ngày) | null]
  const loans = [
    ['docgia1', '9786041000011', 20, null], // quá hạn 6 ngày
    ['docgia1', '9786041000035', 3, null],
    ['docgia2', '9786041000028', 5, null],
    ['docgia3', '9786041000103', 30, 10], // trả trễ 6 ngày
    ['docgia3', '9786041000127', 2, 1],
    ['docgia4', '9786041000059', 9, null],
  ];
  for (const [user, isbn, ago, retAgo] of loans) {
    const userId = await uid(user);
    const bookId = await bid(isbn);
    await q(
      `INSERT INTO loans (user_id, book_id, borrowed_at, due_date, returned_at, fine_amount)
       VALUES ($1, $2, ${TODAY} - $3::int, ${TODAY} - $3::int + $4::int,
               CASE WHEN $5::int IS NULL THEN NULL ELSE ${TODAY} - $5::int END,
               CASE WHEN $5::int IS NULL THEN 0 ELSE GREATEST(0, (${TODAY} - $5::int) - (${TODAY} - $3::int + $4::int)) * $6::int END)`,
      [userId, bookId, ago, rules.loanDays, retAgo, rules.finePerDay]
    );
    if (retAgo === null) await q('UPDATE books SET available_copies = available_copies - 1 WHERE id = $1', [bookId]);
  }
  console.log('[seed] Đã nạp dữ liệu demo');
}

async function run() {
  await ensureAdmin();
  if (process.env.SEED_DEMO === 'true' || (!isProd && process.env.SEED_DEMO !== 'false')) await seedDemo();
}

module.exports = { run };
