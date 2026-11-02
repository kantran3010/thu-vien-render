const db = require('../db');
const { rules } = require('../config');

const { TODAY } = db;

// Đồng bộ trạng thái khóa tài khoản độc giả (không cần job chạy nền: gọi mỗi khi cần dùng đến).
//  - Khóa: có sách chưa trả mà quá hạn hơn rules.lockAfterOverdueDays ngày.
//  - Mở khóa: đã trả hết sách quá hạn VÀ đã nộp đủ tiền phạt.
// `run` là db.get().query hoặc t.query trong transaction; userId = null thì xử lý mọi độc giả.
async function syncLocks(run, userId = null) {
  await run(
    `UPDATE users SET locked_at = NULL
      WHERE role = 'reader' AND locked_at IS NOT NULL AND ($1::int IS NULL OR id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM loans l
           WHERE l.user_id = users.id
             AND ((l.returned_at IS NULL AND l.due_date < ${TODAY})
               OR (l.returned_at IS NOT NULL AND l.fine_amount > 0 AND l.fine_paid_at IS NULL)))`,
    [userId]
  );
  await run(
    `UPDATE users SET locked_at = ${TODAY}
      WHERE role = 'reader' AND locked_at IS NULL AND ($1::int IS NULL OR id = $1)
        AND EXISTS (
          SELECT 1 FROM loans l
           WHERE l.user_id = users.id AND l.returned_at IS NULL AND ${TODAY} - l.due_date > $2)`,
    [userId, rules.lockAfterOverdueDays]
  );
}

// Tình trạng tài khoản của một độc giả: có bị khóa không và còn nợ bao nhiêu
async function accountStatus(userId) {
  await syncLocks(db.get().query, userId);
  const row = (
    await db.get().query(
      `SELECT u.locked_at,
              coalesce(sum(CASE WHEN l.returned_at IS NOT NULL AND l.fine_amount > 0 AND l.fine_paid_at IS NULL THEN l.fine_amount
                                WHEN l.returned_at IS NULL AND l.due_date < ${TODAY} THEN (${TODAY} - l.due_date) * $2 END), 0)::int AS debt
         FROM users u LEFT JOIN loans l ON l.user_id = u.id
        WHERE u.id = $1 GROUP BY u.id`,
      [userId, rules.finePerDay]
    )
  ).rows[0];
  return { locked: !!(row && row.locked_at), lockedAt: row && row.locked_at, debt: row ? row.debt : 0 };
}

module.exports = { syncLocks, accountStatus };
