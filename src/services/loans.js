const db = require('../db');
const { rules } = require('../config');
const { syncLocks } = require('./accounts');

const { TODAY } = db;

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Lập phiếu mượn: kiểm tra toàn bộ quy tắc nghiệp vụ trong 1 transaction.
// Khóa dòng (FOR UPDATE) để hai thủ thư không thể cùng mượn cuốn sách cuối cùng.
// approverId = thủ thư duyệt phiếu, lưu vào loans.approved_by để biết ai chịu trách nhiệm.
async function createLoan(userId, bookId, approverId = null) {
  return db.get().tx(async (t) => {
    const book = (await t.query('SELECT * FROM books WHERE id = $1 FOR UPDATE', [bookId])).rows[0];
    if (!book) throw new AppError('Không tìm thấy sách', 404);
    if (book.available_copies <= 0) throw new AppError(`Sách "${book.title}" đã hết bản trong kho`);

    const reader = (await t.query("SELECT id, full_name FROM users WHERE id = $1 AND role = 'reader' FOR UPDATE", [userId])).rows[0];
    if (!reader) throw new AppError('Không tìm thấy độc giả', 404);

    await syncLocks(t.query, userId);
    const locked = (await t.query('SELECT locked_at FROM users WHERE id = $1', [userId])).rows[0].locked_at;
    if (locked) throw new AppError(`Tài khoản của ${reader.full_name} đang bị khóa do quá hạn trên ${rules.lockAfterOverdueDays} ngày. Cần trả sách và nộp đủ tiền phạt để được mở lại`);

    const active = (await t.query('SELECT book_id, due_date < ' + TODAY + ' AS overdue FROM loans WHERE user_id = $1 AND returned_at IS NULL', [userId])).rows;
    if (active.some((l) => l.overdue)) throw new AppError(`${reader.full_name} đang có sách quá hạn chưa trả, không thể mượn thêm`);
    if (active.length >= rules.maxActiveLoans) throw new AppError(`Mỗi độc giả chỉ được mượn tối đa ${rules.maxActiveLoans} cuốn cùng lúc`);
    if (active.some((l) => l.book_id === book.id)) throw new AppError('Độc giả đang mượn cuốn sách này rồi');

    await t.query(
      `INSERT INTO loans (user_id, book_id, borrowed_at, due_date, approved_by)
       VALUES ($1, $2, ${TODAY}, ${TODAY} + $3::int, $4)`,
      [userId, bookId, rules.loanDays, approverId]
    );
    await t.query('UPDATE books SET available_copies = available_copies - 1 WHERE id = $1', [bookId]);
    return { book, reader };
  });
}

// Trả sách: tính tiền phạt = số ngày trễ × đơn giá
async function returnLoan(loanId) {
  return db.get().tx(async (t) => {
    const loan = (await t.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [loanId])).rows[0];
    if (!loan) throw new AppError('Không tìm thấy phiếu mượn', 404);
    if (loan.returned_at) throw new AppError('Phiếu mượn này đã được trả trước đó');

    const res = await t.query(
      `UPDATE loans
          SET returned_at = ${TODAY},
              fine_amount = GREATEST(0, ${TODAY} - due_date) * $2
        WHERE id = $1
    RETURNING fine_amount`,
      [loanId, rules.finePerDay]
    );
    await t.query('UPDATE books SET available_copies = available_copies + 1 WHERE id = $1', [loan.book_id]);
    await syncLocks(t.query, loan.user_id);
    return { fine: res.rows[0].fine_amount };
  });
}

// Thu tiền phạt của phiếu đã trả; nộp đủ và hết sách quá hạn thì tài khoản được mở khóa
async function payFine(loanId) {
  return db.get().tx(async (t) => {
    const loan = (await t.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [loanId])).rows[0];
    if (!loan) throw new AppError('Không tìm thấy phiếu mượn', 404);
    if (!loan.returned_at) throw new AppError('Sách chưa trả, chưa thể thu tiền phạt');
    if (loan.fine_amount <= 0) throw new AppError('Phiếu này không có tiền phạt');
    if (loan.fine_paid_at) throw new AppError('Tiền phạt của phiếu này đã được thu');

    await t.query(`UPDATE loans SET fine_paid_at = ${TODAY} WHERE id = $1`, [loanId]);
    await syncLocks(t.query, loan.user_id);
    const locked = (await t.query('SELECT locked_at FROM users WHERE id = $1', [loan.user_id])).rows[0].locked_at;
    return { amount: loan.fine_amount, stillLocked: !!locked };
  });
}

// Gia hạn: mỗi phiếu 1 lần, chỉ khi chưa quá hạn
async function renewLoan(loanId, userId = null) {
  return db.get().tx(async (t) => {
    const loan = (await t.query('SELECT *, due_date < ' + TODAY + ' AS overdue FROM loans WHERE id = $1 FOR UPDATE', [loanId])).rows[0];
    if (!loan || (userId && loan.user_id !== userId)) throw new AppError('Không tìm thấy phiếu mượn', 404);
    await syncLocks(t.query, loan.user_id);
    if ((await t.query('SELECT locked_at FROM users WHERE id = $1', [loan.user_id])).rows[0].locked_at) throw new AppError('Tài khoản đang bị khóa do quá hạn, không thể gia hạn');
    if (loan.returned_at) throw new AppError('Sách đã trả, không thể gia hạn');
    if (loan.renewed) throw new AppError('Phiếu mượn này đã gia hạn 1 lần, không thể gia hạn thêm');
    if (loan.overdue) throw new AppError('Phiếu đã quá hạn, vui lòng trả sách thay vì gia hạn');

    await t.query('UPDATE loans SET due_date = due_date + $2::int, renewed = true WHERE id = $1', [loanId, rules.renewDays]);
  });
}

module.exports = { AppError, createLoan, returnLoan, payFine, renewLoan };
